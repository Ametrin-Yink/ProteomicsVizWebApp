#!/usr/bin/env Rscript
#
# msqrob2 Group Comparison (Step 4 — consolidated pipeline, v1.16 API)
#
# Loads QFeatures RDS from step 3, runs msqrob() for model fitting,
# makeContrast() + hypothesisTest() for differential expression.
#
# Usage: Rscript msqrob2_group_comparison_multi.R <qfeatures_rds> <output_dir>
#        <comparisons_json> <gene_mapping_file> <config_json>
#
# Config fields: ridge, maxitRob, adjust_method, numberOfCores, batch_column, metadata

suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(matrixStats)
    library(jsonlite)
    library(BiocParallel)
})

# Parse args
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    stop("Usage: Rscript msqrob2_group_comparison_multi.R <qfeatures_rds> <output_dir> <comparisons_json> <gene_mapping_file> <config_json>")
}

rds_file          <- args[1]
output_dir        <- args[2]
comparisons_json  <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json       <- if (nzchar(args[5])) args[5] else "{}"

cat("Step 4 (msqrob2): Differential expression analysis\n")
cat("RDS file:", rds_file, "\n")
flush.console()

# Parse config
config <- tryCatch(
    fromJSON(config_json, simplifyVector = FALSE),
    error = function(e) { cat("Warning: Could not parse config JSON\n"); list() }
)

ridge         <- if (!is.null(config$ridge)) isTRUE(as.logical(config$ridge)) else FALSE
maxitRob      <- if (!is.null(config$maxitRob)) as.integer(config$maxitRob) else 10L
adjust_method <- if (!is.null(config$adjust_method)) as.character(config$adjust_method) else "BH"
n_cores       <- if (!is.null(config$numberOfCores)) as.integer(config$numberOfCores) else 1L
batch_column  <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata      <- if (!is.null(config$metadata)) config$metadata else list()

if (is.na(n_cores) || n_cores < 1L) n_cores <- 1L

cat("Config: ridge=", ridge, " maxitRob=", maxitRob, " adjust=", adjust_method,
    " n_cores=", n_cores, " batch=", ifelse(is.null(batch_column), "none", batch_column), "\n")
flush.console()

# Load QFeatures RDS from step 3
if (!file.exists(rds_file)) stop(paste("RDS file not found:", rds_file))
pe <- readRDS(rds_file)
cat("Loaded QFeatures:", nrow(pe[["protein"]]), "proteins,", ncol(pe[["protein"]]), "samples\n")
flush.console()

# Extract sample names from protein assay (QFeatures colnames returns CharacterList)
protein_matrix <- assay(pe[["protein"]])
sample_names <- colnames(protein_matrix)
sample_names <- as.character(sample_names)
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ==========================================================================
# Parse comparisons
# ==========================================================================
cat("\nParsing comparisons...\n")
comparisons <- tryCatch(
    fromJSON(comparisons_json, simplifyVector = FALSE),
    error = function(e) stop("Failed to parse comparisons JSON: ", conditionMessage(e))
)
if (length(comparisons) == 0) stop("No comparisons provided")

all_condition_values <- character(0)
comparison_labels <- character(length(comparisons))
for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    if (is.null(comp$group1) || is.null(comp$group2))
        stop(paste("Comparison", i, "missing group1 or group2"))
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))
    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    comparison_labels[i] <- paste0(g1_label, "_vs_", g2_label)
    all_condition_values <- c(all_condition_values, g1_values, g2_values)
    cat("  Comparison", i, ":", comparison_labels[i], "\n")
}
flush.console()

# ==========================================================================
# Assign conditions to samples using metadata entries
# ==========================================================================
# For multi-condition comparisons, each metadata entry has condition_1, condition_2, etc.
# We build a combined condition string per sample (e.g. "Jurkat+INCB224525+24h")
# to match the comparison group format.
assign_condition <- function(sample_names, metadata) {
  conditions <- character(length(sample_names))
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in names(metadata)) {
      entry <- metadata[[fname]]
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) next
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1)))) {
        conditions[i] <- paste(cond_vals, collapse = "_")
        matched <- TRUE
        break
      }
    }
    if (!matched) conditions[i] <- NA_character_
  }
  conditions
}

if (length(metadata) > 0) {
    col_data <- data.frame(sample = sample_names, stringsAsFactors = FALSE)
    col_data$condition <- assign_condition(sample_names, metadata)
} else {
    # Fallback: use grepl matching against comparison values (legacy)
    unique_conditions <- unique(all_condition_values)
    unique_conditions <- unique_conditions[order(-nchar(unique_conditions))]
    col_data <- data.frame(sample = sample_names, stringsAsFactors = FALSE)
    col_data$condition <- vapply(sample_names, function(sname) {
        for (cond in unique_conditions) {
            if (grepl(cond, sname, ignore.case = TRUE, fixed = TRUE)) return(cond)
        }
        return(NA_character_)
    }, character(1), USE.NAMES = FALSE)
}

if (any(is.na(col_data$condition)))
    stop("Could not assign condition for: ", paste(sample_names[is.na(col_data$condition)], collapse = ", "))

col_data$condition <- factor(col_data$condition)
cat("Condition distribution:\n")
print(table(col_data$condition))
flush.console()

