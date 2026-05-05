#!/usr/bin/env Rscript
#
# MSstats Multi-Condition Group Comparison (Step 7 - MSstats multi-condition pipeline)
#
# Loads processed data from dataProcess step, builds full contrast matrix,
# runs groupComparison, and outputs one Diff_Expression_<treatment>_vs_<control>.tsv
# per comparison.
#
# Usage: Rscript msstats_group_comparison_multi.R <rds_file> <output_dir>
#        <comparisons_json> <covariates_json> <gene_mapping_file> <config_json>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(MSstats)
    library(jsonlite)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 6) {
    stop(paste("Usage: Rscript msstats_group_comparison_multi.R <rds_file> <output_dir>",
               "<comparisons_json> <covariates_json> <gene_mapping_file> <config_json>"))
}

rds_file        <- args[1]
output_dir      <- args[2]
comparisons_json <- args[3]
covariates_json <- if (nzchar(args[4])) args[4] else "{}"
gene_mapping_file <- if (nzchar(args[5])) args[5] else NULL
config_json     <- if (length(args) >= 6 && nzchar(args[6])) args[6] else "{}"

# Parse config JSON
config <- fromJSON(config_json)
log_base        <- if (!is.null(config$log_base)) as.numeric(config$log_base) else 2
num_cores       <- if (!is.null(config$numberOfCores)) as.integer(config$numberOfCores) else 1
save_fitted_models <- if (!is.null(config$save_fitted_models)) as.logical(config$save_fitted_models) else TRUE

cat("Step 7: Running multi-condition differential expression with MSstats\n")
cat("Arguments received:", length(args), "\n")
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("RDS file:", rds_file, "\n")
cat("Output dir:", output_dir, "\n")
cat("Comparisons:", comparisons_json, "\n")
cat("Config - log_base:", log_base, ", numberOfCores:", num_cores, ", save_fitted_models:", save_fitted_models, "\n")
flush.console()

# Check if RDS file exists
if (!file.exists(rds_file)) {
    stop(paste("RDS file not found:", rds_file))
}

# Load RDS
cat("Loading processed data from RDS...\n")
rds_data <- readRDS(rds_file)
converted <- rds_data$converted
processed <- rds_data$processed

cat("Loaded RDS data\n")
cat("Processed object class:", class(processed), "\n")
cat("Processed object names:", paste(names(processed), collapse = ", "), "\n")
flush.console()

# Get condition levels from the ProteinLevelData
if (!is.null(processed$ProteinLevelData) && "GROUP" %in% names(processed$ProteinLevelData)) {
    condition_levels <- unique(processed$ProteinLevelData$GROUP)
} else if (!is.null(processed$ProteinLevelData) && "Condition" %in% names(processed$ProteinLevelData)) {
    condition_levels <- unique(processed$ProteinLevelData$Condition)
} else {
    stop(paste("Could not determine condition levels. Processed names:",
               paste(names(processed), collapse = ", ")))
}

cat("Condition levels:", paste(condition_levels, collapse = ", "), "\n")
flush.console()

# Parse covariates and add to ProteinLevelData
covariates <- fromJSON(covariates_json)
if (length(covariates) > 0 && !is.null(processed$ProteinLevelData)) {
    cat("Adding covariates to ProteinLevelData...\n")
    run_col <- if ("originalRUN" %in% names(processed$ProteinLevelData)) "originalRUN" else "RUN"

    # Get all covariate names from the first sample's metadata
    cov_names <- unique(unlist(lapply(covariates, names)))
    cat("  Covariate columns:", paste(cov_names, collapse = ", "), "\n")

    for (cov_name in cov_names) {
        # Build filename -> covariate_value mapping
        cov_map <- list()
        for (fn in names(covariates)) {
            if (cov_name %in% names(covariates[[fn]])) {
                cov_map[[fn]] <- covariates[[fn]][[cov_name]]
            }
        }
        # Apply to ProteinLevelData by matching filenames to RUN values
        cov_values <- rep(NA, nrow(processed$ProteinLevelData))
        for (fn in names(cov_map)) {
            matches <- grepl(fn, processed$ProteinLevelData[[run_col]], fixed = TRUE)
            cov_values[matches] <- cov_map[[fn]]
        }
        processed$ProteinLevelData[[cov_name]] <- cov_values
        cat("  Added covariate column:", cov_name,
            "(", sum(!is.na(cov_values)), "non-NA values )\n")
    }
    flush.console()
}

