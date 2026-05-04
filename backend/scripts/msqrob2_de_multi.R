#!/usr/bin/env Rscript
#
# msqrob2 Differential Expression Analysis — Multi-Condition (Step 7)
#
# Performs differential expression analysis for N conditions with M arbitrary
# contrasts using limma's contrast matrix capability.
#
# Usage: Rscript msqrob2_de_multi.R <protein_abundance_file> <output_dir> <comparisons_json> <gene_mapping_file>
#
# comparisons_json: JSON array of {"treatment": "A", "control": "B"} objects
# gene_mapping_file: optional (ignored, kept for API compatibility)

suppressPackageStartupMessages({
    library(data.table)
    library(limma)
    library(matrixStats)
    library(jsonlite)
})

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 3) {
    stop("Usage: Rscript msqrob2_de_multi.R <protein_abundance_file> <output_dir> <comparisons_json> [gene_mapping_file]")
}

input_file <- args[1]
output_dir <- args[2]
comparisons_json <- args[3]
gene_mapping_file <- if (length(args) >= 4) args[4] else NULL

cat("Step 7 (multi): Running multi-condition differential expression analysis\n")
cat("Input file:", input_file, "\n")
cat("Output dir:", output_dir, "\n")
cat("Comparisons JSON:", comparisons_json, "\n")
flush.console()

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Create output directory if it doesn't exist
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# Parse comparisons JSON
comparisons <- fromJSON(comparisons_json, simplifyVector = FALSE)
if (length(comparisons) == 0) {
    stop("No comparisons provided in JSON")
}
cat("Number of comparisons:", length(comparisons), "\n")
for (i in seq_along(comparisons)) {
    cat("  Comparison", i, ":", comparisons[[i]]$treatment, "vs", comparisons[[i]]$control, "\n")
}
flush.console()

# Read protein abundances
cat("Reading protein abundances...\n")
flush.console()
protein_data <- fread(input_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)

cat("Loaded", nrow(protein_data), "proteins\n")
flush.console()

# Identify ID columns and abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "Protein", "PSM_Count")
id_cols_present <- intersect(id_cols, names(protein_data))
abundance_cols <- setdiff(names(protein_data), id_cols_present)

cat("All non-ID columns:", paste(abundance_cols, collapse = ", "), "\n")
flush.console()

# Filter to only numeric columns
abundance_cols <- abundance_cols[vapply(protein_data[, abundance_cols], is.numeric, logical(1))]

cat("Found", length(abundance_cols), "abundance columns\n")
cat("Abundance columns:", paste(abundance_cols, collapse = ", "), "\n")
flush.console()

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Create matrix
protein_matrix <- as.matrix(protein_data[, abundance_cols])
rownames(protein_matrix) <- protein_data$Master_Protein_Accessions

# Pre-filter: remove proteins with zero variance (no DE signal, wastes compute)
cat("Checking for zero-variance proteins...\n")
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

# Collect ALL unique condition names from comparisons
all_conditions <- unique(c(
    sapply(comparisons, function(x) x$treatment),
    sapply(comparisons, function(x) x$control)
))
cat("All unique conditions:", paste(all_conditions, collapse = ", "), "\n")

# Create column data with condition information
col_data <- data.frame(
    sample = abundance_cols,
    stringsAsFactors = FALSE
)

# Sort conditions by length (longest first) to avoid partial matches
# Sort by length descending — shorter condition names could be substrings of longer ones.
# e.g., "DrugLow" should match before "Drug" for "DrugLow_Rep1_F2".
# Length-based ordering mitigates grepl substring matching risk.
all_conditions <- all_conditions[order(-nchar(all_conditions))]

# Determine condition for each sample by matching against ALL condition names
col_data$condition <- sapply(abundance_cols, function(x) {
    for (cond in all_conditions) {
        if (grepl(cond, x, ignore.case = TRUE, fixed = TRUE)) {
            return(cond)
        }
    }
    # Fallback: try to extract from pattern
    parts <- strsplit(x, "_")[[1]]
    if (length(parts) >= 2) {
        return(parts[1])
    }
    return(x)
})

