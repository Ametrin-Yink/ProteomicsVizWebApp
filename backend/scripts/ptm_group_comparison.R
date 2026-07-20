#!/usr/bin/env Rscript
#
# PTM Group Comparison — MSstatsPTM groupComparisonPTM
#
# Loads summarized RDS from the PTM summarization step (list with PTM and
# PROTEIN elements), builds a contrast matrix from comparisons JSON, and
# runs MSstatsPTM::groupComparisonPTM().
#
# Outputs three TSV files per comparison label:
#   PTM_Model_{label}.tsv       — PTM-level model results
#   PROTEIN_Model_{label}.tsv   — Protein-level model results (if available)
#   ADJUSTED_Model_{label}.tsv  — PTM - Protein adjusted results (if available)
#
# Usage: Rscript ptm_group_comparison.R <rds_file> <output_dir>
#        <comparisons_json> <config_json>
#
# Config fields: ptm_label_type, protein_label_type, adj_method, moderated

cat("[PTM Group Comparison] Loading R packages...\n")
suppressPackageStartupMessages({
    library(MSstatsPTM)
    library(data.table)
    library(jsonlite)
    library(methods)
})
cat("[PTM Group Comparison] R packages loaded\n")
flush.console()

# ============================================================================
# Parse command line arguments
# ============================================================================
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 4) {
    stop("Usage: Rscript ptm_group_comparison.R <rds_file> <output_dir> ",
         "<comparisons_json> <config_json>")
}

rds_file         <- args[1]
output_dir       <- args[2]
comparisons_json <- args[3]
# group_comparison_multi() inserts a gene_mapping_file placeholder
# before config_json, so config may be at args[4] (direct call)
# or args[5] (called via BaseRWrapper.group_comparison_multi).
config_json <- if (length(args) >= 5 && nzchar(args[5])) {
    args[5]
} else if (nzchar(args[4])) {
    args[4]
} else {
    "{}"
}

cat("[PTM Group Comparison] Arguments:\n")
cat("  RDS file:", rds_file, "\n")
cat("  Output dir:", output_dir, "\n")
cat("  Config JSON:", config_json, "\n")
flush.console()

# ============================================================================
# Parse config
# ============================================================================
cat("[PTM Group Comparison] Parsing config...\n")
config <- tryCatch(
    fromJSON(config_json, simplifyVector = FALSE),
    error = function(e) {
        cat("Warning: Could not parse config JSON — using defaults\n")
        list()
    }
)

ptm_label_type     <- if (!is.null(config$ptm_label_type)) as.character(config$ptm_label_type) else "LF"
protein_label_type <- if (!is.null(config$protein_label_type)) as.character(config$protein_label_type) else "LF"
adj_method         <- if (!is.null(config$adj_method)) as.character(config$adj_method) else "BH"
moderated          <- if (!is.null(config$moderated)) isTRUE(as.logical(config$moderated)) else FALSE

cat("[PTM Group Comparison] Configuration:\n")
cat("  ptm_label_type:", ptm_label_type, "\n")
cat("  protein_label_type:", protein_label_type, "\n")
cat("  adj_method:", adj_method, "\n")
cat("  moderated:", moderated, "\n")
flush.console()

# ============================================================================
# Load summarized RDS
# ============================================================================
cat("[PTM Group Comparison] Loading summarized RDS...\n")
if (!file.exists(rds_file)) {
    stop("RDS file not found: ", rds_file)
}

summarized <- readRDS(rds_file)

# Validate structure: must have PTM element with ProteinLevelData
if (is.null(summarized$PTM)) {
    stop("RDS does not contain a 'PTM' element")
}
if (is.null(summarized$PTM$ProteinLevelData)) {
    stop("RDS$PTM does not contain ProteinLevelData")
}

cat("[PTM Group Comparison] Loaded summarized data:\n")
ptm_feature_count <- if (!is.null(summarized$PTM$FeatureLevelData)) nrow(summarized$PTM$FeatureLevelData) else 0
ptm_protein_count <- nrow(summarized$PTM$ProteinLevelData)
cat("  PTM feature-level rows:", ptm_feature_count, "\n")
cat("  PTM protein-level rows:", ptm_protein_count, "\n")

