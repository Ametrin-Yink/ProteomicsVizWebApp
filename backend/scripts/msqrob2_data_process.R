#!/usr/bin/env Rscript
#
# msqrob2 Data Process (Step 6)
#
# Peptide-to-protein aggregation using QFeatures preprocessing pipeline.
# Supports configurable normalization, imputation, and aggregation methods.
# Saves normalization coefficients and RDS checkpoint for Step 7 (DE).
#
# Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output>
#        <gene_mapping_file> <config_json>
#
# config_json fields (defaults):
#   normalization: "center.median" (center.median, center.mean, quantiles,
#                   quantiles.robust, vsn, div.median, none)
#   imputation:   "none" (none, knn, bpca, MinDet, MinProb, QRILC, MLE)
#   aggregation:  "robustSummary" (robustSummary, medianPolish, sum, mean)
#   min_peptides: 1
#   numberOfCores: 1

cat("Step 6: msqrob2 data process (protein aggregation)\n")
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
cat("R packages loaded successfully\n")
flush.console()

# ==========================================================================
# Parse command line arguments (5 positional args)
# ==========================================================================
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste(
        "Usage: Rscript msqrob2_data_process.R <input_file> <output_file>",
        "<rds_output> <gene_mapping_file> <config_json>"
    ))
}

input_file       <- args[1]
output_file      <- args[2]
rds_output       <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- args[5]

# Parse JSON config
cat("Parsing configuration...\n")
config <- fromJSON(config_json)

# Set defaults for missing config fields
if (is.null(config$normalization))  config$normalization  <- "center.median"
if (is.null(config$imputation))     config$imputation     <- "none"
if (is.null(config$aggregation))    config$aggregation    <- "robustSummary"
if (is.null(config$min_peptides))   config$min_peptides   <- 1
if (is.null(config$numberOfCores))  config$numberOfCores  <- 1

cat("Configuration:\n")
cat("  normalization:", config$normalization, "\n")
cat("  imputation:", config$imputation, "\n")
cat("  aggregation:", config$aggregation, "\n")
cat("  min_peptides:", config$min_peptides, "\n")
cat("  numberOfCores:", config$numberOfCores, "\n")
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("RDS output:", rds_output, "\n")
cat("Gene mapping file:", ifelse(is.null(gene_mapping_file), "(none)", gene_mapping_file), "\n")
flush.console()

# Check input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

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
    cat("Loaded", nrow(psm_data), "PSMs from TSV (fread)\n")
}

# ==========================================================================
# Filter empty Master_Protein_Accessions
# ==========================================================================
cat("Filtering empty Master_Protein_Accessions...\n")
psm_data <- psm_data[Master_Protein_Accessions != "" & !is.na(Master_Protein_Accessions)]
cat("Filtered to", nrow(psm_data), "PSMs with valid protein accessions\n")

if (nrow(psm_data) == 0) {
    stop("No PSMs with valid protein accessions found")
}

