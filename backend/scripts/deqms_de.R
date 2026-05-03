#!/usr/bin/env Rscript
#
# DEqMS Differential Expression Analysis (Step 7)
#
# Performs differential expression analysis using limma + DEqMS spectraCounteBayes.
# Input: Protein_Abundances.tsv from Step 6
# Output: Diff_Expression.tsv
#
# Usage: Rscript deqms_de.R <input_file> <output_file> <treatment> <control> <fit_method>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(DEqMS)
    library(limma)
    library(matrixStats)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop("Usage: Rscript deqms_de.R <input_file> <output_file> <treatment> <control> <fit_method>")
}

input_file <- args[1]
output_file <- args[2]
treatment <- args[3]
control <- args[4]
fit_method <- if (length(args) >= 5) args[5] else "loess"

cat("Step 7: DEqMS Differential Expression Analysis\n")
cat("Treatment:", treatment, "\n")
cat("Control:", control, "\n")
cat("Fit method:", fit_method, "\n")

# Read protein abundance data
cat("Reading protein abundance data...\n")
data <- fread(input_file, header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)
cat("Loaded", nrow(data), "proteins,", ncol(data), "columns\n")

# Identify ID columns and abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count")
abundance_cols <- setdiff(colnames(data), id_cols)
# Keep only numeric abundance columns
abundance_cols <- abundance_cols[sapply(data[, abundance_cols, drop = FALSE], is.numeric)]
cat("Abundance columns:", length(abundance_cols), "\n")

# Pre-filter zero-variance proteins (add them back later with default values)
abundance_matrix <- as.matrix(data[, abundance_cols, drop = FALSE])
rownames(abundance_matrix) <- data$Master_Protein_Accessions

zero_var_mask <- apply(abundance_matrix, 1, function(x) {
    vals <- x[!is.na(x)]
    length(vals) < 2 || sd(vals, na.rm = TRUE) == 0
})
zero_var_proteins <- data[zero_var_mask, ]
data_filtered <- data[!zero_var_mask, ]
abundance_matrix <- as.matrix(data_filtered[, abundance_cols, drop = FALSE])
rownames(abundance_matrix) <- data_filtered$Master_Protein_Accessions

if (nrow(zero_var_proteins) > 0) {
    cat("Zero-variance proteins:", nrow(zero_var_proteins), "(will be excluded from analysis)\n")
}

# Create condition metadata from column names
col_data <- data.frame(SampleName = abundance_cols, stringsAsFactors = FALSE)

# Determine conditions from column names using grepl (fixed=TRUE for safety)
get_condition <- function(sample_name, treatment, control) {
    if (grepl(treatment, sample_name, ignore.case = TRUE, fixed = TRUE)) {
        return("Treatment")
    } else if (grepl(control, sample_name, ignore.case = TRUE, fixed = TRUE)) {
        return("Control")
    } else {
        # Fallback: split by underscore and take the first part
        parts <- strsplit(sample_name, "_")[[1]]
        return(parts[1])
    }
}

col_data$Condition <- sapply(col_data$SampleName, get_condition,
                             treatment = treatment, control = control)
table(col_data$Condition)

# Convert to factor with Control as reference
col_data$Condition <- factor(col_data$Condition, levels = c("Control", "Treatment"))

cat("Conditions:", paste(unique(col_data$Condition), collapse = ", "), "\n")
cat("Sample counts:", paste(table(col_data$Condition), collapse = ", "), "\n")

# Build expression object for limma
cat("Fitting limma model...\n")
design <- model.matrix(~ 0 + Condition, data = col_data)
colnames(design) <- levels(col_data$Condition)
cat("Design matrix:\n")
print(design)

# Fit linear model
fit <- lmFit(abundance_matrix, design)

# Create contrast
contrast_formula <- paste("Treatment", "-", "Control")
contrast_matrix <- makeContrasts(contrasts = contrast_formula, levels = design)
cat("Contrast:", contrast_formula, "\n")

fit2 <- contrasts.fit(fit, contrast_matrix)