# Build combined GROUP column from all metadata condition columns
# Exclude core MSstats columns and known non-condition columns
core_cols <- c("RUN", "Protein", "LogIntensities", "originalRUN", "GROUP",
               "SUBJECT", "Label", "NumMeasuredFeature", "MissingPercentage",
               "more50missing", "NumImputedFeature")
all_pdata_cols <- names(processed$ProteinLevelData)

# Also exclude covariate columns that were injected
covariate_cols <- if (exists("cov_names") && length(cov_names) > 0) cov_names else character(0)
condition_cols <- setdiff(all_pdata_cols, c(core_cols, covariate_cols))

if (length(condition_cols) > 0) {
    cat("Building combined GROUP from columns:", paste(condition_cols, collapse=", "), "\n")
    condition_cols <- sort(condition_cols)  # consistent ordering
    processed$ProteinLevelData$GROUP <- apply(
        processed$ProteinLevelData[, condition_cols, drop=FALSE], 1,
        function(row) paste(row, collapse="_")
    )
    cat("Unique GROUP levels:", paste(unique(processed$ProteinLevelData$GROUP), collapse=", "), "\n")
} else {
    # Fallback: use existing GROUP if already present
    if (!("GROUP" %in% names(processed$ProteinLevelData))) {
        stop("No condition columns found and no GROUP column present")
    }
    cat("Using existing GROUP column\n")
}
flush.console()

# Parse comparisons (new format: [{group1: {col:val}, group2: {col:val}}])
cat("Parsing comparisons JSON...\n")
comparisons_raw <- fromJSON(comparisons_json)

# Handle both old and new format
if (!is.null(comparisons_raw$group1) && !is.null(comparisons_raw$group2)) {
    # Single comparison object (wrapped)
    comparisons_raw <- list(comparisons_raw)
}

cat("Number of comparisons:", length(comparisons_raw), "\n")
flush.console()

# Resolve each comparison to GROUP-level matches
resolved <- list()
for (i in seq_along(comparisons_raw)) {
    comp <- comparisons_raw[[i]]

    # Handle new format: {group1: {col:val}, group2: {col:val}}
    if (!is.null(comp$group1) && is.list(comp$group1)) {
        g1_criteria <- comp$group1
        g2_criteria <- comp$group2
        cat("Comparison", i, ": group1 =", toJSON(g1_criteria), ", group2 =", toJSON(g2_criteria), "\n")

        pdata <- processed$ProteinLevelData

        # Group 1: samples matching ALL criteria in group1
        g1_mask <- rep(TRUE, nrow(pdata))
        for (col_name in names(g1_criteria)) {
            if (col_name %in% names(pdata)) {
                g1_mask <- g1_mask & (as.character(pdata[[col_name]]) == as.character(g1_criteria[[col_name]]))
            } else {
                cat("  WARNING: column", col_name, "not found in ProteinLevelData\n")
            }
        }
        g1_groups <- unique(pdata$GROUP[g1_mask])
        g1_groups <- g1_groups[!is.na(g1_groups)]

        # Group 2: samples matching ALL criteria in group2
        g2_mask <- rep(TRUE, nrow(pdata))
        for (col_name in names(g2_criteria)) {
            if (col_name %in% names(pdata)) {
                g2_mask <- g2_mask & (as.character(pdata[[col_name]]) == as.character(g2_criteria[[col_name]]))
            } else {
                cat("  WARNING: column", col_name, "not found in ProteinLevelData\n")
            }
        }
        g2_groups <- unique(pdata$GROUP[g2_mask])
        g2_groups <- g2_groups[!is.na(g2_groups)]

        cat("  Group 1 GROUPs:", paste(g1_groups, collapse=", "), "\n")
        cat("  Group 2 GROUPs:", paste(g2_groups, collapse=", "), "\n")

        if (length(g1_groups) == 0 || length(g2_groups) == 0) {
            cat("  WARNING: Comparison", i, "has empty group(s), skipping\n")
            next
        }

        # Build label: values from group1 vs values from group2
        g1_label <- paste(sapply(names(g1_criteria), function(n) g1_criteria[[n]]), collapse="+")
        g2_label <- paste(sapply(names(g2_criteria), function(n) g2_criteria[[n]]), collapse="+")
        label <- paste0(g1_label, "_vs_", g2_label)

        resolved[[length(resolved) + 1]] <- list(
            group1 = g1_groups,
            group2 = g2_groups,
            label = label
        )

    # Handle old format: {treatment: "A", control: "B"} -- backward compat
    } else if (!is.null(comp$treatment) && !is.null(comp$control)) {
        cat("Comparison", i, ": treatment =", comp$treatment, ", control =", comp$control, "\n")
        g1_groups <- comp$treatment
        g2_groups <- comp$control
        resolved[[length(resolved) + 1]] <- list(
            group1 = g1_groups,
            group2 = g2_groups,
            label = paste0(comp$treatment, "_vs_", comp$control)
        )
    } else {
        cat("WARNING: Comparison", i, "has unknown format, skipping\n")
    }
}
flush.console()