# Convert to factor with all conditions as levels
col_data$condition <- factor(col_data$condition, levels = all_conditions)

cat("Sample conditions:\n")
print(table(col_data$condition))

# Verify all conditions from comparisons were found in sample columns
conditions_found <- unique(col_data$condition)
missing_conditions <- setdiff(all_conditions, conditions_found)
if (length(missing_conditions) > 0) {
    stop(paste("Condition(s) not found in sample columns:",
               paste(missing_conditions, collapse = ", ")))
}

# Warn if any condition has fewer than 2 replicates
condition_counts <- table(col_data$condition)
if (any(condition_counts < 2)) {
    warning("Some conditions have fewer than 2 replicates: ",
            paste(names(condition_counts[condition_counts < 2]), collapse = ", "))
}

# Check that we have at least 2 conditions
if (length(unique(col_data$condition)) < 2) {
    stop("At least two conditions must be present in the data")
}

# Create design matrix: ~ 0 + condition gives one column per condition
cat("Creating design matrix...\n")
design <- model.matrix(~ 0 + condition, data = col_data)
colnames(design) <- levels(col_data$condition)

cat("Design matrix:\n")
print(design)

cat("Design matrix dimensions:", nrow(design), "rows x", ncol(design), "columns\n")
cat("Protein matrix dimensions:", nrow(protein_matrix), "rows x", ncol(protein_matrix), "columns\n")
flush.console()

# Check dimensions match
if (nrow(design) != ncol(protein_matrix)) {
    stop(paste("Dimension mismatch: design has", nrow(design), "rows but protein matrix has",
               ncol(protein_matrix), "columns"))
}

# Fit linear model (protein abundances from Step 6 are already log2 transformed)
cat("Fitting linear models with limma...\n")
fit <- lmFit(protein_matrix, design)

# Build contrast matrix: one row per comparison
contrast_names <- sapply(comparisons, function(x) {
    paste0(x$treatment, "_vs_", x$control)
})
contrast_matrix <- matrix(0, nrow = length(comparisons), ncol = ncol(design))
colnames(contrast_matrix) <- colnames(design)
rownames(contrast_matrix) <- contrast_names

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    treat <- comp$treatment
    ctrl <- comp$control
    # +1 for treatment column, -1 for control column
    if (!(treat %in% colnames(design))) {
        stop(paste("Treatment condition '", treat, "' not found in design matrix columns:",
                   paste(colnames(design), collapse = ", ")))
    }
    if (!(ctrl %in% colnames(design))) {
        stop(paste("Control condition '", ctrl, "' not found in design matrix columns:",
                   paste(colnames(design), collapse = ", ")))
    }
    contrast_matrix[i, treat] <- 1
    contrast_matrix[i, ctrl] <- -1
}

cat("Contrast matrix:\n")
print(contrast_matrix)

# Fit contrasts and apply eBayes
fit2 <- contrasts.fit(fit, contrast_matrix)
fit2 <- eBayes(fit2)

cat("Model fitting complete\n")
flush.console()

