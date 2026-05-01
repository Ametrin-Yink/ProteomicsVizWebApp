#!/usr/bin/env Rscript
#
# MSstats Group Comparison (Step 7 - MSstats pipeline)
#
# Loads processed data from dataProcess step, runs groupComparison,
# and outputs Diff_Expression.tsv in msqrob2-compatible format.
#
# Usage: Rscript msstats_group_comparison.R <rds_file> <output_file>
#        <treatment> <control> <gene_mapping_file>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(MSstats)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste("Usage: Rscript msstats_group_comparison.R <rds_file> <output_file>",
               "<treatment> <control> <gene_mapping_file>"))
}

rds_file        <- args[1]
output_file     <- args[2]
treatment       <- args[3]
control         <- args[4]
gene_mapping_file <- if (nzchar(args[5])) args[5] else NULL

cat("Step 7: Running differential expression analysis with MSstats\n")
cat("Arguments received:", length(args), "\n")
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("RDS file:", rds_file, "\n")
cat("Output file:", output_file, "\n")
cat("Treatment:", treatment, "\n")
cat("Control:", control, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")
flush.console()

# Check if RDS file exists
if (!file.exists(rds_file)) {
    stop(paste("RDS file not found:", rds_file))
}

# Load processed data from dataProcess step
cat("Loading processed data from RDS...\n")
processed <- readRDS(rds_file)
cat("Loaded processed data\n")
cat("Processed object class:", class(processed), "\n")
cat("Processed object slots/names:", paste(names(processed), collapse = ", "), "\n")
flush.console()

# Get the annotation data from the processed object
# MSstats stores condition info in the processed object
cat("Extracting annotation data...\n")
annotation <- processed$Annotation
if (is.null(annotation)) {
    # Fallback: try to get from QuantProtein (the quantified protein data)
    annotation <- processed$QuantProtein
}
cat("Annotation rows:", ifelse(is.null(annotation), "NULL", nrow(annotation)), "\n")
cat("Annotation columns:", ifelse(is.null(annotation), "NULL", paste(names(annotation), collapse = ", ")), "\n")
flush.console()

# Determine available condition levels from the processed object
# MSstats stores conditions in the annotation/QuantProtein data
if (!is.null(annotation) && "Condition" %in% names(annotation)) {
    condition_levels <- unique(annotation$Condition)
} else {
    # Fallback: try to infer from the dataProcess input stored in the object
    if ("Input" %in% names(processed)) {
        input_data <- processed$Input
        if (!is.null(input_data) && "Condition" %in% names(input_data)) {
            condition_levels <- unique(input_data$Condition)
        } else {
            stop("Could not determine condition levels from processed object")
        }
    } else {
        stop("Could not find input data in processed object")
    }
}

cat("Condition levels:", paste(condition_levels, collapse = ", "), "\n")
cat("Treatment:", treatment, "\n")
cat("Control:", control, "\n")
flush.console()

# Verify treatment and control are in the conditions
if (!(treatment %in% condition_levels)) {
    stop(paste("Treatment condition '", treatment, "' not found in data. Available:",
               paste(condition_levels, collapse = ", ")))
}
if (!(control %in% condition_levels)) {
    stop(paste("Control condition '", control, "' not found in data. Available:",
               paste(condition_levels, collapse = ", ")))
}

# Build contrast matrix
# Row name: "Treatment_vs_Control", columns are condition levels
# +1 for treatment, -1 for control, 0 for others
contrast_vector <- rep(0, length(condition_levels))
names(contrast_vector) <- condition_levels
contrast_vector[treatment] <- 1
contrast_vector[control] <- -1

contrast_matrix <- matrix(contrast_vector, nrow = 1)
rownames(contrast_matrix) <- paste(treatment, "vs", control, sep = "_")
colnames(contrast_matrix) <- condition_levels

cat("Contrast matrix:\n")
print(contrast_matrix)
flush.console()

# Call MSstats::groupComparison
cat("Calling MSstats::groupComparison...\n")
flush.console()

group_comp <- tryCatch({
    MSstats::groupComparison(
        contrast.matrix = contrast_matrix,
        data = processed,
        logBase = 2
    )
}, error = function(e) {
    cat("MSstats::groupComparison failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("groupComparison complete\n")
flush.console()

# Extract ComparisonResult dataframe
cat("Extracting comparison results...\n")
comparison_result <- group_comp$ComparisonResult
if (is.null(comparison_result)) {
    stop("No ComparisonResult found in groupComparison output")
}
cat("ComparisonResult rows:", nrow(comparison_result), "\n")
cat("ComparisonResult columns:", paste(names(comparison_result), collapse = ", "), "\n")
flush.console()

# Rename columns to match msqrob2 format
name_mapping <- list(
    "Protein" = "Master_Protein_Accessions",
    "log2FC" = "logFC",
    "pvalue" = "pval",
    "adj.pvalue" = "adjPval",
    "SE" = "se"
)

for (old_name in names(name_mapping)) {
    new_name <- name_mapping[[old_name]]
    if (old_name %in% names(comparison_result)) {
        names(comparison_result)[names(comparison_result) == old_name] <- new_name
        cat("Renamed:", old_name, "->", new_name, "\n")
    }
}

# Ensure required columns exist
required_cols <- c("Master_Protein_Accessions", "logFC", "pval", "adjPval")
for (col in required_cols) {
    if (!(col %in% names(comparison_result))) {
        # Try alternative column names
        alt_names <- list(
            "Master_Protein_Accessions" = c("Protein", "ProteinName"),
            "logFC" = c("log2FC", "log2FoldChange", "Estimate"),
            "pval" = c("pvalue", "p.value", "pValue"),
            "adjPval" = c("adj.pvalue", "adjPVal", "qvalue", "padj")
        )
        alts <- alt_names[[col]]
        found <- FALSE
        for (alt in alts) {
            if (alt %in% names(comparison_result)) {
                names(comparison_result)[names(comparison_result) == alt] <- col
                cat("Found alternative:", alt, "->", col, "\n")
                found <- TRUE
                break
            }
        }
        if (!found) {
            cat("Warning: Could not find column for", col, ", adding NA\n")
            comparison_result[[col]] <- NA
        }
    }
}

# Load gene mapping and join Gene_Name
protein_ids <- comparison_result$Master_Protein_Accessions

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")

    gene_map <- fread(gene_mapping_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)

    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL

    if (is.null(gene_col) && "Gene Names" %in% names(gene_map)) {
        gene_col <- "Gene Names"
    }

    if (!is.null(entry_col) && !is.null(gene_col)) {
        cat("Using entry column:", entry_col, "and gene column:", gene_col, "\n")
        first_gene <- sapply(gene_map[[gene_col]], function(x) {
            if (is.na(x) || x == "" || x == " ") return(NA)
            gsub(";.*$", "", gsub(" .*$", "", x))
        })
        mapping <- setNames(first_gene, gene_map[[entry_col]])

        # Vectorized lookup with isoform suffix stripping
        all_ids <- strsplit(as.character(protein_ids), ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)
        flat_mapped <- mapping[flat_ids_base]
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(non_na, collapse = ";") else NA
        })

        comparison_result$Gene_Name <- gene_names
        cat("Mapped gene names for", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
    } else {
        cat("Warning: Gene mapping file has unexpected columns:", paste(names(gene_map), collapse = ", "), "\n")
        comparison_result$Gene_Name <- NA
    }
} else {
    cat("No gene mapping file provided, using protein IDs as gene names\n")
    comparison_result$Gene_Name <- sub("-\\d+$", "", as.character(protein_ids))
}

# Handle NA gene names
comparison_result$Gene_Name[is.na(comparison_result$Gene_Name)] <- sub("-\\d+$", "", protein_ids[is.na(comparison_result$Gene_Name)])

# Add PSM_Count if available from the processed object
if ("NumMeasurements" %in% names(comparison_result)) {
    comparison_result$PSM_Count <- comparison_result$NumMeasurements
} else {
    comparison_result$PSM_Count <- NA_integer_
}

# Reorder columns
col_order <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count", "logFC", "pval", "adjPval", "se")
cols_present <- intersect(col_order, names(comparison_result))
other_cols <- setdiff(names(comparison_result), cols_present)
comparison_result <- comparison_result[, c(cols_present, other_cols)]

# Write output
cat("Writing differential expression results to:", output_file, "\n")
write.table(
    comparison_result,
    file = output_file,
    sep = "\t",
    row.names = FALSE,
    quote = FALSE
)

# Print summary
cat("\nDifferential Expression Summary:\n")
cat("Total proteins:", nrow(comparison_result), "\n")
if ("adjPval" %in% names(comparison_result)) {
    cat("Significant proteins (adjPval < 0.05):", sum(comparison_result$adjPval < 0.05, na.rm = TRUE), "\n")
}
if ("logFC" %in% names(comparison_result)) {
    cat("Upregulated (logFC > 0 & adjPval < 0.05):", sum(comparison_result$logFC > 0 & comparison_result$adjPval < 0.05, na.rm = TRUE), "\n")
    cat("Downregulated (logFC < 0 & adjPval < 0.05):", sum(comparison_result$logFC < 0 & comparison_result$adjPval < 0.05, na.rm = TRUE), "\n")
}
flush.console()

cat("\nStep 7 complete: MSstats differential expression analysis finished successfully\n")
