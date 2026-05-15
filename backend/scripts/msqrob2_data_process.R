#!/usr/bin/env Rscript
#
# msqrob2 Data Process (Step 3 — consolidated pipeline)
#
# Reads PSM data (parquet/TSV), runs full QFeatures preprocessing pipeline,
# saves QFeatures RDS with colData for step 4 DE analysis.
#
# Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output>
#        <gene_mapping_file> <config_json>
#
# Config fields:
#   normalization, imputation, aggregation, min_peptides,
#   remove_razor, strict_filtering, numberOfCores, batch_column, metadata

cat("Step 3: msqrob2 data process (QFeatures pipeline)\n")
cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
    library(matrixStats)
    library(BiocParallel)
    library(jsonlite)
})
cat("R packages loaded\n")
flush.console()

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    stop("Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output> <gene_mapping_file> <config_json>")
}

input_file       <- args[1]
output_file      <- args[2]
rds_output       <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- args[5]

config <- fromJSON(config_json, simplifyVector = FALSE)

# Set defaults
if (is.null(config$normalization))  config$normalization  <- "center.median"
if (is.null(config$imputation))     config$imputation     <- "none"
if (is.null(config$aggregation))    config$aggregation    <- "robustSummary"
if (is.null(config$min_peptides))   config$min_peptides   <- 1
if (is.null(config$numberOfCores))  config$numberOfCores  <- 1
if (is.null(config$remove_razor))   config$remove_razor   <- FALSE
if (is.null(config$strict_filtering)) config$strict_filtering <- FALSE

batch_column <- if (!is.null(config$batch_column) && nzchar(config$batch_column)) config$batch_column else NULL
metadata     <- if (!is.null(config$metadata)) config$metadata else list()

cat("Configuration:\n")
cat("  normalization:", config$normalization, "\n")
cat("  imputation:", config$imputation, "\n")
cat("  aggregation:", config$aggregation, "\n")
cat("  min_peptides:", config$min_peptides, "\n")
cat("  remove_razor:", config$remove_razor, "\n")
cat("  strict_filtering:", config$strict_filtering, "\n")
cat("  numberOfCores:", config$numberOfCores, "\n")
cat("  batch_column:", ifelse(is.null(batch_column), "(none)", batch_column), "\n")
cat("Input file:", input_file, "\n")
flush.console()

if (!file.exists(input_file)) stop(paste("Input file not found:", input_file))

# ==========================================================================
# Read input data (auto-detect TSV vs Parquet)
# ==========================================================================
cat("Reading PSM data...\n")
if (grepl("\\.parquet$", input_file, ignore.case = TRUE)) {
    library(arrow)
    psm_data <- as.data.table(read_parquet(input_file))
    cat("Loaded", nrow(psm_data), "PSMs from Parquet\n")
} else {
    psm_data <- fread(input_file, sep = "\t", header = TRUE,
                      stringsAsFactors = FALSE, data.table = TRUE)
    cat("Loaded", nrow(psm_data), "PSMs from TSV\n")
}

# Filter empty accessions
cat("Filtering empty accessions...\n")
psm_data <- psm_data[Master_Protein_Accessions != "" & !is.na(Master_Protein_Accessions)]
cat("Filtered to", nrow(psm_data), "PSMs with valid accessions\n")
if (nrow(psm_data) == 0) stop("No PSMs with valid protein accessions")

# Remove contaminants and reverse sequences (if remove_razor configured)
if (isTRUE(config$remove_razor)) {
    if ("Contaminant" %in% names(psm_data)) {
        psm_data <- psm_data[is.na(Contaminant) | Contaminant != "+"]
        cat("After contaminant filter:", nrow(psm_data), "PSMs\n")
    }
    if ("Reverse" %in% names(psm_data)) {
        psm_data <- psm_data[is.na(Reverse) | Reverse != "+"]
        cat("After reverse filter:", nrow(psm_data), "PSMs\n")
    }
}
flush.console()

