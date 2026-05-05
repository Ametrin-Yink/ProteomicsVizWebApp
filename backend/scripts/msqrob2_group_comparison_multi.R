#!/usr/bin/env Rscript
#
# msqrob2 Group Comparison — Multi-Condition (Step 7)
#
# Performs native msqrob2 differential expression analysis from an RDS
# checkpoint produced by Step 6 (msqrob2 data process).
#
# Supports N conditions with M arbitrary contrasts using msqrob2's
# hypothesis testing framework (msqrobLm or msqrobGlm).
#
# Usage: Rscript msqrob2_group_comparison_multi.R <rds_file> <output_dir>
#        <comparisons_json> <gene_mapping_file> <config_json>
#
# Arguments:
#   rds_file           RDS checkpoint from Step 6
#   output_dir         Directory for Diff_Expression_*.tsv files
#   comparisons_json   JSON array of [{group1:{Condition:"X"},group2:{Condition:"Y"}}]
#   gene_mapping_file  Optional UniProt gene mapping file ("" for none)
#   config_json        JSON with model, robust, ridge, adjust_method ({} for defaults)
#
# Config defaults:
#   model:         "msqrobLm"   (msqrobLm | msqrobGlm)
#   robust:        TRUE
#   ridge:         FALSE
#   adjust_method: "BH"         (BH | bonferroni | holm | BY | fdr)
#
# Output contract (per-comparison TSV):
#   Master_Protein_Accessions, Gene_Name, PSM_Count, logFC, pval, adjPval, se, df

suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(limma)
    library(matrixStats)
    library(jsonlite)
})

# ============================================================================
# Parse command line arguments
# ============================================================================
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste(
        "Usage: Rscript msqrob2_group_comparison_multi.R <rds_file> <output_dir>",
        "<comparisons_json> <gene_mapping_file> <config_json>"
    ))
}

rds_file          <- args[1]
output_dir        <- args[2]
comparisons_json  <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json       <- if (nzchar(args[5])) args[5] else "{}"

