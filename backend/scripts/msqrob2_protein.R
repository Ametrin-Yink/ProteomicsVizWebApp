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

# Count PSMs per protein before aggregation
# Get the protein assignments from the peptide assay
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
cat("Calculated PSM counts for", length(protein_psm_counts), "proteins\n")

# Log2 transform peptide abundances (required before normalization and aggregation)
cat("Log2 transforming peptide abundances...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
cat("Log2 transformation complete\n")

# Median centering normalization
cat("Applying median centering normalization...\n")
pe <- normalize(pe,
                i = "peptide_log2",
                name = "peptide_norm",
                method = "center.median")
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

pe <- aggregateFeatures(
    object = pe,
    i = "peptide_norm",
    fcol = "Proteins",
    name = "protein",
    fun = MsCoreUtils::robustSummary
)

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

        # Handle multi-ID proteins by looking up each ID and taking first match
        gene_names <- sapply(protein_ids, function(pid) {
            # Check if this is a multi-ID protein (contains semicolon)
            if (grepl(";", pid)) {
                # Split by semicolon and try each ID
                ids <- strsplit(pid, ";")[[1]]
                ids <- trimws(ids)  # Remove whitespace
                for (id in ids) {
                    if (!is.na(mapping[id])) {
                        return(mapping[id])
                    }
                }
                return(NA)  # No match found for any ID
            } else {
                # Single ID - direct lookup
                return(mapping[pid])
            }
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

# Get PSM counts for each protein
psm_counts <- sapply(protein_ids, function(pid) {
    count <- protein_psm_counts[pid]
    if (is.na(count)) 0 else as.integer(count)
})

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
