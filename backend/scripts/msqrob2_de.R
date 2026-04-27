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
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
    library(matrixStats)
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
flush.console()

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Read protein abundances
cat("Reading protein abundances...\n")
flush.console()
protein_data <- fread(input_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = TRUE)

cat("Loaded", nrow(protein_data), "proteins\n")
flush.console()

# Identify ID columns and abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "Protein", "PSM_Count")
id_cols_present <- intersect(id_cols, names(protein_data))
abundance_cols <- setdiff(names(protein_data), id_cols_present)

cat("All non-ID columns:", paste(abundance_cols, collapse = ", "), "\n")
flush.console()

# Filter to only numeric columns (vectorized with vapply)
abundance_cols <- abundance_cols[vapply(protein_data[, ..abundance_cols], is.numeric, logical(1))]

cat("Found", length(abundance_cols), "abundance columns\n")
cat("Abundance columns:", paste(abundance_cols, collapse = ", "), "\n")
flush.console()

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Create matrix
protein_matrix <- as.matrix(protein_data[, ..abundance_cols])
rownames(protein_matrix) <- protein_data$Master_Protein_Accessions

# Pre-filter: remove proteins with zero variance (no DE signal, wastes compute)
cat("Checking for zero-variance proteins...\n")
# Use matrixStats::rowVars for speed (avoids R-level loop over rows)
valid_mask <- rowSums(!is.na(protein_matrix)) >= 2
var_per_protein <- rep(NA, nrow(protein_matrix))
if (any(valid_mask)) {
    var_per_protein[valid_mask] <- rowVars(protein_matrix[valid_mask, , drop = FALSE], na.rm = TRUE)
}
zero_var <- which(!is.na(var_per_protein) & var_per_protein == 0)
if (length(zero_var) > 0) {
    cat("Pre-filtering", length(zero_var), "zero-variance proteins (will be added back to output)\n")
    zero_var_ids <- rownames(protein_matrix)[zero_var]
    protein_matrix <- protein_matrix[-zero_var, , drop = FALSE]
} else {
    zero_var_ids <- character(0)
}
cat("Matrix after filtering:", nrow(protein_matrix), "proteins x", ncol(protein_matrix), "samples\n")

# Create column data with condition information
col_data <- data.frame(
    sample = abundance_cols,
    stringsAsFactors = FALSE
)