cat("Step 7 (msqrob2): Running multi-condition differential expression analysis\n")
cat("Arguments received:", length(args), "\n")
for (i in seq_along(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("RDS file:", rds_file, "\n")
cat("Output dir:", output_dir, "\n")
cat("Comparisons JSON:", comparisons_json, "\n")
cat("Gene mapping file:", ifelse(is.null(gene_mapping_file), "NULL", gene_mapping_file), "\n")
cat("Config JSON:", config_json, "\n")
flush.console()

# ============================================================================
# Parse config JSON
# ============================================================================
config <- tryCatch(
    fromJSON(config_json, simplifyVector = FALSE),
    error = function(e) {
        cat("Warning: Could not parse config JSON, using defaults\n")
        list()
    }
)

model_type    <- if (!is.null(config$model)) as.character(config$model) else "msqrobLm"
robust        <- if (!is.null(config$robust)) isTRUE(as.logical(config$robust)) else TRUE
ridge         <- if (!is.null(config$ridge)) isTRUE(as.logical(config$ridge)) else FALSE
adjust_method <- if (!is.null(config$adjust_method)) as.character(config$adjust_method) else "BH"

cat("Config:\n")
cat("  model:", model_type, "\n")
cat("  robust:", robust, "\n")
cat("  ridge:", ridge, "\n")
cat("  adjust_method:", adjust_method, "\n")
flush.console()

# Validate config
VALID_MODELS <- c("msqrobLm", "msqrobGlm")
VALID_ADJUST <- c("BH", "bonferroni", "holm", "BY", "fdr")

if (!model_type %in% VALID_MODELS) {
    stop(paste("Invalid model type:", model_type, "- must be one of",
               paste(VALID_MODELS, collapse = ", ")))
}
if (!adjust_method %in% VALID_ADJUST) {
    stop(paste("Invalid adjust_method:", adjust_method, "- must be one of",
               paste(VALID_ADJUST, collapse = ", ")))
}

# ============================================================================
# Validate inputs
# ============================================================================
if (!file.exists(rds_file)) {
    stop(paste("RDS file not found:", rds_file))
}

dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ============================================================================
# STEP 1: Load RDS checkpoint
# ============================================================================
cat("\n=== Step 1: Loading RDS checkpoint ===\n")
flush.console()

checkpoint <- readRDS(rds_file)

# Extract by position for robustness (named or unnamed list)
#   [[1]]: protein_matrix  - numeric matrix (proteins x samples)
#   [[2]]: sample_names    - character vector
#   [[3]]: gene_names      - character vector (positionally matches protein matrix rows)
#   [[4]]: psm_counts      - integer vector (positionally matches protein matrix rows)
#   [[5]]: norm_coefficients - data.frame (optional)
protein_matrix <- checkpoint[[1]]
sample_names   <- as.character(checkpoint[[2]])
gene_names     <- checkpoint[[3]]
psm_counts     <- checkpoint[[4]]

cat("Loaded checkpoint:\n")
cat("  Protein matrix:", nrow(protein_matrix), "proteins x", ncol(protein_matrix), "samples\n")
cat("  Sample names:", length(sample_names), "\n")
cat("  Gene names:", length(gene_names), "entries\n")
cat("  PSM counts:", length(psm_counts), "entries\n")
flush.console()

# Ensure column names on protein matrix match sample_names
if (is.null(colnames(protein_matrix))) {
    colnames(protein_matrix) <- sample_names
} else if (!identical(colnames(protein_matrix), sample_names)) {
    cat("  Re-assigning column names to match sample_names\n")
    colnames(protein_matrix) <- sample_names
}

# Row names are required (protein IDs)
if (is.null(rownames(protein_matrix)) || any(rownames(protein_matrix) == "")) {
    stop("Protein matrix row names (protein IDs) are required")
}

# Dimension check
if (ncol(protein_matrix) != length(sample_names)) {
    stop(paste(
        "Protein matrix has", ncol(protein_matrix), "columns but",
        "sample_names has", length(sample_names), "entries"
    ))
}

# Ensure gene_names and psm_counts are properly aligned and named for lookup
original_protein_ids <- rownames(protein_matrix)

# gene_names: coerce to character and name for lookup
if (length(gene_names) == length(original_protein_ids)) {
    names(gene_names) <- original_protein_ids
} else if (length(gene_names) > 0) {
    cat("  Warning: gene_names length (", length(gene_names),
        ") does not match protein matrix rows (", nrow(protein_matrix), ")\n", sep = "")
    # Create empty named vector as fallback
    gene_names <- setNames(rep(NA_character_, nrow(protein_matrix)), original_protein_ids)
}

# psm_counts: coerce to integer and name for lookup
if (length(psm_counts) == length(original_protein_ids)) {
    names(psm_counts) <- original_protein_ids
    psm_counts <- as.integer(psm_counts)
} else if (length(psm_counts) > 0) {
    cat("  Warning: psm_counts length (", length(psm_counts),
        ") does not match protein matrix rows (", nrow(protein_matrix), ")\n", sep = "")
    psm_counts <- setNames(rep(0L, nrow(protein_matrix)), original_protein_ids)
}

# ============================================================================
# STEP 2: Parse comparisons in unified format
# ============================================================================
cat("\n=== Step 2: Parsing comparisons ===\n")
flush.console()

comparisons <- tryCatch(
    fromJSON(comparisons_json, simplifyVector = FALSE),
    error = function(e) {
        stop(paste("Failed to parse comparisons JSON:", conditionMessage(e)))
    }
)

if (length(comparisons) == 0) {
    stop("No comparisons provided in JSON")
}

cat("Number of comparisons:", length(comparisons), "\n")
flush.console()

# Process each comparison: build labels, collect condition values
comparison_labels    <- character(length(comparisons))
all_condition_values <- character(0)

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]

    # Validate structure
    if (is.null(comp$group1) || is.null(comp$group2)) {
        stop(paste("Comparison", i, "is missing group1 or group2"))
    }

    # Extract values from group1 and group2 dictionaries
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))

    if (length(g1_values) == 0 || length(g2_values) == 0) {
        stop(paste("Comparison", i, "has empty group1 or group2"))
    }

    # Build label: concatenate multi-key groups with "+"
    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    label <- paste0(g1_label, "_vs_", g2_label)
    comparison_labels[i] <- label

    cat("  Comparison", i, ":", label, "\n")
    cat("    group1:", toJSON(comp$group1), "\n")
    cat("    group2:", toJSON(comp$group2), "\n")

    all_condition_values <- c(all_condition_values, g1_values, g2_values)
}
flush.console()

# ============================================================================
# STEP 3: Collect unique conditions sorted by length descending
# ============================================================================
cat("\n=== Step 3: Identifying unique conditions ===\n")