# ==========================================================================
# Reshape long->wide or detect wide format
# ==========================================================================
if ("Sample_Origination" %in% names(psm_data)) {
    cat("Data is in long format, reshaping to wide...\n")
    setDT(psm_data)
    psm_dt_agg <- psm_data[, .(Abundance = sum(Abundance, na.rm = TRUE)),
                           by = .(Unique_PSM, Master_Protein_Accessions, Sample_Origination)]
    cat("Aggregated to", nrow(psm_dt_agg), "rows\n")

    psm_wide <- dcast(psm_dt_agg,
                      Unique_PSM + Master_Protein_Accessions ~ Sample_Origination,
                      value.var = "Abundance", fun.aggregate = sum)
    setnames(psm_wide, names(psm_wide), gsub("^Abundance\\.", "", names(psm_wide)))
    cat("Wide format:", nrow(psm_wide), "rows x", ncol(psm_wide), "columns\n")

    sample_cols <- setdiff(names(psm_wide), c("Unique_PSM", "Master_Protein_Accessions"))
    for (col in sample_cols) {
        set(psm_wide, i = which(psm_wide[[col]] == 0), j = col, value = NA_real_)
    }

    all_na_mask <- rowSums(is.na(psm_wide[, ..sample_cols])) == length(sample_cols)
    if (sum(all_na_mask) > 0) psm_wide <- psm_wide[!all_na_mask]

    quant_col_indices <- which(!names(psm_wide) %in% c("Unique_PSM", "Master_Protein_Accessions"))
    pe <- readQFeatures(assayData = psm_wide, quantCols = quant_col_indices, name = "peptide")
    rowData(pe[["peptide"]])$Proteins <- psm_wide$Master_Protein_Accessions
} else {
    cat("Data is in wide format, identifying abundance columns...\n")
    abundance_cols <- grep("^Abundance F[0-9A-Za-z]+ Sample$", names(psm_data), value = TRUE)
    if (length(abundance_cols) == 0) {
        stop(paste("No abundance columns found matching pattern.",
                   "Columns found:", paste(names(psm_data), collapse = ", ")))
    }

    for (col in abundance_cols) {
        if (!is.numeric(psm_data[[col]]))
            set(psm_data, j = col, value = suppressWarnings(as.numeric(psm_data[[col]])))
    }
    abundance_cols <- abundance_cols[vapply(psm_data[, ..abundance_cols], is.numeric, logical(1))]
    if (length(abundance_cols) == 0) stop("No valid numeric abundance columns found")

    all_na_mask <- rowSums(is.na(psm_data[, ..abundance_cols])) == length(abundance_cols)
    if (sum(all_na_mask) > 0) psm_data <- psm_data[!all_na_mask]
    if (nrow(psm_data) == 0) stop("No proteins remaining after filtering")

    quant_col_indices <- which(names(psm_data) %in% abundance_cols)
    pe <- readQFeatures(assayData = psm_data, quantCols = quant_col_indices, name = "peptide")
    rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions
}

cat("Created QFeatures object:", nrow(pe[["peptide"]]), "peptides,",
    ncol(pe[["peptide"]]), "samples\n")
flush.console()

# Count PSMs per protein
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
cat("PSM counts calculated for", length(protein_psm_counts), "proteins\n")
flush.console()

# Handle overlapping protein groups (if remove_razor)
if (isTRUE(config$remove_razor)) {
    cat("Removing overlapping protein groups...\n")
    protein_filter <- rowData(pe[["peptide"]])$Proteins %in%
        smallestUniqueGroups(rowData(pe[["peptide"]])$Proteins)
    pe <- pe[protein_filter, , ]
    cat("  After razor filter:", nrow(pe[["peptide"]]), "peptides\n")
}

# Calculate nNonZero per peptide
rowData(pe[["peptide"]])$nNonZero <- rowSums(assay(pe[["peptide"]]) > 0, na.rm = TRUE)

# ==========================================================================
# Log2 transform
# ==========================================================================
cat("Log2 transforming peptide abundances...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptideLog")
flush.console()