# Attach PSM counts to fit object
fit2$count <- as.numeric(data_filtered$PSM_Count)
cat("PSM counts attached:", length(fit2$count), "proteins\n")
cat("PSM count range:", range(fit2$count, na.rm = TRUE), "\n")

# DEqMS moderation: first run standard eBayes, then apply spectraCounteBayes
cat("Running limma eBayes...\n")
fit_eb <- eBayes(fit2)

cat("Running DEqMS spectraCounteBayes with fit.method =", fit_method, "...\n")
fit_deqms <- DEqMS::spectraCounteBayes(fit_eb, fit.method = fit_method, coef_col = 1)
cat("DEqMS moderation complete\n")

# Extract results
cat("Extracting results...\n")
results <- DEqMS::outputResult(fit_deqms, coef_col = 1)

# Rename columns to match backend expectations
# Primary (DEqMS-moderated): sca.P.Value -> pval, sca.adj.pval -> adjPval, sca.t -> t
# Secondary (standard limma): P.Value -> limma_pval, adj.P.Val -> limma_adjPval, t -> limma_t
results$pval <- results$sca.P.Value
results$adjPval <- results$sca.adj.pval
results$t <- results$sca.t
results$limma_pval <- results$P.Value
results$limma_adjPval <- results$adj.P.Val
results$limma_t <- results$t
results$PSM_Count <- results$count

# Map protein accessions to gene names from the input file
gene_lookup <- setNames(data_filtered$Gene_Name, data_filtered$Master_Protein_Accessions)
results$Gene_Name <- sapply(rownames(results), function(acc) {
    g <- gene_lookup[[acc]]
    if (is.null(g) || is.na(g)) "" else as.character(g)
})

# Add se (not produced by outputResult; visualization.py handles NA gracefully)
results$se <- NA_real_

# Ensure Gene_Name has no NA/empty values (fill with protein accession)
results$Gene_Name[is.na(results$Gene_Name) | results$Gene_Name == ""] <- rownames(results)[is.na(results$Gene_Name) | results$Gene_Name == ""]

# Build output with correct column order
output_df <- data.frame(
    Master_Protein_Accessions = rownames(results),
    Gene_Name = results$Gene_Name,
    PSM_Count = as.integer(results$PSM_Count),
    logFC = results$logFC,
    pval = results$pval,
    adjPval = results$adjPval,
    t = results$t,
    se = results$se,
    limma_pval = results$limma_pval,
    limma_adjPval = results$limma_adjPval,
    limma_t = results$limma_t,
    stringsAsFactors = FALSE
)

# Add zero-variance proteins back with default values
if (nrow(zero_var_proteins) > 0) {
    zv_genes <- setNames(zero_var_proteins$Gene_Name, zero_var_proteins$Master_Protein_Accessions)
    zero_df <- data.frame(
        Master_Protein_Accessions = zero_var_proteins$Master_Protein_Accessions,
        Gene_Name = sapply(zero_var_proteins$Master_Protein_Accessions, function(acc) {
            g <- zv_genes[[acc]]
            if (is.null(g) || is.na(g)) "" else as.character(g)
        }),
        PSM_Count = as.integer(zero_var_proteins$PSM_Count),
        logFC = 0,
        pval = 1,
        adjPval = 1,
        t = 0,
        se = NA_real_,
        limma_pval = 1,
        limma_adjPval = 1,
        limma_t = 0,
        stringsAsFactors = FALSE
    )
    output_df <- rbind(output_df, zero_df)
}

# Write output
cat("Writing output to", output_file, "\n")
fwrite(output_df, output_file, sep = "\t")

# Print summary
sig_df <- output_df[output_df$adjPval < 0.05, ]
up <- sig_df[sig_df$logFC > 0, ]
down <- sig_df[sig_df$logFC < 0, ]
cat("\n=== DEqMS DE Summary ===\n")
cat("Total proteins:", nrow(output_df), "\n")
cat("Significant (adjPval < 0.05):", nrow(sig_df), "\n")
cat("Upregulated:", nrow(up), "\n")
cat("Downregulated:", nrow(down), "\n")