if (length(resolved) == 0) {
    stop("No valid comparisons to run after resolving group criteria")
}

cat("\nResolved", length(resolved), "comparisons to GROUP-level contrasts\n")
for (i in seq_along(resolved)) {
    cat("  ", resolved[[i]]$label, "\n")
}
flush.console()

# Build contrast matrix with pooled comparison support
all_groups <- sort(unique(processed$ProteinLevelData$GROUP))
all_groups <- all_groups[!is.na(all_groups) & all_groups != ""]
n_groups <- length(all_groups)
n_comps <- length(resolved)

cat("\nAll unique GROUPs (", n_groups, "):", paste(all_groups, collapse=", "), "\n")

contrast_matrix <- matrix(0, nrow = n_comps, ncol = n_groups)
colnames(contrast_matrix) <- all_groups
row_names <- character(n_comps)

for (i in seq_len(n_comps)) {
    rc <- resolved[[i]]
    g1_grps <- rc$group1
    g2_grps <- rc$group2
    row_names[i] <- rc$label

    # Verify groups exist in data
    missing_g1 <- setdiff(g1_grps, all_groups)
    missing_g2 <- setdiff(g2_grps, all_groups)
    if (length(missing_g1) > 0) {
        cat("WARNING:", rc$label, "- Group 1 GROUPs not in data:", paste(missing_g1, collapse=", "), "\n")
    }
    if (length(missing_g2) > 0) {
        cat("WARNING:", rc$label, "- Group 2 GROUPs not in data:", paste(missing_g2, collapse=", "), "\n")
    }

    # Set +1 for Group 1 GROUPs, -1 for Group 2 GROUPs
    valid_g1 <- intersect(g1_grps, all_groups)
    valid_g2 <- intersect(g2_grps, all_groups)
    if (length(valid_g1) > 0) contrast_matrix[i, valid_g1] <- 1
    if (length(valid_g2) > 0) contrast_matrix[i, valid_g2] <- -1
}
rownames(contrast_matrix) <- row_names

cat("\nContrast matrix:\n")
print(contrast_matrix)
cat("Using", num_cores, "cores for parallel processing\n")
flush.console()

# Call MSstats::groupComparison
cat("Calling MSstats::groupComparison...\n")
flush.console()

