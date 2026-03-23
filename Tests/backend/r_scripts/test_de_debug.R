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

cat("Abundance columns:", abundance_cols, "\n")

# Create column data
col_data <- data.frame(
    sample = abundance_cols,
    stringsAsFactors = FALSE
)

# Determine condition for each sample based on column names
col_data$condition <- sapply(abundance_cols, function(x) {
    cat("Checking column:", x, "\n")
    # Check if treatment or control is in the sample name
    if (grepl(treatment, x, ignore.case = TRUE)) {
        cat("  -> Treatment\n")
        return("Treatment")
    } else if (grepl(control, x, ignore.case = TRUE)) {
        cat("  -> Control\n")
        return("Control")
    } else {
        cat("  -> Unknown\n")
        # Try to extract from pattern
        parts <- strsplit(x, "_")[[1]]
        if (length(parts) >= 2) {
            return(parts[1])
        }
        return(x)
    }
})

cat("\nColumn data:\n")
print(col_data)
