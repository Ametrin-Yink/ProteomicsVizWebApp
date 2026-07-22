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
output_shard  <- if (!is.null(config$output_shard)) as.integer(config$output_shard) else NULL
batch_column  <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata      <- if (!is.null(config$metadata)) config$metadata else list()

if (is.na(n_cores) || n_cores < 1L) n_cores <- 1L

cat("Config: ridge=", ridge, " maxitRob=", maxitRob, " adjust=", adjust_method,
    " n_cores=", n_cores, " batch=", ifelse(is.null(batch_column), "none", batch_column), "\n")
cat(sprintf("[TIMING] de_start %s", Sys.time()), "\n", file=stderr())
flush.console()

# Detect pre-fitted RDS / save-fitted modes
skip_fit <- isTRUE(config$skip_fit)
save_fitted_rds <- isTRUE(config$save_fitted_rds)

if (save_fitted_rds) {
    cat("Save-fitted mode — will save fitted model to MSqRob2_Fitted.rds and exit\n")
    flush.console()
}
if (skip_fit) {
    cat("Pre-fitted RDS — skipping msqrob() model fitting\n")
    flush.console()
}

# Load QFeatures RDS from step 3
if (!file.exists(rds_file)) stop(paste("RDS file not found:", rds_file))
pe <- readRDS(rds_file)
cat("Loaded QFeatures:", nrow(pe[["protein"]]), "proteins,", ncol(pe[["protein"]]), "samples\n")
cat(sprintf("[TIMING] rds_load_done %s", Sys.time()), "\n", file=stderr())
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
    # Use custom label if provided (enables benchmarking with duplicate comparisons)
    label <- if (!is.null(comp$label) && nzchar(comp$label)) comp$label else paste0(g1_label, "_vs_", g2_label)
    comparison_labels[i] <- label
    all_condition_values <- c(all_condition_values, g1_values, g2_values)
    cat("  Comparison", i, ":", comparison_labels[i], "\n")
}
cat(sprintf("[TIMING] comparisons_parsed %s n=%d", Sys.time(), length(comparisons)), "\n", file=stderr())
flush.console()

# ==========================================================================
# Assign conditions to samples using metadata entries
# ==========================================================================
# Helper: match value as an underscore-delimited token in sample name.
# Prevents substring mismatches like "4h" matching inside "24h".
match_token <- function(value, sname) {
  grepl(paste0("(^|_)", value, "($|_)"), sname)
}