group_comp <- tryCatch({
    MSstats::groupComparison(
        contrast.matrix = contrast_matrix,
        data = processed,
        log_base = log_base,
        numberOfCores = num_cores,
        save_fitted_models = save_fitted_models,
        use_log_file = FALSE,
        verbose = FALSE
    )
}, error = function(e) {
    cat("MSstats::groupComparison failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("groupComparison complete\n")
flush.console()

# Extract ComparisonResult dataframe
comparison_result <- group_comp$ComparisonResult
if (is.null(comparison_result)) {
    stop("No ComparisonResult found in groupComparison output")
}
cat("ComparisonResult rows:", nrow(comparison_result), "\n")
cat("ComparisonResult columns:", paste(names(comparison_result), collapse = ", "), "\n")
cat("Unique comparisons (Label column):", paste(unique(comparison_result$Label), collapse = ", "), "\n")
flush.console()

# Rename columns to match msqrob2 format
name_mapping <- list(
    "Protein" = "Master_Protein_Accessions",
    "log2FC" = "logFC",
    "pvalue" = "pval",
    "adj.pvalue" = "adjPval",
    "SE" = "se"
)

for (old_name in names(name_mapping)) {
    new_name <- name_mapping[[old_name]]
    if (old_name %in% names(comparison_result)) {
        names(comparison_result)[names(comparison_result) == old_name] <- new_name
        cat("Renamed:", old_name, "->", new_name, "\n")
    }
}

# Ensure required columns exist
required_cols <- c("Master_Protein_Accessions", "logFC", "pval", "adjPval")
for (col in required_cols) {
    if (!(col %in% names(comparison_result))) {
        alt_names <- list(
            "Master_Protein_Accessions" = c("Protein", "ProteinName"),
            "logFC" = c("log2FC", "log2FoldChange", "Estimate"),
            "pval" = c("pvalue", "p.value", "pValue"),
            "adjPval" = c("adj.pvalue", "adjPVal", "qvalue", "padj")
        )
        alts <- alt_names[[col]]
        found <- FALSE
        for (alt in alts) {
            if (alt %in% names(comparison_result)) {
                names(comparison_result)[names(comparison_result) == alt] <- col
                cat("Found alternative:", alt, "->", col, "\n")
                found <- TRUE
                break
            }
        }
        if (!found) {
            cat("Warning: Could not find column for", col, ", adding NA\n")
            comparison_result[[col]] <- NA
        }
    }
}

# Load gene mapping
protein_ids <- comparison_result$Master_Protein_Accessions

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")

    gene_map <- fread(gene_mapping_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)

    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL

    if (is.null(gene_col) && "Gene Names" %in% names(gene_map)) {
        gene_col <- "Gene Names"
    }

    if (!is.null(entry_col) && !is.null(gene_col)) {
        cat("Using entry column:", entry_col, "and gene column:", gene_col, "\n")
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA)
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])

        all_ids <- strsplit(as.character(protein_ids), ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)
        flat_mapped <- mapping[flat_ids_base]
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(non_na, collapse = ";") else NA
        })

        comparison_result$Gene_Name <- gene_names
        cat("Mapped gene names for", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
    } else {
        cat("Warning: Gene mapping file has unexpected columns:", paste(names(gene_map), collapse = ", "), "\n")
        comparison_result$Gene_Name <- NA
    }
} else {
    cat("No gene mapping file provided, using protein IDs as gene names\n")
    comparison_result$Gene_Name <- sub("-\\d+$", "", as.character(protein_ids))
}

# Handle NA gene names
comparison_result$Gene_Name[is.na(comparison_result$Gene_Name)] <- sub("-\\d+$", "", protein_ids[is.na(comparison_result$Gene_Name)])

# Add PSM_Count from the converted object
if (!is.null(converted$quantificationData) && "ProteinName" %in% names(converted$quantificationData)) {
    psm_table <- table(converted$quantificationData$ProteinName)
    protein_idx <- match(as.character(protein_ids), names(psm_table))
    comparison_result$PSM_Count <- as.integer(psm_table[protein_idx])
    comparison_result$PSM_Count[is.na(comparison_result$PSM_Count)] <- 0
    cat("Mapped PSM counts for", sum(comparison_result$PSM_Count > 0), "of", length(protein_ids), "proteins\n")
} else if ("NumMeasurements" %in% names(comparison_result)) {
    comparison_result$PSM_Count <- comparison_result$NumMeasurements
} else {
    comparison_result$PSM_Count <- 0L
}

# Reorder columns
col_order <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count", "logFC", "pval", "adjPval", "se")
cols_present <- intersect(col_order, names(comparison_result))
other_cols <- setdiff(names(comparison_result), cols_present)
comparison_result <- comparison_result[, c(cols_present, other_cols)]

# Ensure output directory exists
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# Split results by Label (comparison name) and write per-comparison files
cat("\nWriting per-comparison results...\n")
labels <- unique(comparison_result$Label)
for (label in labels) {
    subset_result <- comparison_result[comparison_result$Label == label, ]
    # Build output filename: Diff_Expression_<treatment>_vs_<control>.tsv
    out_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))

    # Remove the Label column from output (redundant with filename)
    if ("Label" %in% names(subset_result)) {
        subset_result$Label <- NULL
    }

    cat("Writing:", out_file, "(", nrow(subset_result), "proteins)\n")
    write.table(
        subset_result,
        file = out_file,
        sep = "\t",
        row.names = FALSE,
        quote = FALSE
    )

    # Print summary
    cat("  Total proteins:", nrow(subset_result), "\n")
    if ("adjPval" %in% names(subset_result)) {
        cat("  Significant (adjPval < 0.05):", sum(subset_result$adjPval < 0.05, na.rm = TRUE), "\n")
    }
    if ("logFC" %in% names(subset_result)) {
        cat("  Upregulated:", sum(subset_result$logFC > 0 & subset_result$adjPval < 0.05, na.rm = TRUE), "\n")
        cat("  Downregulated:", sum(subset_result$logFC < 0 & subset_result$adjPval < 0.05, na.rm = TRUE), "\n")
    }
}

cat("\nStep 7 complete: MSstats multi-condition differential expression analysis finished successfully\n")