# ==========================================================================
# Normalize (or skip)
# ==========================================================================
agg_input <- "peptideLog"
if (tolower(config$normalization) != "none") {
    cat("Applying normalization:", config$normalization, "\n")
    flush.console()
    pe <- normalize(pe, i = "peptideLog", name = "peptideNorm", method = config$normalization)
    agg_input <- "peptideNorm"

    pre_log2_assay <- assay(pe[["peptideLog"]])
    pre_medians <- colMedians(pre_log2_assay, na.rm = TRUE)
    post_norm_assay <- assay(pe[["peptideNorm"]])
    post_medians <- colMedians(post_norm_assay, na.rm = TRUE)
    log2_shift <- pre_medians - post_medians
    linear_factors <- 2.0 ^ log2_shift

    norm_coeff_file <- file.path(dirname(output_file), "normalization_coefficients.tsv")
    norm_df <- data.frame(
        Sample = colnames(pre_log2_assay),
        Log2Shift = log2_shift,
        LinearFactor = linear_factors,
        stringsAsFactors = FALSE
    )
    write.table(norm_df, file = norm_coeff_file, sep = "\t", row.names = FALSE, quote = FALSE)
    cat("Normalization coefficients saved\n")
} else {
    cat("Normalization: none (skipping)\n")
}
flush.console()

# ==========================================================================
# Impute (or skip)
# ==========================================================================
if (tolower(config$imputation) != "none") {
    cat("Applying imputation:", config$imputation, "\n")
    flush.console()
    pe <- impute(pe, i = agg_input, name = "peptideImputed", method = config$imputation)
    agg_input <- "peptideImputed"
} else {
    cat("Imputation: none (skipping)\n")
}
flush.console()

# Filter by observation count
min_obs <- if (isTRUE(config$strict_filtering)) 2L else 1L
pe <- filterFeatures(pe, ~ nNonZero >= min_obs)
cat("After nNonZero filter (>=", min_obs, "):", nrow(pe[[agg_input]]), "peptides\n")
flush.console()

# ==========================================================================
# Aggregate peptides to protein
# ==========================================================================
cat("Aggregating peptides to protein (", config$aggregation, ")...\n", sep = "")
flush.console()

agg_fun <- switch(config$aggregation,
    "robustSummary" = MsCoreUtils::robustSummary,
    "medianPolish"  = MsCoreUtils::medianPolish,
    "sum"           = colSums,
    "mean"          = colMeans,
    MsCoreUtils::robustSummary
)

n_cores <- as.integer(config$numberOfCores)
if (n_cores < 1) n_cores <- 1
if (n_cores > 1) {
    param <- tryCatch({
        SnowParam(workers = n_cores, progressbar = TRUE)
    }, error = function(e) {
        message("WARNING: SnowParam failed, falling back to SerialParam: ", conditionMessage(e))
        SerialParam()
    })
} else {
    param <- SerialParam()
}

pe <- tryCatch({
    aggregateFeatures(pe, i = agg_input, fcol = "Proteins", name = "protein",
                      fun = agg_fun, BPPARAM = param)
}, error = function(e) {
    if (inherits(param, "SnowParam")) {
        message("Parallel aggregation failed, retrying serial: ", conditionMessage(e))
        aggregateFeatures(pe, i = agg_input, fcol = "Proteins", name = "protein",
                          fun = agg_fun, BPPARAM = SerialParam())
    } else stop(e)
})

cat("Aggregation complete:", nrow(pe[["protein"]]), "proteins\n")
flush.console()

# ==========================================================================
# Extract protein data
# ==========================================================================
protein_ids  <- rownames(pe[["protein"]])
sample_names <- colnames(assay(pe[["protein"]]))

# ==========================================================================
# Gene mapping
# ==========================================================================
gene_names <- rep(NA_character_, length(protein_ids))
if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")
    gene_map <- read.delim(gene_mapping_file, sep = "\t", stringsAsFactors = FALSE, check.names = TRUE)
    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL
    if ("Gene Names" %in% names(gene_map)) gene_col <- "Gene Names"

    if (!is.null(entry_col) && !is.null(gene_col)) {
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA_character_)
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])
        all_ids <- strsplit(protein_ids, ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)
        flat_mapped <- mapping[flat_ids_base]
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(unique(non_na), collapse = ";") else NA_character_
        })
        cat("Mapped", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
    }
}
na_mask <- is.na(gene_names)
if (any(na_mask)) gene_names[na_mask] <- sub("-[0-9]+$", "", protein_ids[na_mask])

# PSM counts
first_accessions <- vapply(strsplit(protein_ids, ";", fixed = TRUE), function(x) x[1], character(1))
psm_counts <- as.integer(protein_psm_counts[first_accessions])
psm_counts[is.na(psm_counts)] <- 0L

