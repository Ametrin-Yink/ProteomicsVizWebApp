#!/usr/bin/env Rscript
#
# msqrob2 Differential Expression Analysis (Step 7)
#
# Performs differential expression analysis using robust linear models.
# Input: Protein_Abundances.tsv from Step 6
# Output: Diff_Expression.tsv
#
# Usage: Rscript msqrob2_de.R <input_file> <output_file> <treatment> <control>

suppressPackageStartupMessages({
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
})

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 4) {
    stop("Usage: Rscript msqrob2_de.R <input_file> <output_file> <treatment> <control>")
}

input_file <- args[1]
output_file <- args[2]
treatment <- args[3]
control <- args[4]

cat("Step 7: Running differential expression analysis with msqrob2\n")
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("Treatment:", treatment, "\n")
cat("Control:", control, "\n")

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Read protein abundances
cat("Reading protein abundances...\n")
protein_data <- read.delim(input_file, sep = "\t", stringsAsFactors = FALSE, check.names = FALSE)

cat("Loaded", nrow(protein_data), "proteins\n")

# Identify ID columns and abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "Protein")
id_cols_present <- intersect(id_cols, names(protein_data))
abundance_cols <- setdiff(names(protein_data), id_cols_present)

# Filter to only numeric columns
abundance_cols <- abundance_cols[sapply(protein_data[abundance_cols], is.numeric)]

cat("Found", length(abundance_cols), "abundance columns\n")

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Create matrix
protein_matrix <- as.matrix(protein_data[, abundance_cols, drop = FALSE])
rownames(protein_matrix) <- protein_data$Master_Protein_Accessions

# Create column data with condition information
col_data <- data.frame(
    sample = abundance_cols,
    stringsAsFactors = FALSE
)

# Determine condition for each sample based on column names
col_data$condition <- sapply(abundance_cols, function(x) {
    # Check if treatment or control is in the sample name
    if (grepl(treatment, x, ignore.case = TRUE)) {
        return("Treatment")
    } else if (grepl(control, x, ignore.case = TRUE)) {
        return("Control")
    } else {
        # Try to extract from pattern
        parts <- strsplit(x, "_")[[1]]
        if (length(parts) >= 2) {
            return(parts[1])
        }
        return(x)
    }
})

# Convert to factor with Control as reference
col_data$condition <- factor(col_data$condition, levels = c("Control", "Treatment"))

cat("Sample conditions:\n")
print(table(col_data$condition))

# Check that both conditions are present
if (length(unique(col_data$condition)) < 2) {
    stop("Both treatment and control conditions must be present in the data")
}

# Create row data
row_data <- DataFrame(
    Master_Protein_Accessions = protein_data$Master_Protein_Accessions
)

if ("Gene_Name" %in% names(protein_data)) {
    row_data$Gene_Name <- protein_data$Gene_Name
}

rownames(row_data) <- protein_data$Master_Protein_Accessions

# Create SummarizedExperiment
se <- SummarizedExperiment(
    assays = list(counts = protein_matrix),
    rowData = row_data,
    colData = col_data
)

# Create QFeatures object
pe <- QFeatures(list(protein = se))

# Set colData at QFeatures level (required for msqrob)
colData(pe) <- colData(se)

cat("Created QFeatures object with", nrow(pe[["protein"]]), "proteins\n")
cat("colData in QFeatures:\n")
print(colData(pe))

# Fit robust linear model with msqrob
cat("Fitting robust linear models...\n")

pe <- tryCatch({
    msqrob(
        object = pe,
        i = "protein",
        formula = ~ condition,
        modelColumnName = "rlm",
        robust = TRUE
    )
}, error = function(e) {
    cat("Error in msqrob:", conditionMessage(e), "\n")
    stop("Differential expression analysis failed")
})

cat("Model fitting complete\n")

# Extract results
cat("Extracting differential expression results...\n")

# Get the model coefficients to build contrast
models <- rowData(pe[["protein"]])$rlm
coef_names <- names(getCoef(models[[1]]))
cat("Model coefficients:", coef_names, "\n")

# Build contrast for Treatment vs Control
# The contrast tests if conditionTreatment = 0 (i.e., Treatment vs Control)
L <- makeContrast("conditionTreatment=0", coef_names)

# Get the results for the condition effect using topFeatures
results_df <- topFeatures(
    models,
    contrast = L,
    adjust.method = "BH",
    sort = TRUE,
    alpha = 1  # Return all features
)

# Convert to data frame if needed
if (!is.data.frame(results_df)) {
    results_df <- as.data.frame(results_df)
}

# Add protein IDs
results_df$Master_Protein_Accessions <- rownames(results_df)

# Add gene names if available
if ("Gene_Name" %in% names(rowData(pe[["protein"]]))) {
    results_df$Gene_Name <- rowData(pe[["protein"]])$Gene_Name
}

# Rename columns for consistency
name_mapping <- c(
    "logFC" = "logFC",
    "pval" = "pval",
    "adjPval" = "adjPval",
    "se" = "se",
    "df" = "df"
)

# Check available columns and rename
for (new_name in names(name_mapping)) {
    old_name <- name_mapping[new_name]
    if (old_name %in% names(results_df)) {
        names(results_df)[names(results_df) == old_name] <- new_name
    }
}

# Ensure required columns exist
required_cols <- c("logFC", "pval", "adjPval")
for (col in required_cols) {
    if (!(col %in% names(results_df))) {
        # Try to find alternative column names
        if (col == "logFC" && "coef" %in% names(results_df)) {
            results_df$logFC <- results_df$coef
        } else if (col == "pval" && "pvalue" %in% names(results_df)) {
            results_df$pval <- results_df$pvalue
        } else if (col == "adjPval" && "padj" %in% names(results_df)) {
            results_df$adjPval <- results_df$padj
        } else {
            results_df[[col]] <- NA
        }
    }
}

# Reorder columns
col_order <- c("Master_Protein_Accessions", "Gene_Name", "logFC", "pval", "adjPval", "se", "df")
cols_present <- intersect(col_order, names(results_df))
other_cols <- setdiff(names(results_df), cols_present)
results_df <- results_df[, c(cols_present, other_cols)]

# Write output
cat("Writing differential expression results to:", output_file, "\n")
write.table(
    results_df,
    file = output_file,
    sep = "\t",
    row.names = FALSE,
    quote = FALSE
)

# Print summary
cat("\nDifferential Expression Summary:\n")
cat("Total proteins:", nrow(results_df), "\n")
cat("Significant proteins (adjPval < 0.05):", sum(results_df$adjPval < 0.05, na.rm = TRUE), "\n")
cat("Upregulated (logFC > 0 & adjPval < 0.05):", sum(results_df$logFC > 0 & results_df$adjPval < 0.05, na.rm = TRUE), "\n")
cat("Downregulated (logFC < 0 & adjPval < 0.05):", sum(results_df$logFC < 0 & results_df$adjPval < 0.05, na.rm = TRUE), "\n")

cat("\nStep 7 complete: Differential expression analysis finished successfully\n")