unique_conditions <- unique(all_condition_values)
unique_conditions <- unique_conditions[order(-nchar(unique_conditions))]

cat("Unique conditions (sorted by length descending):\n")
cat(" ", paste(unique_conditions, collapse = ", "), "\n")
flush.console()

# ============================================================================
# STEP 4: Assign condition to each sample
# ============================================================================
cat("\n=== Step 4: Assigning conditions to samples ===\n")

col_data <- data.frame(
    sample = sample_names,
    stringsAsFactors = FALSE
)

# Match sample names against conditions using fixed=TRUE (no regex)
# Check longer conditions first to avoid substring mismatches
col_data$condition <- vapply(sample_names, function(sname) {
    for (cond in unique_conditions) {
        if (grepl(cond, sname, ignore.case = TRUE, fixed = TRUE)) {
            return(cond)
        }
    }
    return(NA_character_)
}, character(1), USE.NAMES = FALSE)

# Error if any samples are unmatched
na_idx <- is.na(col_data$condition)
if (any(na_idx)) {
    stop(paste(
        "Could not assign condition to the following samples:\n",
        paste("  -", sample_names[na_idx], collapse = "\n")
    ))
}

# Convert to factor with correct level order
col_data$condition <- factor(col_data$condition, levels = unique_conditions)

cat("Sample condition distribution:\n")
print(table(col_data$condition))
flush.console()

# Verify all comparison conditions are represented
present_conditions <- levels(col_data$condition)
missing_conditions <- setdiff(unique_conditions, present_conditions)
if (length(missing_conditions) > 0) {
    stop(paste(
        "Conditions from comparisons not found in sample data:",
        paste(missing_conditions, collapse = ", ")
    ))
}

# Warn about low replicates
condition_counts <- table(col_data$condition)
if (any(condition_counts < 2)) {
    warning(paste(
        "Some conditions have fewer than 2 replicates:",
        paste(names(condition_counts[condition_counts < 2]), collapse = ", ")
    ))
}

# Need at least 2 conditions
if (length(unique(col_data$condition)) < 2) {
    stop("At least 2 distinct conditions must be present in the data")
}

# ============================================================================
# STEP 5: Pre-filter zero-variance proteins
# ============================================================================
cat("\n=== Step 5: Pre-filtering zero-variance proteins ===\n")

protein_vars   <- rowVars(protein_matrix, na.rm = TRUE)
zero_var_mask  <- (!is.na(protein_vars) & protein_vars < 1e-10)
zero_var_ids   <- character(0)

if (any(zero_var_mask)) {
    zero_var_ids <- rownames(protein_matrix)[zero_var_mask]
    cat("  Found", length(zero_var_ids), "proteins with variance < 1e-10\n")
    cat("  These will be excluded from modeling and re-added to output\n")
    protein_matrix <- protein_matrix[!zero_var_mask, , drop = FALSE]
} else {
    cat("  No zero-variance proteins detected\n")
}

cat("  Proteins after filtering:", nrow(protein_matrix), "\n")
flush.console()

if (nrow(protein_matrix) < 2) {
    stop("Too few proteins remaining after zero-variance filtering (need >= 2)")
}

# Track filtered protein IDs
filtered_ids <- rownames(protein_matrix)

# ============================================================================
# STEP 6: Build design matrix
# ============================================================================
cat("\n=== Step 6: Building design matrix ===\n")

design <- model.matrix(~ 0 + condition, data = col_data)
colnames(design) <- levels(col_data$condition)

cat("Design matrix (", nrow(design), " rows x ", ncol(design), " columns):\n", sep = "")
print(design)

# Verify dimensions
if (nrow(design) != ncol(protein_matrix)) {
    stop(paste(
        "Design matrix has", nrow(design), "rows but protein matrix has",
        ncol(protein_matrix), "columns"
    ))
}
cat("Dimension check passed\n")
flush.console()

# ============================================================================
# STEP 7: Fit model
# ============================================================================
cat("\n=== Step 7: Fitting model with", model_type, "===\n")
flush.console()

