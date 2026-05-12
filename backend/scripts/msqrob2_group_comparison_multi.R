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
    library(BiocParallel)
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
batch_column  <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata      <- if (!is.null(config$metadata)) config$metadata else list()

cat("Config:\n")
cat("  model:", model_type, "\n")
cat("  robust:", robust, "\n")
cat("  ridge:", ridge, "\n")
cat("  adjust_method:", adjust_method, "\n")
cat("  batch_column:", ifelse(is.null(batch_column), "(none)", batch_column), "\n")
flush.console()

# numberOfCores for BiocParallel
n_cores <- if (!is.null(config$numberOfCores)) as.integer(config$numberOfCores) else 1L
if (is.na(n_cores) || n_cores < 1L) n_cores <- 1L

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

# Batch vector builder: matches sample names to metadata entries via condition values
build_batch_vector <- function(sample_names, metadata, batch_col) {
  batch_values <- rep(NA_character_, length(sample_names))
  meta_filenames <- names(metadata)
  if (length(meta_filenames) == 0) {
    stop("No metadata entries found — cannot assign batch")
  }
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in meta_filenames) {
      entry <- metadata[[fname]]
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) next
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1)))) {
        bv <- entry[[batch_col]]
        if (!is.null(bv) && nzchar(bv)) {
          batch_values[i] <- bv
          matched <- TRUE
        }
        break
      }
    }
    if (!matched) {
      for (fname in meta_filenames) {
        entry <- metadata[[fname]]
        exp_val <- entry[["experiment"]]
        if (!is.null(exp_val) && nzchar(exp_val) && grepl(exp_val, sname, fixed = TRUE)) {
          bv <- entry[[batch_col]]
          if (!is.null(bv) && nzchar(bv)) {
            batch_values[i] <- bv
            matched <- TRUE
          }
          break
        }
      }
    }
  }
  if (any(is.na(batch_values))) {
    stop("Could not assign batch for samples: ",
         paste(sample_names[is.na(batch_values)], collapse = ", "))
  }
  as.factor(batch_values)
}

# Set up BiocParallel for per-comparison parallelization
if (n_cores > 1L) {
    cat("Setting up SnowParam with", n_cores, "workers\n")
    BPPARAM <- tryCatch({
        SnowParam(workers = n_cores, progressbar = TRUE)
    }, error = function(e) {
        cat("WARNING: SnowParam creation failed:", conditionMessage(e), "\n")
        cat("WARNING: Falling back to serial processing. Analysis will be slower.\n")
        SerialParam()
    })
} else {
    cat("Using SerialParam (single-core)\n")
    BPPARAM <- SerialParam()
}
cat("  numberOfCores:", n_cores, "\n")

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

# Assign batch if batch_column is specified
has_batch <- !is.null(batch_column) && length(metadata) > 0
if (has_batch) {
    cat("\n=== Step 4b: Assigning batch from metadata column '", batch_column, "' ===\n", sep = "")
    flush.console()

    col_data$batch <- build_batch_vector(sample_names, metadata, batch_column)
    cat("Batch assignments:\n")
    print(table(col_data$batch))
    flush.console()
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

if (has_batch) {
    design <- model.matrix(~ 0 + condition + batch, data = col_data)
    n_conditions <- nlevels(col_data$condition)
    cond_coef_names <- levels(col_data$condition)
    # First n_conditions coefs are the condition columns (after ~ 0 + condition + batch)
    colnames(design)[1:n_conditions] <- cond_coef_names
} else {
    design <- model.matrix(~ 0 + condition, data = col_data)
    colnames(design) <- levels(col_data$condition)
}
model_coef_names <- colnames(design)

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

# Build formula dynamically: include batch if specified
model_formula <- if (has_batch) {
    as.formula("~ 0 + condition + batch")
} else {
    as.formula("~ 0 + condition")
}
cat("  Formula:", deparse(model_formula), "\n")

if (model_type == "msqrobLm") {
    cat("  Fitting msqrobLm (robust =", robust, ", maxitRob = 10)\n")
    flush.console()

    fit <- msqrobLm(
        y       = protein_matrix,
        formula = model_formula,
        data    = col_data,
        robust  = robust,
        maxitRob = 10
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
        formula = model_formula,
        data    = col_data
    )
}

cat("  Model fitted successfully\n")
cat("  Coefficients:", paste(colnames(coef(fit)), collapse = ", "), "\n")
flush.console()

# ============================================================================
# STEP 8: Build contrast vectors for all comparisons
# ============================================================================
cat("\n=== Step 8: Processing comparisons ===\n")
flush.console()

coef_names <- colnames(coef(fit))
# msqrobLm may not expose coefficient names via colnames(coef()).
# Fall back to raw model.matrix column names (saved before renaming).
if (is.null(coef_names) || length(coef_names) == 0) {
    coef_names <- model_coef_names
}
cat("Coefficient names:", paste(coef_names, collapse = ", "), "\n")
cat("Processing", length(comparisons), "comparisons with",
    if (inherits(BPPARAM, "SnowParam")) paste0(n_cores, " parallel workers") else "serial processing", "\n")
flush.console()

# Build mapping from condition value to coefficient name.
# Handles both "condition<level>" (R default) and plain "<level>" naming styles.
cond_to_coef <- character()
for (cond in unique_conditions) {
    # Match coefficient name ending with the condition value (anchored)
    hits <- which(grepl(paste0(cond, "$"), coef_names, perl = TRUE))
    if (length(hits) == 1) {
        cond_to_coef[cond] <- coef_names[hits]
    }
}

# Build contrast vectors for all comparisons (serial — lightweight)
contrast_list <- vector("list", length(comparisons))
valid_comparisons <- logical(length(comparisons))

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))

    contrast_vec <- setNames(rep(0, length(coef_names)), coef_names)
    for (val in g1_values) {
        coef_name <- cond_to_coef[val]
        if (!is.na(coef_name) && nzchar(coef_name)) {
            contrast_vec[coef_name] <- contrast_vec[coef_name] + 1
        }
    }
    for (val in g2_values) {
        coef_name <- cond_to_coef[val]
        if (!is.na(coef_name) && nzchar(coef_name)) {
            contrast_vec[coef_name] <- contrast_vec[coef_name] - 1
        }
    }

    if (all(contrast_vec == 0)) {
        cat("  Comparison", i, ": contrast is all zeros, skipping\n")
        next
    }

    contrast_list[[i]] <- contrast_vec
    valid_comparisons[i] <- TRUE
    cat("  Comparison", i, "(", comparison_labels[i], "): contrast =",
        paste(names(contrast_vec)[contrast_vec != 0], contrast_vec[contrast_vec != 0],
              sep = ":", collapse = ", "), "\n")
}
flush.console()