if (!is.null(summarized$PROTEIN)) {
    protein_feature_count <- if (!is.null(summarized$PROTEIN$FeatureLevelData)) nrow(summarized$PROTEIN$FeatureLevelData) else 0
    protein_protein_count <- if (!is.null(summarized$PROTEIN$ProteinLevelData)) nrow(summarized$PROTEIN$ProteinLevelData) else 0
    cat("  PROTEIN feature-level rows:", protein_feature_count, "\n")
    cat("  PROTEIN protein-level rows:", protein_protein_count, "\n")
} else {
    cat("  PROTEIN data: not present\n")
}
flush.console()

# ============================================================================
# Get unique condition names from PTM ProteinLevelData
# ============================================================================
pdata <- summarized$PTM$ProteinLevelData

# Determine the condition column name
condition_col <- if ("GROUP" %in% names(pdata)) "GROUP" else
                 if ("Condition" %in% names(pdata)) "Condition" else
                 if ("group" %in% names(pdata)) "group" else
                 if ("condition" %in% names(pdata)) "condition" else NULL

if (is.null(condition_col)) {
    stop("Could not find condition column in PTM ProteinLevelData. ",
         "Available columns: ", paste(names(pdata), collapse = ", "))
}

condition_levels <- unique(as.character(pdata[[condition_col]]))
condition_levels <- sort(condition_levels[!is.na(condition_levels) & nzchar(condition_levels)])

cat("[PTM Group Comparison] Condition levels (", length(condition_levels), "):\n",
    paste(condition_levels, collapse = ", "), "\n", sep = "")
flush.console()

# ============================================================================
# Parse comparisons
# ============================================================================
cat("[PTM Group Comparison] Parsing comparisons...\n")
comparisons <- tryCatch(
    fromJSON(comparisons_json, simplifyVector = FALSE),
    error = function(e) stop("Failed to parse comparisons JSON: ", conditionMessage(e))
)

if (length(comparisons) == 0) stop("No comparisons provided")

cat("[PTM Group Comparison] Number of comparisons:", length(comparisons), "\n")
flush.console()

# ============================================================================
# Build contrast matrix using MSstats::MSstatsContrastMatrix
# ============================================================================
# Build a named list of comparison vectors: each entry is c(group1, group2)
comparison_list <- list()
comparison_labels <- character(length(comparisons))

match_condition_levels <- function(values, group_label) {
    exact_key <- paste(values, collapse = "_")
    matched <- condition_levels[condition_levels == exact_key]
    if (length(matched) == 0) {
        matched <- condition_levels[vapply(condition_levels, function(level) {
            all(vapply(values, function(value) grepl(value, level, fixed = TRUE), logical(1)))
        }, logical(1))]
    }
    if (length(matched) > 1) {
        stop(group_label, " ambiguously matches conditions: ", paste(matched, collapse = ", "))
    }
    if (length(matched) == 0) {
        cat("  WARNING:", group_label, "did not match any condition level. Values:",
            paste(values, collapse = "+"), "\n")
        return(values)
    }
    matched
}

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]

    if (is.null(comp$group1) || is.null(comp$group2)) {
        stop("Comparison ", i, " missing group1 or group2")
    }

    # Extract values from group dicts (e.g. {Condition: "Treatment"})
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))

    g1_matched <- match_condition_levels(g1_values, paste("Comparison", i, "group1"))
    g2_matched <- match_condition_levels(g2_values, paste("Comparison", i, "group2"))

    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    label <- paste0(g1_label, "_vs_", g2_label)
    comparison_labels[i] <- label

    # MSstatsContrastMatrix format: list(comparison_name = c(group1, group2))
    # group1 gets +1, group2 gets -1
    comparison_list[[label]] <- c(g1_matched, g2_matched)

    cat("  Comparison", i, ":", label, "\n")
    cat("    Group1:", paste(g1_matched, collapse = ", "), "\n")
    cat("    Group2:", paste(g2_matched, collapse = ", "), "\n")
}
flush.console()

# Build contrast matrix
cat("[PTM Group Comparison] Building contrast matrix...\n")
contrast_matrix <- MSstats::MSstatsContrastMatrix(
    comparison_list,
    conditions = condition_levels
)

cat("Contrast matrix:\n")
print(contrast_matrix)
flush.console()

# ============================================================================
# Run groupComparisonPTM
# ============================================================================
cat("[PTM Group Comparison] Running MSstatsPTM::groupComparisonPTM...\n")
flush.console()