# ==========================================================================
# Reshape long->wide or detect wide format
# ==========================================================================
if ("Sample_Origination" %in% names(psm_data)) {
    # ===== Long format: reshape to wide =====
    cat("Data is in long format, reshaping to wide...\n")

    # Aggregate by (Unique_PSM, protein, sample) — sum abundance for duplicates
    setDT(psm_data)
    psm_dt_agg <- psm_data[, .(Abundance = sum(Abundance, na.rm = TRUE)),
                           by = .(Unique_PSM, Master_Protein_Accessions,
                                  Sample_Origination)]
    cat("Aggregated to", nrow(psm_dt_agg), "rows (unique PSM-protein-sample)\n")

    # Cast to wide: rows = PSM, columns = samples, values = abundance
    psm_wide <- dcast(psm_dt_agg,
                      Unique_PSM + Master_Protein_Accessions ~ Sample_Origination,
                      value.var = "Abundance",
                      fun.aggregate = sum)
    # Strip "Abundance." prefix that dcast adds to value column names
    setnames(psm_wide, names(psm_wide), gsub("^Abundance\\.", "", names(psm_wide)))
    cat("Wide format:", nrow(psm_wide), "rows x", ncol(psm_wide), "columns\n")

    # Identify sample columns (all non-ID columns)
    sample_cols <- setdiff(names(psm_wide), c("Unique_PSM", "Master_Protein_Accessions"))

    # Convert zeros to NA — dcast fills empty cells with 0 from sum(),
    # but these represent missing observations, not true zero abundance.
    for (col in sample_cols) {
        set(psm_wide, i = which(psm_wide[[col]] == 0), j = col, value = NA_real_)
    }
    n_zeros <- sum(vapply(psm_wide[, ..sample_cols],
                          function(x) sum(is.na(x)), integer(1)))
    cat("Converted zeros to NA:", n_zeros, "missing values introduced\n")

    # Remove proteins where ALL abundance values are NA
    all_na_mask <- rowSums(is.na(psm_wide[, ..sample_cols])) == length(sample_cols)
    if (sum(all_na_mask) > 0) {
        cat("Removing", sum(all_na_mask), "proteins with all-NA abundances\n")
        psm_wide <- psm_wide[!all_na_mask]
    }
    if (nrow(psm_wide) == 0) {
        stop("No proteins with abundance data remaining after filtering")
    }

    # Create QFeatures object via readQFeatures
    quant_col_indices <- which(!names(psm_wide) %in%
                               c("Unique_PSM", "Master_Protein_Accessions"))
    pe <- readQFeatures(
        assayData = psm_wide,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    rowData(pe[["peptide"]])$Proteins <- psm_wide$Master_Protein_Accessions

} else {
    # ===== Wide format: use abundance columns directly =====
    cat("Data is in wide format, identifying abundance columns...\n")

    # Match columns with the standard TMT pattern
    abundance_cols <- grep("^Abundance F[0-9A-Za-z]+ Sample$",
                           names(psm_data), value = TRUE)

    if (length(abundance_cols) == 0) {
        stop(paste(
            "No abundance columns found matching '^Abundance F[0-9A-Za-z]+ Sample$'.",
            "Columns found:", paste(names(psm_data), collapse = ", ")
        ))
    }

    # Convert abundance columns to numeric
    for (col in abundance_cols) {
        if (!is.numeric(psm_data[[col]])) {
            set(psm_data, j = col, value = suppressWarnings(as.numeric(psm_data[[col]])))
        }
    }
    # Drop any columns that are still non-numeric
    abundance_cols <- abundance_cols[vapply(
        psm_data[, ..abundance_cols], is.numeric, logical(1)
    )]
    if (length(abundance_cols) == 0) {
        stop("No valid numeric abundance columns found")
    }
    cat("Found", length(abundance_cols), "abundance columns\n")

    # Remove all-NA proteins
    all_na_mask <- rowSums(is.na(psm_data[, ..abundance_cols])) == length(abundance_cols)
    if (sum(all_na_mask) > 0) {
        cat("Removing", sum(all_na_mask), "proteins with all-NA abundances\n")
        psm_data <- psm_data[!all_na_mask]
    }
    if (nrow(psm_data) == 0) {
        stop("No proteins with abundance data remaining after filtering")
    }

    # Create QFeatures object
    quant_col_indices <- which(names(psm_data) %in% abundance_cols)
    pe <- readQFeatures(
        assayData = psm_data,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions
}

cat("Created QFeatures object:",
    nrow(pe[["peptide"]]), "peptides,", ncol(pe[["peptide"]]), "samples\n")
flush.console()

# ==========================================================================
# Count PSMs per protein (from peptide-level rowData)
# ==========================================================================
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
cat("PSM counts calculated for", length(protein_psm_counts), "proteins\n")
flush.console()

# ==========================================================================
# Log2 transform
# ==========================================================================
cat("Log2 transforming peptide abundances...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
cat("Log2 transformation complete\n")
flush.console()

# ==========================================================================
# Normalize (or skip if "none")
# ==========================================================================
agg_input <- "peptide_log2"

if (tolower(config$normalization) != "none") {
    cat("Applying normalization:", config$normalization, "\n")
    flush.console()

    # Record pre-normalization sample medians (log2 scale)
    pre_log2_assay <- assay(pe[["peptide_log2"]])
    pre_medians <- colMedians(pre_log2_assay, na.rm = TRUE)

    # Apply normalization via QFeatures
    pe <- normalize(pe, i = "peptide_log2", name = "peptide_norm",
                    method = config$normalization)
    agg_input <- "peptide_norm"
    cat("Normalization complete\n")

    # Calculate post-normalization sample medians
    post_norm_assay <- assay(pe[["peptide_norm"]])
    post_medians <- colMedians(post_norm_assay, na.rm = TRUE)

    # Log2Shift = amount each sample was shifted (pre - post)
    log2_shift <- pre_medians - post_medians
    linear_factors <- 2.0 ^ log2_shift

    cat("Sample medians before normalization:\n")
    for (i in seq_along(pre_medians)) {
        cat("  ", colnames(pre_log2_assay)[i], ":", round(pre_medians[i], 4), "\n")
    }
    cat("Sample medians after normalization:\n")
    for (i in seq_along(post_medians)) {
        cat("  ", colnames(post_norm_assay)[i], ":", round(post_medians[i], 4), "\n")
    }
    cat("Normalization coefficients (Log2Shift):\n")
    for (i in seq_along(log2_shift)) {
        cat("  ", colnames(pre_log2_assay)[i], ":",
            round(log2_shift[i], 4), "\n")
    }

    # Save normalization coefficients
    norm_coeff_file <- file.path(dirname(output_file), "normalization_coefficients.tsv")
    norm_df <- data.frame(
        Sample       = colnames(pre_log2_assay),
        Log2Shift    = log2_shift,
        LinearFactor = linear_factors,
        stringsAsFactors = FALSE
    )
    write.table(norm_df, file = norm_coeff_file, sep = "\t",
                row.names = FALSE, quote = FALSE)
    cat("Normalization coefficients saved to:", norm_coeff_file, "\n")
    flush.console()
} else {
    cat("Normalization: none (skipping)\n")
    flush.console()
}

# ==========================================================================
# Impute (or skip if "none")
# ==========================================================================
if (tolower(config$imputation) != "none") {
    cat("Applying imputation:", config$imputation, "\n")
    flush.console()

    pe <- impute(pe, i = agg_input, name = "peptide_imputed",
                 method = config$imputation)
    agg_input <- "peptide_imputed"
    cat("Imputation complete\n")
    flush.console()
} else {
    cat("Imputation: none (skipping)\n")
    flush.console()
}

# ==========================================================================
# Aggregate peptides to protein level
# ==========================================================================
cat("Aggregating peptides to protein level...\n")
cat("  Aggregation method:", config$aggregation, "\n")
cat("  Input assay:", agg_input, "\n")
cat("  Peptides:", nrow(pe[[agg_input]]), "\n")
cat("  Unique proteins:", length(unique(rowData(pe[[agg_input]])$Proteins)), "\n")
flush.console()

# Map aggregation method string to function
agg_fun <- switch(config$aggregation,
    "robustSummary" = MsCoreUtils::robustSummary,
    "medianPolish"  = MsCoreUtils::medianPolish,
    "sum"           = colSums,
    "mean"          = colMeans,
    # Default fallback
    MsCoreUtils::robustSummary
)

# Set up BiocParallel
n_cores <- as.integer(config$numberOfCores)
if (n_cores < 1) n_cores <- 1

if (n_cores > 1) {
    cat("Using SnowParam with", n_cores, "workers\n")
    param <- tryCatch({
        SnowParam(workers = n_cores, progressbar = TRUE)
    }, error = function(e) {
        cat("SnowParam creation failed:", conditionMessage(e), "\n")
        cat("Falling back to SerialParam\n")
        SerialParam()
    })
} else {
    cat("Using SerialParam\n")
    param <- SerialParam()
}

cat("Starting aggregation at", format(Sys.time(), "%H:%M:%S"), "\n")
flush.console()

# Attempt aggregation with fallback to SerialParam if SnowParam fails
pe <- tryCatch({
    aggregateFeatures(
        object  = pe,
        i       = agg_input,
        fcol    = "Proteins",
        name    = "protein",
        fun     = agg_fun,
        BPPARAM = param
    )
}, error = function(e) {
    if (inherits(param, "SnowParam")) {
        cat("Parallel aggregation failed:", conditionMessage(e), "\n")
        cat("Retrying with SerialParam...\n")
        flush.console()
        aggregateFeatures(
            object  = pe,
            i       = agg_input,
            fcol    = "Proteins",
            name    = "protein",
            fun     = agg_fun,
            BPPARAM = SerialParam()
        )
    } else {
        stop(e)
    }
})

cat("Aggregation complete at", format(Sys.time(), "%H:%M:%S"), "\n")
cat("Total proteins:", nrow(pe[["protein"]]), "\n")
flush.console()

# ==========================================================================
# Extract protein-level data
# ==========================================================================
protein_assay  <- pe[["protein"]]
protein_matrix <- assay(protein_assay)
protein_ids    <- rownames(protein_matrix)
sample_names   <- colnames(protein_matrix)
cat("Protein abundance matrix:", nrow(protein_matrix), "proteins x",
    ncol(protein_matrix), "samples\n")
flush.console()

# ==========================================================================
# Gene mapping from UniProt file
# ==========================================================================
gene_names <- rep(NA_character_, length(protein_ids))

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")

    gene_map <- read.delim(gene_mapping_file, sep = "\t",
                           stringsAsFactors = FALSE, check.names = TRUE)
    cat("Gene mapping columns:", paste(names(gene_map), collapse = ", "), "\n")

    # Detect UniProt columns
    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL

    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames"   %in% names(gene_map)) "GeneNames" else NULL

    # Check for raw column name with space (converted by check.names)
    if (is.null(gene_col) && "Gene Names" %in% names(gene_map)) {
        gene_col <- "Gene Names"
    }

    if (!is.null(entry_col) && !is.null(gene_col)) {
        cat("Mapping via", entry_col, "->", gene_col, "\n")

        # Extract first gene name from multi-gene entries
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA_character_)
            # Take first gene before semicolon, then first before space
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])

        # Handle multi-ID proteins (semicolon-separated) and isoform stripping
        all_ids <- strsplit(protein_ids, ";")
        flat_ids      <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)   # Strip isoform suffix
        flat_mapped   <- mapping[flat_ids_base]            # Lookup by base ID

        # Group back to original protein IDs
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(unique(non_na), collapse = ";") else NA_character_
        })

        cat("Mapped", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
    } else {
        cat("Warning: Gene mapping file has unexpected columns:",
            paste(names(gene_map), collapse = ", "), "\n")
        cat("  Expected columns: 'Entry' and 'Gene.Names' (or 'Gene_Names')\n")
    }
} else {
    cat("No gene mapping file provided or file not found,",
        "using protein IDs as fallback gene names\n")
}