# ============================================================================
# STEP 9: Run hypothesis tests in parallel
# ============================================================================
cat("\n=== Step 9: Running hypothesis tests ===\n")
flush.console()

# Pre-build zero-variance data frame (same for all comparisons)
zero_var_df_template <- NULL
if (length(zero_var_ids) > 0) {
    zero_var_df_template <- data.frame(
        Master_Protein_Accessions = zero_var_ids,
        stringsAsFactors = FALSE
    )
    zero_var_df_template$Gene_Name <- gene_names[zero_var_ids]
    zero_var_df_template$Gene_Name[is.na(zero_var_df_template$Gene_Name)] <- sub(
        "-\\d+$", "", zero_var_ids[is.na(zero_var_df_template$Gene_Name)]
    )
    zero_var_df_template$PSM_Count <- psm_counts[zero_var_ids]
    zero_var_df_template$PSM_Count[is.na(zero_var_df_template$PSM_Count)] <- 0L
    zero_var_df_template$logFC   <- 0
    zero_var_df_template$pval    <- NA_real_
    zero_var_df_template$adjPval <- NA_real_
    zero_var_df_template$se      <- NA_real_
    zero_var_df_template$df      <- NA_integer_
}

# Closure captures invariant context; signature reduced to (idx)
# NOTE: fit is NOT captured in the closure to avoid S4 serialization issues
# with SnowParam. Instead it is saved to a temp RDS and loaded by each worker.
fit_rds <- file.path(output_dir, ".msqrob2_fit.rds")
saveRDS(fit, fit_rds)
on.exit(try(unlink(fit_rds), silent = TRUE), add = TRUE)