# Extract results for each comparison and write output files
cat("Extracting differential expression results...\n")

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    treat <- comp$treatment
    ctrl <- comp$control
    label <- paste0(treat, "_vs_", ctrl)

    cat("  Processing comparison", i, ":", label, "\n")

    # Get topTable results for this contrast
    results_df <- topTable(fit2, coef = i, number = Inf, sort.by = "p", adjust.method = "BH")

    # Convert to data frame if needed
    if (!is.data.frame(results_df)) {
        results_df <- as.data.frame(results_df)
    }

    # Add protein IDs
    results_df$Master_Protein_Accessions <- rownames(results_df)

    # Add gene names from protein_data if available
    if ("Gene_Name" %in% names(protein_data)) {
        gene_map <- setNames(protein_data$Gene_Name, protein_data$Master_Protein_Accessions)
        results_df$Gene_Name <- gene_map[rownames(results_df)]
    }

    # Add PSM counts from protein_data if available
    if ("PSM_Count" %in% names(protein_data)) {
        psm_map <- setNames(protein_data$PSM_Count, protein_data$Master_Protein_Accessions)
        results_df$PSM_Count <- psm_map[rownames(results_df)]
        results_df$PSM_Count[is.na(results_df$PSM_Count)] <- 0
    }

    # Ensure required columns exist with expected names
    if (!"logFC" %in% names(results_df)) {
        if ("coef" %in% names(results_df)) {
            results_df$logFC <- results_df$coef
        } else {
            results_df$logFC <- NA
        }
    }
    if (!"pval" %in% names(results_df)) {
        if ("P.Value" %in% names(results_df)) {
            results_df$pval <- results_df$P.Value
        } else if ("pvalue" %in% names(results_df)) {
            results_df$pval <- results_df$pvalue
        } else {
            results_df$pval <- NA
        }
    }
    if (!"adjPval" %in% names(results_df)) {
        if ("adj.P.Val" %in% names(results_df)) {
            results_df$adjPval <- results_df$adj.P.Val
        } else if ("padj" %in% names(results_df)) {
            results_df$adjPval <- results_df$padj
        } else {
            results_df$adjPval <- NA
        }
    }
    if (!"se" %in% names(results_df)) {
        results_df$se <- NA
    }

    # Reorder columns
    col_order <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count", "logFC", "pval", "adjPval", "se")
    cols_present <- intersect(col_order, names(results_df))
    other_cols <- setdiff(names(results_df), cols_present)
    results_df <- results_df[, c(cols_present, other_cols)]

    # Add back zero-variance proteins with default values
    if (length(zero_var_ids) > 0) {
        cat("    Adding back", length(zero_var_ids), "zero-variance proteins\n")
        zero_var_df <- data.frame(
            Master_Protein_Accessions = zero_var_ids,
            stringsAsFactors = FALSE
        )
        if ("Gene_Name" %in% names(results_df)) {
            gene_map <- setNames(protein_data$Gene_Name, protein_data$Master_Protein_Accessions)
            zero_var_df$Gene_Name <- gene_map[zero_var_ids]
        }
        if ("PSM_Count" %in% names(results_df)) {
            psm_map <- setNames(protein_data$PSM_Count, protein_data$Master_Protein_Accessions)
            zero_var_df$PSM_Count <- psm_map[zero_var_ids]
            zero_var_df$PSM_Count[is.na(zero_var_df$PSM_Count)] <- 0
        }
        zero_var_df$logFC <- 0
        zero_var_df$pval <- NA
        zero_var_df$adjPval <- NA
        if ("se" %in% names(results_df)) {
            zero_var_df$se <- NA
        }
        # Add any other columns
        for (col in setdiff(names(results_df), names(zero_var_df))) {
            zero_var_df[[col]] <- NA
        }
        zero_var_df <- zero_var_df[, names(results_df)]
        results_df <- rbind(results_df, zero_var_df)
    }

    # Write per-comparison output file
    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    cat("    Writing results to:", output_file, "\n")
    write.table(
        results_df,
        file = output_file,
        sep = "\t",
        row.names = FALSE,
        quote = FALSE
    )

    # Print summary
    sig_count <- sum(results_df$adjPval < 0.05, na.rm = TRUE)
    up_count <- sum(results_df$logFC > 0 & results_df$adjPval < 0.05, na.rm = TRUE)
    down_count <- sum(results_df$logFC < 0 & results_df$adjPval < 0.05, na.rm = TRUE)
    cat("    Total proteins:", nrow(results_df), "\n")
    cat("    Significant (adjPval < 0.05):", sig_count, "\n")
    cat("    Upregulated:", up_count, "\n")
    cat("    Downregulated:", down_count, "\n")
    flush.console()
}

cat("\nStep 7 (multi) complete: Multi-condition differential expression analysis finished successfully\n")