# Fallback: for unmapped proteins, use base protein ID (with isoform suffix stripped)
na_mask <- is.na(gene_names)
if (any(na_mask)) {
    gene_names[na_mask] <- sub("-[0-9]+$", "", protein_ids[na_mask])
}

# ==========================================================================
# PSM counts for each protein (use first accession for multi-ID proteins)
# ==========================================================================
first_accessions <- vapply(strsplit(protein_ids, ";", fixed = TRUE),
                           function(x) x[1], character(1))
psm_counts <- as.integer(protein_psm_counts[first_accessions])
psm_counts[is.na(psm_counts)] <- 0L

# Filter by minimum peptides if configured
min_peptides <- config$min_peptides
if (min_peptides > 1) {
    keep_mask <- psm_counts >= min_peptides
    keep_mask[is.na(keep_mask)] <- FALSE
    protein_matrix <- protein_matrix[keep_mask, , drop = FALSE]
    protein_ids <- protein_ids[keep_mask]
    gene_names <- gene_names[keep_mask]
    psm_counts <- psm_counts[keep_mask]
    cat("Filtered to", sum(keep_mask), "proteins with >=", min_peptides, "peptides\n")
}

# ==========================================================================
# Build output data frame with standard column order
# ==========================================================================
protein_df <- as.data.frame(protein_matrix, stringsAsFactors = FALSE)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name  <- gene_names
protein_df$PSM_Count  <- psm_counts