# For multi-condition comparisons, each metadata entry has condition_1, condition_2, etc.
# We build a combined condition string per sample (e.g. "Jurkat_INCB224525_24h")
# to match the comparison group format.
assign_condition <- function(sample_names, metadata) {
  conditions <- character(length(sample_names))
  for (i in seq_along(sample_names)) {
    sname <- sample_names[i]
    matched <- FALSE
    for (fname in names(metadata)) {
      entry <- metadata[[fname]]
      # Support both "condition_1"/"condition_2" (multi-condition) and
      # "condition" (single condition, no numeric suffix) formats.
      cond_keys <- grep("^condition_", names(entry), value = TRUE)
      if (length(cond_keys) == 0) {
        # Fall back to plain "condition" key
        if ("condition" %in% names(entry)) {
          cond_keys <- "condition"
        } else {
          next
        }
      }
      cond_vals <- as.character(unlist(entry[cond_keys]))
      cond_vals <- cond_vals[nzchar(cond_vals)]
      if (length(cond_vals) > 0 &&
          all(vapply(cond_vals, function(v) match_token(v, sname), logical(1)))) {
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
            if (match_token(cond, sname)) return(cond)
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
          all(vapply(cond_vals, function(v) match_token(v, sname), logical(1)))) {
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
# Detect confounding: batch is confounded if every condition level maps to
# exactly one batch level. In that case including batch in the formula makes
# the model matrix rank-deficient — coefficients for one cell type go to NA.
# ==========================================================================
if (has_batch) {
    cond_batch_map <- table(col_data$condition, col_data$batch)
    batches_per_condition <- apply(cond_batch_map, 1, function(r) sum(r > 0))
    n_cond_with_multi_batch <- sum(batches_per_condition > 1)
    if (n_cond_with_multi_batch == 0) {
        cat("WARNING: batch is perfectly confounded with condition (each condition",
            "maps to exactly one batch level). Dropping batch from model formula",
            "to avoid inestimable coefficients.\n")
        has_batch <- FALSE
    } else {
        cat("Batch has", n_cond_with_multi_batch, "condition(s) spanning multiple",
            "batches — keeping batch in model.\n")
    }
}
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
if (!skip_fit) {
    register(BPPARAM)

    # Fit model via msqrob v1.16 API
    cat("\nFitting msqrob model...\n")
    cat(sprintf("[TIMING] model_fit_start %s", Sys.time()), "\n", file=stderr())
    flush.console()

    pe <- msqrob(object = pe, i = "protein", formula = model_formula,
                 robust = TRUE, ridge = ridge, maxitRob = maxitRob)

    cat("Model fitted. rowData columns:", paste(colnames(rowData(pe[["protein"]])), collapse = ", "), "\n")
    cat(sprintf("[TIMING] model_fit_done %s", Sys.time()), "\n", file=stderr())
    flush.console()

    # Save fitted QFeatures for batched reuse (Phase A)
    if (save_fitted_rds) {
        fitted_rds_path <- file.path(output_dir, "MSqRob2_Fitted.rds")
        saveRDS(pe, file = fitted_rds_path)
        cat("Fitted RDS saved to:", fitted_rds_path, "\n")
        cat("Save-fitted mode complete — exiting (comparisons skipped)\n")
        cat(sprintf("[TIMING] de_complete %s", Sys.time()), "\n", file=stderr())
        flush.console()
        quit(save = "no", status = 0)
    }
} else {
    cat("Using pre-fitted model from RDS — skipping msqrob()\n")
    flush.console()
}

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

output_name <- if (is.null(output_shard)) {
    "Differential_Results_Long.tsv"
} else {
    sprintf("Differential_Results_Shard_%05d.tsv", output_shard)
}
output_file <- file.path(output_dir, output_name)
if (file.exists(output_file)) file.remove(output_file)

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
        all(vapply(g1_values, function(v) match_token(v, lv), logical(1)))
    }, logical(1))]
    cond_y <- cond_levels[vapply(cond_levels, function(lv) {
        all(vapply(g2_values, function(v) match_token(v, lv), logical(1)))
    }, logical(1))]

    if (length(cond_x) == 0) cond_x <- paste(g1_values, collapse = "_")
    if (length(cond_y) == 0) cond_y <- paste(g2_values, collapse = "_")
    cond_x <- cond_x[1]
    cond_y <- cond_y[1]

    # model.matrix(~ 0 + condition) prefixes level names with "condition"
    param_x <- paste0("condition", cond_x)
    param_y <- paste0("condition", cond_y)

    contrast_str <- paste0(param_x, " - ", param_y, " = 0")
    cat("  Comparison", i, ":", contrast_str, "\n")
    flush.console()

    L <- makeContrast(contrast_str, c(param_x, param_y))

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

    results_out$Label <- label
    write_header <- !file.exists(output_file)
    write.table(results_out, file = output_file, sep = "\t",
                row.names = FALSE, quote = FALSE, na = "NA",
                append = !write_header, col.names = write_header)

    sig_count <- sum(results_out$adjPval < 0.05, na.rm = TRUE)
    cat("    ", label, ":", nrow(results_out), "proteins,", sig_count, "significant\n")

    if (i %% 100 == 0 || i == length(comparisons)) {
        cat(sprintf("[TIMING] comparisons_done %d/%d %s", i, length(comparisons), Sys.time()), "\n", file=stderr())
    }
}

cat(sprintf("[TIMING] de_complete %s", Sys.time()), "\n", file=stderr())
cat("\nStep 4 complete: msqrob2 differential expression finished successfully\n")
flush.console()