rowData(pe[["protein"]])$Gene_Name <- gene_names
rowData(pe[["protein"]])$PSM_Count <- psm_counts

# Min peptides filter
if (config$min_peptides > 1) {
    keep_mask <- psm_counts >= config$min_peptides
    keep_mask[is.na(keep_mask)] <- FALSE
    pe <- pe[keep_mask, , ]
    protein_ids <- rownames(pe[["protein"]])
    gene_names <- gene_names[keep_mask]
    psm_counts <- psm_counts[keep_mask]
    cat("Filtered to", sum(keep_mask), "proteins with >=", config$min_peptides, "peptides\n")
}

# ==========================================================================
# Set colData — REQUIRED for step 4 msqrob formula validation
# ==========================================================================
colData(pe)$sample <- sample_names
cat("colData set with", length(sample_names), "samples\n")
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
        entry <- metadata[[fname]]
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
# Batch correction for visualization
# ==========================================================================
protein_matrix <- assay(pe[["protein"]])
protein_matrix_batch_corrected <- NULL
if (!is.null(batch_column) && length(metadata) > 0) {
    cat("Applying removeBatchEffect for visualization...\n")
    flush.console()

    batch_factor <- build_batch_vector(sample_names, metadata, batch_column)

    conditions_all <- vapply(sample_names, function(sname) {
        for (fname in names(metadata)) {
            entry <- metadata[[fname]]
            cond_keys <- grep("^condition_", names(entry), value = TRUE)
            cond_vals <- as.character(unlist(entry[cond_keys]))
            cond_vals <- cond_vals[nzchar(cond_vals)]
            if (length(cond_vals) > 0 &&
                all(vapply(cond_vals, function(v) grepl(v, sname, fixed = TRUE), logical(1))))
                return(paste(cond_vals, collapse = "+"))
        }
        return(NA_character_)
    }, character(1)))

    col_data_batch <- data.frame(sample = sample_names, condition = factor(conditions_all))
    batch_design <- model.matrix(~ 0 + condition, data = col_data_batch)

    protein_matrix_batch_corrected <- removeBatchEffect(
        protein_matrix, batch = batch_factor, design = batch_design)

    # Store as QFeatures assay for downstream visualization
    se_bc <- SummarizedExperiment(
        assays = list(abundance = protein_matrix_batch_corrected),
        colData = colData(pe)
    )
    rownames(se_bc) <- rownames(pe[["protein"]])
    pe <- addAssay(pe, se_bc, name = "proteinBatchCorrected")
    cat("  Batch-corrected assay saved as 'proteinBatchCorrected'\n")
}
flush.console()

# ==========================================================================
# Write Protein_Abundances.tsv
# ==========================================================================
output_matrix <- if (!is.null(protein_matrix_batch_corrected)) protein_matrix_batch_corrected else protein_matrix
protein_df <- as.data.frame(output_matrix, stringsAsFactors = FALSE)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name  <- gene_names
protein_df$PSM_Count  <- psm_counts
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count")
data_cols <- setdiff(names(protein_df), id_cols)
protein_df <- protein_df[, c(id_cols, data_cols)]

cat("Writing protein abundances to:", output_file, "\n")
write.table(protein_df, file = output_file, sep = "\t", row.names = FALSE, quote = FALSE)
cat("Output:", nrow(protein_df), "proteins\n")
flush.console()

# Ensure normalization coefficients exist (identity if skipped)
norm_coeff_file <- file.path(dirname(output_file), "normalization_coefficients.tsv")
if (!file.exists(norm_coeff_file)) {
    norm_df <- data.frame(
        Sample = sample_names,
        Log2Shift = rep(0, length(sample_names)),
        LinearFactor = rep(1, length(sample_names)),
        stringsAsFactors = FALSE
    )
    write.table(norm_df, file = norm_coeff_file, sep = "\t", row.names = FALSE, quote = FALSE)
}

# ==========================================================================
# Save QFeatures RDS for step 4
# ==========================================================================
cat("Saving QFeatures RDS to:", rds_output, "\n")
saveRDS(pe, file = rds_output)
cat("RDS checkpoint saved:", file.info(rds_output)$size, "bytes\n")

cat("\nStep 3 complete: msqrob2 data process finished successfully\n")
flush.console()