result <- tryCatch({
    groupComparisonPTM(
        data                = summarized,
        contrast.matrix     = contrast_matrix,
        ptm_label_type      = ptm_label_type,
        protein_label_type  = protein_label_type,
        moderated           = moderated,
        adj.method          = adj_method,
        save_fitted_models  = TRUE,
        log_base            = 2
    )
}, error = function(e) {
    cat("[PTM Group Comparison] groupComparisonPTM failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("[PTM Group Comparison] groupComparisonPTM complete\n")
flush.console()

# ============================================================================
# Write output TSV files
# ============================================================================
cat("[PTM Group Comparison] Writing output files...\n")
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

for (i in seq_along(comparison_labels)) {
    label <- comparison_labels[i]
    model_label <- rownames(contrast_matrix)[i]

    # --- PTM Model ---
    if (!is.null(result$PTM.Model)) {
        ptm_model <- result$PTM.Model
        if ("Label" %in% names(ptm_model)) {
            ptm_subset <- ptm_model[ptm_model$Label == model_label, , drop = FALSE]
        } else {
            ptm_subset <- ptm_model
        }
        if (nrow(ptm_subset) > 0) {
            ptm_file <- file.path(output_dir, paste0("PTM_Model_", label, ".tsv"))
            write.table(ptm_subset, file = ptm_file, sep = "\t",
                        row.names = FALSE, quote = FALSE, na = "NA")
            cat("  PTM_Model_", label, ".tsv: ", nrow(ptm_subset), " rows\n", sep = "")
        } else {
            cat("  PTM_Model_", label, ".tsv: no data (skipped)\n", sep = "")
        }
    } else {
        cat("  PTM_Model_", label, ".tsv: PTM.Model is NULL (skipped)\n", sep = "")
    }

    # --- PROTEIN Model ---
    if (!is.null(result$PROTEIN.Model)) {
        protein_model <- result$PROTEIN.Model
        if ("Label" %in% names(protein_model)) {
            protein_subset <- protein_model[protein_model$Label == model_label, , drop = FALSE]
        } else {
            protein_subset <- protein_model
        }
        if (nrow(protein_subset) > 0) {
            protein_file <- file.path(output_dir, paste0("PROTEIN_Model_", label, ".tsv"))
            write.table(protein_subset, file = protein_file, sep = "\t",
                        row.names = FALSE, quote = FALSE, na = "NA")
            cat("  PROTEIN_Model_", label, ".tsv: ", nrow(protein_subset), " rows\n", sep = "")
        } else {
            cat("  PROTEIN_Model_", label, ".tsv: no data (skipped)\n", sep = "")
        }
    } else {
        cat("  PROTEIN_Model_", label, ".tsv: PROTEIN.Model is NULL (skipped)\n", sep = "")
    }

    # --- ADJUSTED Model ---
    if (!is.null(result$ADJUSTED.Model)) {
        adjusted_model <- result$ADJUSTED.Model
        if ("Label" %in% names(adjusted_model)) {
            adjusted_subset <- adjusted_model[adjusted_model$Label == model_label, , drop = FALSE]
        } else {
            adjusted_subset <- adjusted_model
        }
        if (nrow(adjusted_subset) > 0) {
            if ("Adjusted" %in% names(adjusted_subset)) {
                adjusted_subset <- adjusted_subset[adjusted_subset$Adjusted %in% TRUE, , drop = FALSE]
            }
        }
        if (nrow(adjusted_subset) > 0) {
            adjusted_file <- file.path(output_dir, paste0("ADJUSTED_Model_", label, ".tsv"))
            write.table(adjusted_subset, file = adjusted_file, sep = "\t",
                        row.names = FALSE, quote = FALSE, na = "NA")
            cat("  ADJUSTED_Model_", label, ".tsv: ", nrow(adjusted_subset), " rows\n", sep = "")
        } else {
            cat("  ADJUSTED_Model_", label, ".tsv: no data (skipped)\n", sep = "")
        }
    } else {
        cat("  ADJUSTED_Model_", label, ".tsv: ADJUSTED.Model is NULL (skipped)\n", sep = "")
    }
}

flush.console()

# ============================================================================
# Done
# ============================================================================
cat("[PTM Group Comparison] PTM group comparison completed successfully\n")
cat("PTM_GROUP_COMPARISON_COMPLETE\n")
flush.console()