# Reorder: ID cols first, then abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count")
data_cols <- setdiff(names(protein_df), id_cols)
protein_df <- protein_df[, c(id_cols, data_cols)]

# ==========================================================================
# Write Protein_Abundances.tsv
# ==========================================================================
cat("Writing protein abundances to:", output_file, "\n")
write.table(protein_df, file = output_file, sep = "\t",
            row.names = FALSE, quote = FALSE)
cat("Output:", nrow(protein_df), "proteins,", ncol(protein_df), "columns\n")
flush.console()

# ==========================================================================
# Ensure normalization coefficients exist (identity if skipped)
# ==========================================================================
norm_coeff_file <- file.path(dirname(output_file), "normalization_coefficients.tsv")
if (!file.exists(norm_coeff_file)) {
    cat("Normalization was skipped, saving identity coefficients...\n")
    norm_df <- data.frame(
        Sample       = sample_names,
        Log2Shift    = rep(0, length(sample_names)),
        LinearFactor = rep(1, length(sample_names)),
        stringsAsFactors = FALSE
    )
    write.table(norm_df, file = norm_coeff_file, sep = "\t",
                row.names = FALSE, quote = FALSE)
    cat("Identity normalization coefficients saved to:", norm_coeff_file, "\n")
}

# Load norm coefficients for RDS checkpoint
norm_coeffs <- NULL
if (file.exists(norm_coeff_file)) {
    norm_coeffs <- fread(norm_coeff_file, sep = "\t", header = TRUE)
}

# ==========================================================================
# Save RDS checkpoint (contract with Step 7 differential expression)
# ==========================================================================
cat("Saving RDS checkpoint to:", rds_output, "\n")
saveRDS(list(
    protein_matrix   = protein_matrix,
    sample_names     = sample_names,
    gene_names       = gene_names,
    psm_counts       = psm_counts,
    norm_coefficients = norm_coeffs
), file = rds_output)
cat("RDS checkpoint saved:", file.info(rds_output)$size, "bytes\n")

cat("\nStep 6 complete: msqrob2 data process finished successfully\n")
flush.console()
