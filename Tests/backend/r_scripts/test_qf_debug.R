library(QFeatures)
library(SummarizedExperiment)

input_file <- 'sessions/ba390c8d-10c2-4033-a266-e7a5ef5a308c/results/Protein_Abundances.tsv'
treatment <- 'INCZ123456'
control <- 'DMSO'

protein_data <- read.delim(input_file, sep = "\t", stringsAsFactors = FALSE, check.names = FALSE)

# Identify ID columns and abundance columns
id_cols <- c("Master_Protein_Accessions", "Gene_Name", "Protein")
id_cols_present <- intersect(id_cols, names(protein_data))
abundance_cols <- setdiff(names(protein_data), id_cols_present)

# Create the matrix
protein_matrix <- as.matrix(protein_data[, abundance_cols, drop = FALSE])
rownames(protein_matrix) <- protein_data$Master_Protein_Accessions

# Create column data
col_data <- data.frame(
    sample = abundance_cols,
    stringsAsFactors = FALSE
)

# Determine condition for each sample based on column names
col_data$condition <- sapply(abundance_cols, function(x) {
    if (grepl(treatment, x, ignore.case = TRUE)) {
        return("Treatment")
    } else if (grepl(control, x, ignore.case = TRUE)) {
        return("Control")
    } else {
        return(x)
    }
})

# Convert to factor with Control as reference
col_data$condition <- factor(col_data$condition, levels = c("Control", "Treatment"))

cat("col_data before creating SE:\n")
print(col_data)

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

cat("\ncolData in SE:\n")
print(colData(se))

# Create QFeatures object
pe <- QFeatures(list(protein = se))

cat("\ncolData in QFeatures:\n")
print(colData(pe))

cat("\ncolData in protein assay:\n")
print(colData(pe[["protein"]]))