process_one_comparison <- local({
    # Capture invariant state from enclosing scope
    .contrasts      <- contrast_list
    .labels         <- comparison_labels
    .fit_rds        <- fit_rds
    .coef_names     <- coef_names
    .gene_names     <- gene_names
    .psm_counts     <- psm_counts
    .adjust_method  <- adjust_method
    .zero_var_df_tmpl <- zero_var_df_template
    .logFC_sources  <- c("logFC", "log2FC", "coef", "Estimate", "log2FoldChange")
    .pval_sources   <- c("pval", "P.Value", "pvalue", "p.value", "pValue", "PValue")
    .adjPval_srcs   <- c("adjPval", "adj.P.Val", "padj", "adj.p.value",
                         "adjPValue", "adj_pvalue", "qvalue")
    .se_sources     <- c("se", "SE", "StdError", "std_error", "standard_error")
    .df_sources     <- c("df", "dfPosterior", "DF", "degrees_freedom",
                         "df.residual", "df_total")

    function(idx) {
        # Ensure msqrob2 S4 class definitions are available in SnowParam workers.
        # Without this, readRDS returns a plain list and hypothesisTest fails with
        # "unable to find an inherited method for 'hypothesisTest' for signature 'list'".
        suppressPackageStartupMessages(library(msqrob2))

        # Load model from RDS inside worker to avoid S4 serialization issues
        .fit <- readRDS(.fit_rds)

        contrast_vec <- .contrasts[[idx]]
        label <- .labels[idx]

        test_result <- tryCatch(
            hypothesisTest(.fit, contrast = contrast_vec),
            error = function(e) {
                cat("    ERROR in comparison", idx, "(", label, "):", conditionMessage(e), "\n")
                return(NULL)
            }
        )

        if (is.null(test_result)) return(NULL)

        results <- topFeatures(
            test_result,
            contrast       = 1,
            adjust.method  = .adjust_method,
            sort           = TRUE
        )

        if (!is.data.frame(results)) {
            results <- as.data.frame(results)
        }

        # Map to frontend column contract
        results$Master_Protein_Accessions <- rownames(results)

        results$Gene_Name <- .gene_names[results$Master_Protein_Accessions]
        results$Gene_Name[is.na(results$Gene_Name)] <- sub(
            "-\\d+$", "",
            results$Master_Protein_Accessions[is.na(results$Gene_Name)]
        )

        results$PSM_Count <- .psm_counts[results$Master_Protein_Accessions]
        results$PSM_Count[is.na(results$PSM_Count)] <- 0L

        # Map column names via lookup tables
        map_column <- function(results_df, sources, target_name, default_val) {
            for (src in sources) {
                if (src %in% names(results_df)) {
                    if (!(target_name %in% names(results_df)))
                        results_df[[target_name]] <- results_df[[src]]
                    return(results_df)
                }
            }
            results_df[[target_name]] <- default_val
            results_df
        }

        results <- map_column(results, .logFC_sources, "logFC", NA_real_)
        results <- map_column(results, .pval_sources,  "pval",  NA_real_)
        results <- map_column(results, .adjPval_srcs,  "adjPval", NA_real_)
        results <- map_column(results, .se_sources,    "se",    NA_real_)
        results <- map_column(results, .df_sources,    "df",    NA_integer_)

        # Re-add zero-variance proteins from pre-built template
        if (!is.null(.zero_var_df_tmpl)) {
            zero_var_df <- .zero_var_df_tmpl
            # Fill any extra columns with NA (handles varying msqrob2 output columns)
            for (col in setdiff(names(results), names(zero_var_df))) {
                zero_var_df[[col]] <- NA
            }
            zero_var_df <- zero_var_df[, names(results), drop = FALSE]
            results <- rbind(results, zero_var_df)
        }

        return(results)
    }
})

# Run comparisons serially. SnowParam workers run in separate R processes
# that cannot reliably reconstruct S4 msqrob2 fit objects from RDS files,
# even when msqrob2 is loaded in the worker. The resulting "signature 'list'"
# error from hypothesisTest is unrecoverable in parallel, so we bypass
# bplapply and use lapply directly.
valid_idx <- which(valid_comparisons)
cat("Running", length(valid_idx), "comparisons (serial)...\n")
flush.console()

parallel_args <- list(
    X = valid_idx,
    FUN = process_one_comparison
)

all_results <- do.call(lapply, parallel_args)

# ============================================================================
# STEP 10: Write TSV files and print summaries
# ============================================================================
cat("\n=== Step 10: Writing results ===\n")
flush.console()

for (i in seq_along(valid_idx)) {
    results <- all_results[[i]]
    actual_idx <- valid_idx[i]
    label <- comparison_labels[actual_idx]

    if (is.null(results)) {
        cat("  Skipping comparison", actual_idx, "(", label, "): processing failed\n")
        next
    }

    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    cat("  Writing:", output_file, "(", nrow(results), "proteins)\n")

    write.table(
        results,
        file      = output_file,
        sep       = "\t",
        row.names = FALSE,
        quote     = FALSE,
        na        = "NA"
    )

    # Print summary
    sig_count   <- sum(results$adjPval < 0.05, na.rm = TRUE)
    up_count    <- sum(results$logFC > 0 & results$adjPval < 0.05, na.rm = TRUE)
    down_count  <- sum(results$logFC < 0 & results$adjPval < 0.05, na.rm = TRUE)

    cat("    Total proteins:", nrow(results), "\n")
    cat("    Significant (adjPval < 0.05):", sig_count, "\n")
    cat("    Upregulated:", up_count, "\n")
    cat("    Downregulated:", down_count, "\n")
    flush.console()
}

cat("\n=== Step 7 complete: msqrob2 multi-condition differential expression ",
    "analysis finished successfully ===\n", sep = "")
flush.console()
