#!/usr/bin/env Rscript
#
# msqrob2 Protein Abundance Calculation (Step 6)
#
# Aggregates peptide-level data to protein level using msqrob2.
# Input: PSM_Abundances.tsv from Steps 1-5
# Output: Protein_Abundances.tsv
#
# Usage: Rscript msqrob2_protein.R <input_file> <output_file> [gene_mapping_file]

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
    library(matrixStats)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 2) {
    stop("Usage: Rscript msqrob2_protein.R <input_file> <output_file> [gene_mapping_file]")
}

input_file <- args[1]
output_file <- args[2]
gene_mapping_file <- if (length(args) >= 3) args[3] else NULL

cat("Step 6: Calculating protein abundance with msqrob2\n")
cat("Arguments received:", length(args), "\n")
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Read PSM data (detect Parquet vs TSV)
cat("Reading PSM data...\n")
if (grepl("\\.parquet$", input_file, ignore.case = TRUE)) {
    library(arrow)
    psm_data <- as.data.table(read_parquet(input_file))
    cat("Loaded", nrow(psm_data), "PSMs from Parquet\n")
} else {
    psm_data <- fread(input_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = TRUE)
    cat("Loaded", nrow(psm_data), "PSMs from TSV (fread)\n")
}

# Filter out rows with empty Master_Protein_Accessions
psm_data <- psm_data[psm_data$Master_Protein_Accessions != '' & !is.na(psm_data$Master_Protein_Accessions), ]
cat("Filtered to", nrow(psm_data), "PSMs with valid protein accessions\n")

# Identify abundance columns (exclude metadata columns)
metadata_cols <- c("Sequence", "Modifications", "Charge", "Contaminant", 
                   "Master_Protein_Accessions", "Quan_Info", "Sample_Origination",
                   "Condition", "Replicate", "Unique_PSM")
abundance_cols <- setdiff(names(psm_data), metadata_cols)

# Convert all abundance columns to numeric (vectorized)
for (col in abundance_cols) {
    if (!is.numeric(psm_data[[col]])) {
        psm_data[[col]] <- suppressWarnings(as.numeric(psm_data[[col]]))
    }
}
cat("Converted", length(abundance_cols), "abundance columns to numeric\n")

# Filter to only numeric abundance columns (vectorized with vapply)
abundance_cols <- abundance_cols[vapply(psm_data[abundance_cols], function(x) is.numeric(x) && !all(is.na(x)), logical(1))]
cat("Found", length(abundance_cols), "valid abundance columns\n")

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Remove proteins where ALL abundance values are NA (would produce NA results regardless)
if (nrow(psm_data) > 0) {
    all_na_mask <- rowSums(is.na(psm_data[, abundance_cols, drop = FALSE])) == length(abundance_cols)
    n_removed <- sum(all_na_mask)
    if (n_removed > 0) {
        cat("Removing", n_removed, "proteins with no abundance data\n")
        psm_data <- psm_data[!all_na_mask, ]
    }
}