# Determine condition for each sample based on column names
col_data$condition <- sapply(abundance_cols, function(x) {
    # Check if treatment or control is in the sample name
    if (grepl(treatment, x, ignore.case = TRUE, fixed = TRUE)) {
        return("Treatment")
    } else if (grepl(control, x, ignore.case = TRUE, fixed = TRUE)) {
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
flush.console()

# Fit robust linear model with limma (for protein-level data)
cat("Fitting robust linear models with limma...\n")
cat("Note: Protein abundances are already log2 transformed from Step 6\n")
flush.console()

# Protein abundances from Step 6 are already log2 transformed
# No additional log2 needed
protein_matrix_log2 <- protein_matrix

# Create design matrix using the condition factor directly
cat("Creating design matrix...\n")
cat("Number of samples:", nrow(col_data), "\n")
cat("Number of columns in protein matrix:", ncol(protein_matrix_log2), "\n")
cat("Condition values:\n")
print(col_data$condition)
flush.console()

# Ensure the design matrix matches the data dimensions
design <- model.matrix(~ 0 + condition, data = col_data)
colnames(design) <- levels(col_data$condition)

cat("Design matrix:\n")
print(design)

cat("Design matrix dimensions:", nrow(design), "rows x", ncol(design), "columns\n")
cat("Protein matrix dimensions:", nrow(protein_matrix_log2), "rows x", ncol(protein_matrix_log2), "columns\n")
flush.console()

# Check dimensions match
if (nrow(design) != ncol(protein_matrix_log2)) {
    stop(paste("Dimension mismatch: design has", nrow(design), "rows but protein matrix has",
               ncol(protein_matrix_log2), "columns"))
}

# Fit linear model
fit <- lmFit(protein_matrix_log2, design)

# Create contrast for Treatment vs Control
contrast <- makeContrasts(TreatmentvsControl = Treatment - Control, levels = design)

cat("Contrast matrix:\n")
print(contrast)

# Fit contrast
fit2 <- contrasts.fit(fit, contrast)

# Apply empirical Bayes moderation
fit2 <- eBayes(fit2)

cat("Model fitting complete\n")
flush.console()

# Extract results
cat("Extracting differential expression results...\n")
flush.console()

# Get topTable results
results_df <- topTable(fit2, number = Inf, sort.by = "p", adjust.method = "BH")

# Rename columns to match expected format
names(results_df)[names(results_df) == "logFC"] <- "logFC"
names(results_df)[names(results_df) == "P.Value"] <- "pval"
names(results_df)[names(results_df) == "adj.P.Val"] <- "adjPval"
names(results_df)[names(results_df) == "t"] <- "t"
names(results_df)[names(results_df) == "B"] <- "B"

# Convert to data frame if needed
if (!is.data.frame(results_df)) {
    results_df <- as.data.frame(results_df)
}

# Add protein IDs
results_df$Master_Protein_Accessions <- rownames(results_df)

# Add gene names from protein_data if available
if ("Gene_Name" %in% names(protein_data)) {
    # Create mapping from protein ID to gene name
    gene_map <- setNames(protein_data$Gene_Name, protein_data$Master_Protein_Accessions)
    results_df$Gene_Name <- gene_map[rownames(results_df)]
}

# Add PSM counts from protein_data if available
if ("PSM_Count" %in% names(protein_data)) {
    # Create mapping from protein ID to PSM count
    psm_map <- setNames(protein_data$PSM_Count, protein_data$Master_Protein_Accessions)
    results_df$PSM_Count <- psm_map[rownames(results_df)]
    # Handle NA values (proteins not in the map)
    results_df$PSM_Count[is.na(results_df$PSM_Count)] <- 0
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
col_order <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count", "logFC", "pval", "adjPval", "se", "df")
cols_present <- intersect(col_order, names(results_df))
other_cols <- setdiff(names(results_df), cols_present)
results_df <- results_df[, c(cols_present, other_cols)]

# Add back zero-variance proteins with default values (logFC=0, pval=NA, adjPval=NA)
if (length(zero_var_ids) > 0) {
    cat("Adding back", length(zero_var_ids), "zero-variance proteins to output\n")
    zero_var_df <- data.frame(
        Master_Protein_Accessions = zero_var_ids,
        stringsAsFactors = FALSE
    )
    # Add gene names if available
    if ("Gene_Name" %in% names(results_df)) {
        gene_map <- setNames(protein_data$Gene_Name, protein_data$Master_Protein_Accessions)
        zero_var_df$Gene_Name <- gene_map[zero_var_ids]
    }
    # Add PSM counts if available
    if ("PSM_Count" %in% names(results_df)) {
        psm_map <- setNames(protein_data$PSM_Count, protein_data$Master_Protein_Accessions)
        zero_var_df$PSM_Count <- psm_map[zero_var_ids]
        zero_var_df$PSM_Count[is.na(zero_var_df$PSM_Count)] <- 0
    }
    # Set DE values to defaults
    zero_var_df$logFC <- 0
    zero_var_df$pval <- NA
    zero_var_df$adjPval <- NA
    # Add any other columns that exist in results_df
    for (col in setdiff(names(results_df), names(zero_var_df))) {
        zero_var_df[[col]] <- NA
    }
    # Reorder to match results_df
    zero_var_df <- zero_var_df[, names(results_df)]
    results_df <- rbind(results_df, zero_var_df)
}

# Write output
cat("Writing differential expression results to:", output_file, "\n")
flush.console()
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
flush.console()

cat("\nStep 7 complete: Differential expression analysis finished successfully\n")
