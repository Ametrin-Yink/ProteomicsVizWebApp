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
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
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
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Read PSM data
cat("Reading PSM data...\n")
psm_data <- read.delim(input_file, sep = "\t", stringsAsFactors = FALSE, check.names = FALSE)
cat("Loaded", nrow(psm_data), "PSMs\n")

# Filter out rows with empty Master_Protein_Accessions
psm_data <- psm_data[psm_data$Master_Protein_Accessions != '' & !is.na(psm_data$Master_Protein_Accessions), ]
cat("Filtered to", nrow(psm_data), "PSMs with valid protein accessions\n")

# Identify abundance columns (exclude metadata columns)
metadata_cols <- c("Sequence", "Modifications", "Charge", "Contaminant", 
                   "Master_Protein_Accessions", "Quan_Info", "Sample_Origination",
                   "Condition", "Replicate", "Unique_PSM")
abundance_cols <- setdiff(names(psm_data), metadata_cols)

# Convert all abundance columns to numeric (they may be read as strings from TSV)
for (col in abundance_cols) {
    psm_data[[col]] <- suppressWarnings(as.numeric(psm_data[[col]]))
}
cat("Converted", length(abundance_cols), "abundance columns to numeric\n")

# Filter to only numeric abundance columns (that successfully converted)
abundance_cols <- abundance_cols[sapply(psm_data[abundance_cols], function(x) is.numeric(x) && !all(is.na(x)))]
cat("Found", length(abundance_cols), "valid abundance columns\n")

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Check if data is in long format (has Sample_Origination column) or wide format
if ("Sample_Origination" %in% names(psm_data)) {
    cat("Data is in long format, reshaping to wide format...\n")
    
    # Aggregate duplicate PSMs within each sample (sum abundances)
    cat("Aggregating duplicate PSMs within each sample...\n")
    psm_agg <- aggregate(Abundance ~ Unique_PSM + Sample_Origination + Master_Protein_Accessions + Sequence + Modifications + Charge, 
                         data = psm_data,
                         FUN = sum)
    cat("Aggregated from", nrow(psm_data), "to", nrow(psm_agg), "rows\n")
    
    # Reshape to wide format (samples as columns)
    cat("Reshaping to wide format...\n")
    psm_wide <- reshape(psm_agg[, c("Unique_PSM", "Sample_Origination", "Abundance", "Master_Protein_Accessions")],
                        idvar = c("Unique_PSM", "Master_Protein_Accessions"),
                        timevar = "Sample_Origination",
                        direction = "wide")
    
    # Rename columns to remove "Abundance." prefix
    names(psm_wide) <- gsub("Abundance\\.", "", names(psm_wide))
    
    cat("Reshaped to wide format:", nrow(psm_wide), "rows x", ncol(psm_wide), "columns\n")
    
    # Use readQFeatures to create QFeatures object from wide format
    quant_col_indices <- which(!names(psm_wide) %in% c("Unique_PSM", "Master_Protein_Accessions"))
    
    pe <- readQFeatures(
        assayData = psm_wide,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    
    # Add protein annotations
    rowData(pe[["peptide"]])$Proteins <- psm_wide$Master_Protein_Accessions
    
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

# Aggregate to protein level
cat("Aggregating peptides to protein level...\n")

pe <- tryCatch({
    aggregateFeatures(
        object = pe,
        i = "peptide",
        fcol = "Proteins",
        name = "protein",
        fun = MsCoreUtils::robustSummary
    )
}, error = function(e) {
    cat("Robust aggregation failed:", conditionMessage(e), "\n")
    cat("Trying median aggregation...\n")
    aggregateFeatures(
        object = pe,
        i = "peptide",
        fcol = "Proteins",
        name = "protein",
        fun = colMedians
    )
})

cat("Aggregation complete:", nrow(pe[["protein"]]), "proteins\n")

# Extract protein abundances
protein_assay <- pe[["protein"]]
protein_matrix <- assay(protein_assay)

# Get protein accessions
protein_ids <- rownames(protein_matrix)

# Load gene mapping if provided
gene_names <- rep(NA, length(protein_ids))

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")
    
    gene_map <- read.delim(gene_mapping_file, sep = "\t", stringsAsFactors = FALSE)
    
    # Create mapping dictionary
    if ("Protein" %in% names(gene_map) && "Gene_Name" %in% names(gene_map)) {
        mapping <- setNames(gene_map$Gene_Name, gene_map$Protein)
        gene_names <- mapping[protein_ids]
    }
} else {
    cat("No gene mapping file provided, using protein IDs as gene names\n")
    gene_names <- protein_ids
}

# Handle NA gene names
gene_names[is.na(gene_names)] <- protein_ids[is.na(gene_names)]

# Create output data frame
protein_df <- as.data.frame(protein_matrix)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name <- gene_names

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
