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
save_fitted_models <- if (!is.null(config$save_fitted_models)) as.logical(config$save_fitted_models) else FALSE

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

# Parse comparisons JSON
cat("Parsing comparisons JSON...\n")
comparisons <- fromJSON(comparisons_json)
cat("Number of comparisons:", nrow(comparisons), "\n")
for (i in 1:nrow(comparisons)) {
    cat("  Comparison", i, ":", comparisons$treatment[i], "vs", comparisons$control[i], "\n")
}
flush.console()

# Verify all comparison conditions exist
for (i in 1:nrow(comparisons)) {
    if (!(comparisons$treatment[i] %in% condition_levels)) {
        stop(paste("Treatment condition '", comparisons$treatment[i],
                   "' not found in data. Available:", paste(condition_levels, collapse = ", ")))
    }
    if (!(comparisons$control[i] %in% condition_levels)) {
        stop(paste("Control condition '", comparisons$control[i],
                   "' not found in data. Available:", paste(condition_levels, collapse = ", ")))
    }
}

# Build contrast matrix: one row per comparison
n_conditions <- length(condition_levels)
n_comparisons <- nrow(comparisons)
contrast_matrix <- matrix(0, nrow = n_comparisons, ncol = n_conditions)
colnames(contrast_matrix) <- condition_levels
rownames(contrast_matrix) <- paste(comparisons$treatment, "vs", comparisons$control, sep = "_")

for (i in 1:n_comparisons) {
    contrast_matrix[i, comparisons$treatment[i]] <- 1
    contrast_matrix[i, comparisons$control[i]] <- -1
}

cat("Contrast matrix:\n")
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