if (model_type == "msqrobLm") {
    cat("  Fitting msqrobLm (robust =", robust, ", maxitRob = 5)\n")
    flush.console()

    fit <- msqrobLm(
        y       = protein_matrix,
        formula = ~ 0 + condition,
        data    = col_data,
        robust  = robust,
        maxitRob = 5
    )
} else {
    # msqrobGlm requires PSM counts per protein
    cat("  Fitting msqrobGlm\n")
    flush.console()

    psm_for_model <- psm_counts[filtered_ids]
    psm_for_model[is.na(psm_for_model)] <- 0L
    psm_for_model <- as.integer(pmax(psm_for_model, 1L))

    cat("  PSM count range: [", min(psm_for_model), ", ", max(psm_for_model), "]\n", sep = "")
    flush.console()

    fit <- msqrobGlm(
        y       = protein_matrix,
        npep    = psm_for_model,
        formula = ~ 0 + condition,
        data    = col_data
    )
}

cat("  Model fitted successfully\n")
cat("  Coefficients:", paste(colnames(coef(fit)), collapse = ", "), "\n")
flush.console()

# ============================================================================
# STEP 8: Process each comparison
# ============================================================================
cat("\n=== Step 8: Processing comparisons ===\n")
flush.console()

coef_names <- colnames(coef(fit))