# Check if data is in long format (has Sample_Origination column) or wide format
if ("Sample_Origination" %in% names(psm_data)) {
    cat("Data is in long format, reshaping to wide format...\n")

    # Aggregate and reshape in one pass using data.table
    cat("Aggregating duplicate PSMs and reshaping to wide format...\n")
    setDT(psm_data)

    # Single aggregation: sum abundance by PSM+protein+sample
    psm_dt_agg <- psm_data[, .(Abundance = sum(Abundance, na.rm = TRUE)),
                           by = .(Unique_PSM, Master_Protein_Accessions, Sample_Origination)]
    cat("Aggregated from", nrow(psm_data), "to", nrow(psm_dt_agg), "rows\n")

    # Reshape to wide format using data.table::dcast (much faster than base reshape)
    cat("Reshaping to wide format with data.table::dcast...\n")
    psm_wide_dt <- dcast(psm_dt_agg,
                         Unique_PSM + Master_Protein_Accessions ~ Sample_Origination,
                         value.var = "Abundance", fun.aggregate = sum)
    # Keep as data.table - readQFeatures accepts both types
    names(psm_wide_dt) <- gsub("Abundance\\.", "", names(psm_wide_dt))

    cat("Reshaped to wide format:", nrow(psm_wide_dt), "rows x", ncol(psm_wide_dt), "columns\n")

    # Use readQFeatures to create QFeatures object from wide format
    quant_col_indices <- which(!names(psm_wide_dt) %in% c("Unique_PSM", "Master_Protein_Accessions"))

    pe <- readQFeatures(
        assayData = psm_wide_dt,
        quantCols = quant_col_indices,
        name = "peptide"
    )

    # Add protein annotations
    rowData(pe[["peptide"]])$Proteins <- psm_wide_dt$Master_Protein_Accessions
    
} else {
    cat("Data is in wide format, using readQFeatures...\n")
    
    # Use readQFeatures to create QFeatures object from wide format
    quant_col_indices <- grep("Abundance", names(psm_data))
    
    pe <- readQFeatures(
        assayData = psm_data,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    
    # Add protein annotations
    rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions
}

cat("Created QFeatures object with", nrow(pe[["peptide"]]), "peptides\n")

# Count PSMs per protein before aggregation
# Get the protein assignments from the peptide assay
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
cat("Calculated PSM counts for", length(protein_psm_counts), "proteins\n")

# Log2 transform peptide abundances (required before normalization and aggregation)
cat("Log2 transforming peptide abundances...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
cat("Log2 transformation complete\n")

# Custom median centering normalization - shift to highest median instead of 0
cat("Applying median centering normalization (shifting to highest median)...\n")

# Get the log2 transformed assay
peptide_log2_assay <- assay(pe[["peptide_log2"]])

# Calculate median for each sample (column) - use matrixStats::colMedians for speed
sample_medians <- colMedians(peptide_log2_assay, na.rm = TRUE)
cat("Sample medians before normalization:\n")
for (i in seq_along(sample_medians)) {
    cat("  ", colnames(peptide_log2_assay)[i], ":", round(sample_medians[i], 4), "\n")
}

# Find the maximum median across all samples
max_median <- max(sample_medians, na.rm = TRUE)
cat("Maximum median across all samples:", round(max_median, 4), "\n")

# Normalize: subtract sample median, then add max median (vectorized with sweep)
peptide_norm_matrix <- sweep(peptide_log2_assay, 2, sample_medians, "-") + max_median

# Create a new SummarizedExperiment with the normalized data
# Copy the rowData and colData from the original assay
peptide_norm_se <- SummarizedExperiment(
    assays = list(peptide_norm = peptide_norm_matrix),
    rowData = rowData(pe[["peptide_log2"]]),
    colData = colData(pe[["peptide_log2"]])
)

# Add to QFeatures object
pe <- addAssay(pe, peptide_norm_se, name = "peptide_norm")

# Verify normalization
peptide_norm_assay <- assay(pe[["peptide_norm"]])
norm_medians <- colMedians(peptide_norm_assay, na.rm = TRUE)
cat("Sample medians after normalization (should all be ~", round(max_median, 4), "):\n")
for (i in seq_along(norm_medians)) {
    cat("  ", colnames(peptide_norm_assay)[i], ":", round(norm_medians[i], 4), "\n")
}

cat("Normalization complete\n")

# Aggregate to protein level using normalized log2 data
cat("Aggregating peptides to protein level...\n")
cat("Using robust summary aggregation (this may take a few minutes for large datasets)...\n")
cat("Processing", nrow(pe[["peptide_norm"]]), "peptides for", length(unique(rowData(pe[["peptide_norm"]])$Proteins)), "proteins\n")

# Flush output to ensure logs are sent immediately
flush.console()

# Estimate time based on number of peptides
num_peptides <- nrow(pe[["peptide_norm"]])
num_proteins <- length(unique(rowData(pe[["peptide_norm"]])$Proteins))
cat("Dataset size:", num_peptides, "peptides across", num_proteins, "proteins\n")
if (num_peptides > 50000) {
    cat("Large dataset detected - aggregation may take 10-20 minutes\n")
} else if (num_peptides > 20000) {
    cat("Medium dataset detected - aggregation may take 5-10 minutes\n")
} else {
    cat("Small dataset - aggregation should complete within 5 minutes\n")
}
flush.console()

cat("Starting aggregation at", format(Sys.time(), "%H:%M:%S"), "\n")
flush.console()

# Use BiocParallel for aggregation
# SnowParam for parallel processing on large datasets, with SerialParam fallback
# Parallel can cause issues with rlm on some systems, so we try parallel first and fall back
library(BiocParallel)
n_cores <- as.integer(Sys.getenv("R_NCORES", unset = "1"))
if (n_cores > 1) {
    cat("Attempting parallel aggregation with", n_cores, "workers (SnowParam)\n")
    param <- tryCatch({
        SnowParam(workers = n_cores, progressbar = TRUE)
    }, error = function(e) {
        cat("SnowParam creation failed:", conditionMessage(e), "\n")
        NULL
    })
    if (is.null(param)) {
        cat("Falling back to SerialParam\n")
        param <- SerialParam()
    }
} else {
    cat("Using BiocParallel SerialParam for aggregation (R_NCORES not set or = 1)\n")
    param <- SerialParam()
}

pe <- tryCatch({
    aggregateFeatures(
        object = pe,
        i = "peptide_norm",
        fcol = "Proteins",
        name = "protein",
        fun = MsCoreUtils::robustSummary,
        BPPARAM = param
    )
}, error = function(e) {
    if (inherits(param, "SnowParam")) {
        cat("Parallel aggregation failed:", conditionMessage(e), "\n")
        cat("Retrying with SerialParam...\n")
        aggregateFeatures(
            object = pe,
            i = "peptide_norm",
            fcol = "Proteins",
            name = "protein",
            fun = MsCoreUtils::robustSummary,
            BPPARAM = SerialParam()
        )
    } else {
        stop(e)
    }
})

cat("Aggregation complete:", nrow(pe[["protein"]]), "proteins\n")
cat("Protein abundances are on log2 scale\n")

# Extract protein abundances
protein_assay <- pe[["protein"]]
protein_matrix <- assay(protein_assay)

# Get protein accessions
protein_ids <- rownames(protein_matrix)

# Load gene mapping if provided
gene_names <- rep(NA, length(protein_ids))

# Debug log file
debug_log <- file.path(dirname(output_file), "gene_mapping_debug.log")
log_con <- file(debug_log, open = "wt")
cat("Gene mapping debug log\n", file = log_con)
cat("Number of arguments:", length(args), "\n", file = log_con)
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n", file = log_con)
}
cat("Gene mapping file arg:", ifelse(is.null(gene_mapping_file), "NULL", gene_mapping_file), "\n", file = log_con)
cat("Gene mapping file exists:", ifelse(is.null(gene_mapping_file), FALSE, file.exists(gene_mapping_file)), "\n", file = log_con)

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")
    cat("Loading gene mapping from:", gene_mapping_file, "\n", file = log_con)

    gene_map <- read.delim(gene_mapping_file, sep = "\t", stringsAsFactors = FALSE, check.names = TRUE)

    cat("Gene mapping columns:", paste(names(gene_map), collapse = ", "), "\n")
    cat("Gene mapping columns:", paste(names(gene_map), collapse = ", "), "\n", file = log_con)
    cat("Looking for Entry column:", "Entry" %in% names(gene_map), "\n", file = log_con)
    cat("Looking for Gene.Names column:", "Gene.Names" %in% names(gene_map), "\n", file = log_con)
    cat("Looking for Gene_Names column:", "Gene_Names" %in% names(gene_map), "\n", file = log_con)
    cat("Looking for 'Gene Names' column:", "Gene Names" %in% names(gene_map), "\n", file = log_con)

    # UniProt format: Entry = UniProt ID, Gene Names = gene symbols
    # Column names may have spaces converted to dots by R's check.names
    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL

    # Also check for raw column name with space
    if (is.null(gene_col) && "Gene Names" %in% names(gene_map)) {
        gene_col <- "Gene Names"
    }

    if (!is.null(entry_col) && !is.null(gene_col)) {
        cat("Using entry column:", entry_col, "and gene column:", gene_col, "\n")
        # Show sample of mapping data
        cat("Sample entries from mapping file:\n")
        cat("  First 3 protein IDs:", paste(head(gene_map[[entry_col]], 3), collapse = ", "), "\n")
        cat("  First 3 gene names:", paste(head(gene_map[[gene_col]], 3), collapse = ", "), "\n")
        # Extract first gene name only (before any spaces or semicolons)
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA)
            # Split by semicolon and take first, then by space and take first
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])

        # Vectorized gene lookup for multi-ID proteins
        # Split all protein IDs by semicolon, lookup each, take first non-NA per protein
        all_ids <- strsplit(protein_ids, ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_mapped <- mapping[flat_ids]
        # Re-group by original protein and take first non-NA
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) non_na[1] else NA
        })

        cat("Loaded gene mapping for", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
        cat("Loaded gene mapping for", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n", file = log_con)
        cat("Sample mappings (first 5):\n", file = log_con)
        for (i in 1:min(5, length(protein_ids))) {
            cat("  Protein:", protein_ids[i], "-> Gene:", gene_names[i], "\n", file = log_con)
        }
    } else {
        cat("Warning: Gene mapping file has unexpected columns. Looking for 'Entry' and 'Gene.Names', found:", paste(names(gene_map), collapse = ", "), "\n")
        cat("Warning: Gene mapping file has unexpected columns. Looking for 'Entry' and 'Gene.Names', found:", paste(names(gene_map), collapse = ", "), "\n", file = log_con)
    }
} else {
    cat("No gene mapping file provided or file not found, using protein IDs as gene names\n")
    cat("No gene mapping file provided or file not found, using protein IDs as gene names\n", file = log_con)
}

# Handle NA gene names
gene_names[is.na(gene_names)] <- protein_ids[is.na(gene_names)]

# Get PSM counts for each protein (vectorized named-vector lookup)
psm_counts <- as.integer(protein_psm_counts[protein_ids])
psm_counts[is.na(psm_counts)] <- 0

# Create output data frame
protein_df <- as.data.frame(protein_matrix)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name <- gene_names
protein_df$PSM_Count <- psm_counts

# Reorder columns to put IDs first
cols <- c("Master_Protein_Accessions", "Gene_Name", setdiff(names(protein_df), c("Master_Protein_Accessions", "Gene_Name")))
protein_df <- protein_df[, cols]

# Write output
cat("Writing protein abundances to:", output_file, "\n")
write.table(
    protein_df,
    file = output_file,
    sep = "\t",
    row.names = FALSE,
    quote = FALSE
)

cat("Step 6 complete: Protein abundance calculated successfully\n")
cat("Output:", nrow(protein_df), "proteins\n")
cat("Step 6 complete: Protein abundance calculated successfully\n", file = log_con)
cat("Output:", nrow(protein_df), "proteins\n", file = log_con)
close(log_con)