# ==========================================================================
# Batch vector builder
# ==========================================================================
build_batch_vector <- function(sample_names, metadata, batch_col) {
  batch_values <- rep(NA_character_, length(sample_names))
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in names(metadata)) {
      entry <- metadata[[fname]]
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) next
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1)))) {
        bv <- entry[[batch_col]]
        if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
        break
      }
    }
    if (!matched) {
      for (fname in names(metadata)) {
        exp_val <- entry[["experiment"]]
        if (!is.null(exp_val) && nzchar(exp_val) && grepl(exp_val, sname, fixed = TRUE)) {
          bv <- entry[[batch_col]]
          if (!is.null(bv) && nzchar(bv)) { batch_values[i] <- bv; matched <- TRUE }
          break
        }
      }
    }
  }
  if (any(is.na(batch_values)))
    stop("Could not assign batch for: ", paste(sample_names[is.na(batch_values)], collapse=", "))
  as.factor(batch_values)
}

# ==========================================================================
# Assign batch if configured
# ==========================================================================
has_batch <- !is.null(batch_column) && length(metadata) > 0
if (has_batch) {
    cat("\nAssigning batch from column '", batch_column, "'...\n", sep = "")
    col_data$batch <- build_batch_vector(sample_names, metadata, batch_column)
    cat("Batch distribution:\n")
    print(table(col_data$batch))
}

# Set colData on QFeatures object — use protein assay sample names as row names
colData(pe) <- DataFrame(col_data, row.names = sample_names)
cat("colData set. Columns:", paste(colnames(colData(pe)), collapse = ", "), "\n")
flush.console()

# ==========================================================================
# Build formula and fit model
# ==========================================================================
model_formula <- if (has_batch) {
    as.formula("~ 0 + condition + batch")
} else {
    as.formula("~ 0 + condition")
}
cat("Formula:", deparse(model_formula), "\n")

# Register BiocParallel
if (n_cores > 1L) {
    BPPARAM <- tryCatch(
        SnowParam(workers = n_cores, progressbar = TRUE),
        error = function(e) { message("SnowParam failed, using SerialParam"); SerialParam() }
    )
} else {
    BPPARAM <- SerialParam()
}
register(BPPARAM)

# Fit model via msqrob v1.16 API
cat("\nFitting msqrob model...\n")
flush.console()

pe <- msqrob(object = pe, i = "protein", formula = model_formula,
             robust = TRUE, ridge = ridge, maxitRob = maxitRob)

cat("Model fitted. rowData columns:", paste(colnames(rowData(pe[["protein"]])), collapse = ", "), "\n")
flush.console()

# ==========================================================================
# Pre-identify zero-variance proteins
# ==========================================================================
protein_vars <- rowVars(assay(pe[["protein"]]), na.rm = TRUE)
zero_var_mask <- (!is.na(protein_vars) & protein_vars < 1e-10)
zero_var_ids <- if (any(zero_var_mask)) rownames(pe[["protein"]])[zero_var_mask] else character(0)
cat("Zero-variance proteins:", length(zero_var_ids), "\n")

# ==========================================================================
# Run comparisons
# ==========================================================================
cat("\nRunning comparisons...\n")
flush.console()

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    g1_values <- as.character(unlist(comp$group1))
    g2_values <- as.character(unlist(comp$group2))
    g1_label <- paste(g1_values, collapse = "+")
    g2_label <- paste(g2_values, collapse = "+")
    label <- comparison_labels[i]

    # Find condition factor levels matching group values
    cond_levels <- levels(colData(pe)$condition)

    # Match each group's values against condition levels
    cond_x <- cond_levels[vapply(cond_levels, function(lv) {
        all(vapply(g1_values, function(v) grepl(v, lv, fixed = TRUE), logical(1)))
    }, logical(1))]
    cond_y <- cond_levels[vapply(cond_levels, function(lv) {
        all(vapply(g2_values, function(v) grepl(v, lv, fixed = TRUE), logical(1)))
    }, logical(1))]

    if (length(cond_x) == 0) cond_x <- paste(g1_values, collapse = "_")
    if (length(cond_y) == 0) cond_y <- paste(g2_values, collapse = "_")
    cond_x <- cond_x[1]
    cond_y <- cond_y[1]

    contrast_str <- paste0(cond_x, " - ", cond_y, " = 0")
    cat("  Comparison", i, ":", contrast_str, "\n")
    flush.console()

    L <- makeContrast(contrast_str, c(cond_x, cond_y))

    pe <- hypothesisTest(pe, i = "protein", contrast = L,
                         adjust.method = adjust_method, overwrite = TRUE)

    # Extract results from rowData
    result_col <- colnames(L)[1]
    results <- as.data.frame(rowData(pe[["protein"]])[[result_col]])

    # Map to output contract columns
    results$Master_Protein_Accessions <- rownames(results)
    results$Gene_Name <- rowData(pe[["protein"]])$Gene_Name
    results$PSM_Count <- rowData(pe[["protein"]])$PSM_Count

    out_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count",
                  "logFC", "pval", "adjPval", "se", "df")
    results_out <- results[, out_cols, drop = FALSE]

    # Overwrite zero-variance protein rows with NA p-values
    if (length(zero_var_ids) > 0) {
        zv_in_results <- intersect(zero_var_ids, results_out$Master_Protein_Accessions)
        if (length(zv_in_results) > 0) {
            idx <- match(zv_in_results, results_out$Master_Protein_Accessions)
            results_out$logFC[idx] <- 0
            results_out$pval[idx] <- NA_real_
            results_out$adjPval[idx] <- NA_real_
            results_out$se[idx] <- NA_real_
            results_out$df[idx] <- NA_integer_
        }
    }

    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    write.table(results_out, file = output_file, sep = "\t",
                row.names = FALSE, quote = FALSE, na = "NA")

    sig_count <- sum(results_out$adjPval < 0.05, na.rm = TRUE)
    cat("    ", label, ":", nrow(results_out), "proteins,", sig_count, "significant\n")
}

cat("\nStep 4 complete: msqrob2 differential expression finished successfully\n")
flush.console()