for (i in seq_along(comparisons)) {
    comp  <- comparisons[[i]]
    label <- comparison_labels[i]

    cat("\n--- Comparison", i, ":", label, "---\n")

    # Extract group values as flat character vectors
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))

    # Build contrast vector: +1 for group1 (treatment), -1 for group2 (control)
    contrast_vec <- setNames(rep(0, length(coef_names)), coef_names)

    for (val in g1_values) {
        if (val %in% coef_names) {
            contrast_vec[val] <- contrast_vec[val] + 1
        } else {
            cat("    Warning: group1 value '", val, "' not in model coefficients\n", sep = "")
        }
    }
    for (val in g2_values) {
        if (val %in% coef_names) {
            contrast_vec[val] <- contrast_vec[val] - 1
        } else {
            cat("    Warning: group2 value '", val, "' not in model coefficients\n", sep = "")
        }
    }

    cat("    Contrast vector:\n")
    print(contrast_vec)
    flush.console()

    if (all(contrast_vec == 0)) {
        cat("    ERROR: Contrast is all zeros, skipping this comparison\n")
        next
    }

    # Apply hypothesis test
    cat("    Running hypothesis test...\n")
    flush.console()

    test_result <- tryCatch(
        hypothesisTest(fit, contrast = contrast_vec),
        error = function(e) {
            cat("    ERROR: hypothesisTest failed:", conditionMessage(e), "\n")
            return(NULL)
        }
    )

    if (is.null(test_result)) {
        cat("    Skipping comparison due to test failure\n")
        next
    }

    # Extract results
    cat("    Extracting top features...\n")
    flush.console()

    results <- topFeatures(
        test_result,
        contrast       = 1,
        adjust.method  = adjust_method,
        sort           = TRUE
    )

    if (!is.data.frame(results)) {
        results <- as.data.frame(results)
    }

    cat("    Results:", nrow(results), "proteins,", length(names(results)), "columns\n")
    cat("    Columns:", paste(names(results), collapse = ", "), "\n")
    flush.console()

    # ========================================================================
    # STEP 9: Map column names to frontend contract
    # ========================================================================
    cat("    Mapping to frontend column contract...\n")

    # Master_Protein_Accessions from rownames
    results$Master_Protein_Accessions <- rownames(results)

    # Gene_Name from checkpoint (named vector lookup)
    results$Gene_Name <- gene_names[results$Master_Protein_Accessions]
    results$Gene_Name[is.na(results$Gene_Name)] <- sub(
        "-\\d+$", "",
        results$Master_Protein_Accessions[is.na(results$Gene_Name)]
    )

    # PSM_Count from checkpoint
    results$PSM_Count <- psm_counts[results$Master_Protein_Accessions]
    results$PSM_Count[is.na(results$PSM_Count)] <- 0L

    # logFC - try common column names from msqrob2 output
    logFC_sources <- c("logFC", "log2FC", "coef", "Estimate", "log2FoldChange")
    found_logFC <- FALSE
    for (src in logFC_sources) {
        if (src %in% names(results)) {
            if (!"logFC" %in% names(results)) {
                results$logFC <- results[[src]]
            }
            found_logFC <- TRUE
            break
        }
    }
    if (!found_logFC) {
        results$logFC <- NA_real_
    }

    # pval - try common column names
    pval_sources <- c("pval", "P.Value", "pvalue", "p.value", "pValue", "PValue")
    found_pval <- FALSE
    for (src in pval_sources) {
        if (src %in% names(results)) {
            if (!"pval" %in% names(results)) {
                results$pval <- results[[src]]
            }
            found_pval <- TRUE
            break
        }
    }
    if (!found_pval) {
        results$pval <- NA_real_
    }

    # adjPval
    adjPval_sources <- c("adjPval", "adj.P.Val", "padj", "adj.p.value",
                         "adjPValue", "adj_pvalue", "qvalue")
    found_adjPval <- FALSE
    for (src in adjPval_sources) {
        if (src %in% names(results)) {
            if (!"adjPval" %in% names(results)) {
                results$adjPval <- results[[src]]
            }
            found_adjPval <- TRUE
            break
        }
    }
    if (!found_adjPval) {
        results$adjPval <- NA_real_
    }

    # se (standard error)
    se_sources <- c("se", "SE", "StdError", "std_error", "standard_error")
    found_se <- FALSE
    for (src in se_sources) {
        if (src %in% names(results)) {
            if (!"se" %in% names(results)) {
                results$se <- results[[src]]
            }
            found_se <- TRUE
            break
        }
    }
    if (!found_se) {
        results$se <- NA_real_
    }

    # df (degrees of freedom)
    df_sources <- c("df", "dfPosterior", "DF", "degrees_freedom",
                    "df.residual", "df_total")
    found_df <- FALSE
    for (src in df_sources) {
        if (src %in% names(results)) {
            if (!"df" %in% names(results)) {
                results$df <- results[[src]]
            }
            found_df <- TRUE
            break
        }
    }
    if (!found_df) {
        results$df <- NA_integer_
    }

    # ========================================================================
    # STEP 10: Re-add zero-variance proteins
    # ========================================================================
    if (length(zero_var_ids) > 0) {
        cat("    Re-adding", length(zero_var_ids), "zero-variance proteins\n")

        zero_var_df <- data.frame(
            Master_Protein_Accessions = zero_var_ids,
            stringsAsFactors = FALSE
        )

        # Gene names for zero-var proteins
        zero_var_df$Gene_Name <- gene_names[zero_var_ids]
        zero_var_df$Gene_Name[is.na(zero_var_df$Gene_Name)] <- sub(
            "-\\d+$", "",
            zero_var_ids[is.na(zero_var_df$Gene_Name)]
        )

        # PSM counts for zero-var proteins
        zero_var_df$PSM_Count <- psm_counts[zero_var_ids]
        zero_var_df$PSM_Count[is.na(zero_var_df$PSM_Count)] <- 0L

        # Default values for zero-variance proteins
        zero_var_df$logFC   <- 0
        zero_var_df$pval    <- NA_real_
        zero_var_df$adjPval <- NA_real_
        zero_var_df$se      <- NA_real_
        zero_var_df$df      <- NA_integer_

        # Fill any extra columns with NA
        for (col in setdiff(names(results), names(zero_var_df))) {
            zero_var_df[[col]] <- NA
        }

        # Align column order
        zero_var_df <- zero_var_df[, names(results), drop = FALSE]

        results <- rbind(results, zero_var_df)
    }

    # ========================================================================
    # STEP 11: Write per-comparison TSV
    # ========================================================================
    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    cat("    Writing:", output_file, "\n")

    write.table(
        results,
        file      = output_file,
        sep       = "\t",
        row.names = FALSE,
        quote     = FALSE,
        na        = "NA"
    )

    # ========================================================================
    # STEP 12: Print summary
    # ========================================================================
    sig_count   <- sum(results$adjPval < 0.05, na.rm = TRUE)
    up_count    <- sum(results$logFC > 0 & results$adjPval < 0.05, na.rm = TRUE)
    down_count  <- sum(results$logFC < 0 & results$adjPval < 0.05, na.rm = TRUE)

    cat("    Summary:\n")
    cat("      Total proteins:", nrow(results), "\n")
    cat("      Significant (adjPval < 0.05):", sig_count, "\n")
    cat("      Upregulated:", up_count, "\n")
    cat("      Downregulated:", down_count, "\n")
    flush.console()
}

cat("\n=== Step 7 complete: msqrob2 multi-condition differential expression ",
    "analysis finished successfully ===\n", sep = "")
flush.console()
