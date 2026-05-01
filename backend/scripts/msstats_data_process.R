#!/usr/bin/env Rscript
#
# MSstats Protein Abundance Calculation (Step 6 - MSstats pipeline)
#
# Transforms PSM data to MSstats long format, calls dataProcess(),
# and outputs Protein_Abundances.tsv in msqrob2-compatible wide format.
#
# Usage: Rscript msstats_data_process.R <input_file> <output_file> <rds_output>
#        <gene_mapping_file> <normalization> <feature_selection>
#        <summary_method> <impute> <log_base>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(MSstats)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 9) {
    stop(paste("Usage: Rscript msstats_data_process.R <input_file> <output_file> <rds_output>",
               "<gene_mapping_file> <normalization> <feature_selection>",
               "<summary_method> <impute> <log_base>"))
}

input_file      <- args[1]
output_file     <- args[2]
rds_output      <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
normalization   <- args[5]
feature_selection <- args[6]
summary_method  <- args[7]
impute          <- tolower(args[8]) == "true"
log_base        <- as.integer(args[9])

cat("Step 6: Calculating protein abundance with MSstats\n")
cat("Arguments received:", length(args), "\n")
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("RDS output:", rds_output, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")
cat("Normalization:", normalization, "\n")
cat("Feature selection:", feature_selection, "\n")
cat("Summary method:", summary_method, "\n")
cat("Impute:", impute, "\n")
cat("Log base:", log_base, "\n")
flush.console()

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
psm_data <- psm_data[psm_data$Master_Protein_Accessions != "" & !is.na(psm_data$Master_Protein_Accessions), ]
cat("Filtered to", nrow(psm_data), "PSMs with valid protein accessions\n")

# Count PSMs per protein before transformation
protein_psm_counts <- table(psm_data$Master_Protein_Accessions)
cat("Calculated PSM counts for", length(protein_psm_counts), "proteins\n")

# Transform to MSstats long format
cat("Transforming to MSstats long format...\n")

# Use first accession if semicolon-separated
psm_data[, ProteinName := sapply(strsplit(Master_Protein_Accessions, ";", fixed = TRUE), function(x) x[1])]
psm_data[, PeptideSequence := Sequence]
psm_data[, PrecursorCharge := as.integer(Charge)]
psm_data[, Run := Sample_Origination]
psm_data[, Condition := Condition]
psm_data[, BioReplicate := as.integer(Replicate)]
psm_data[, Intensity := Abundance]
psm_data[, IsotopeLabelType := "L"]

# Select MSstats-required columns
msstats_long <- psm_data[, .(ProteinName, PeptideSequence, PrecursorCharge, Run,
                              Condition, BioReplicate, Intensity, IsotopeLabelType)]

# Remove rows with NA intensity
msstats_long <- msstats_long[!is.na(Intensity)]
cat("MSstats long format:", nrow(msstats_long), "rows\n")
cat("Unique proteins:", length(unique(msstats_long$ProteinName)), "\n")
cat("Unique runs:", length(unique(msstats_long$Run)), "\n")
cat("Conditions:", paste(unique(msstats_long$Condition), collapse = ", "), "\n")
flush.console()

# Convert to data.frame for MSstats (dataProcess expects data.frame)
msstats_df <- as.data.frame(msstats_long)
# Ensure correct column types
msstats_df$ProteinName <- as.character(msstats_df$ProteinName)
msstats_df$PeptideSequence <- as.character(msstats_df$PeptideSequence)
msstats_df$PrecursorCharge <- as.integer(msstats_df$PrecursorCharge)
msstats_df$Run <- as.character(msstats_df$Run)
msstats_df$Condition <- as.character(msstats_df$Condition)
msstats_df$BioReplicate <- as.integer(msstats_df$BioReplicate)
msstats_df$Intensity <- as.numeric(msstats_df$Intensity)
msstats_df$IsotopeLabelType <- as.character(msstats_df$IsotopeLabelType)

# Call MSstats::dataProcess
cat("Calling MSstats::dataProcess...\n")
cat("  normalization:", normalization, "\n")
cat("  feature selection:", feature_selection, "\n")
cat("  summary method:", summary_method, "\n")
cat("  impute:", impute, "\n")
cat("  log base:", log_base, "\n")
flush.console()

# Map feature_selection argument
# MSstats uses: "top3" or "all" (via removeOneFeature / keepAll)
# Map our values: "all" -> keep all, "top3" -> top 3 most intense
if (feature_selection == "top3") {
    remove_few_measurements <- FALSE
    # We'll handle top3 via post-processing if needed
    cat("  Note: top3 feature selection will be handled via MSstats parameters\n")
} else {
    remove_few_measurements <- FALSE
}

# Map normalization: MSstats uses "equalizeMedians" (default) or "quantile"
# Our config: "equalizeMedians" -> MSstats default, "quantile" -> "quantile"
norm_method <- normalization

processed <- tryCatch({
    MSstats::dataProcess(
        msstats_df,
        normalization = norm_method,
        featureSelection = (feature_selection == "top3"),
        MBimpute = impute,
        summaryMethod = summary_method,
        logBase = log_base,
        removeSparseProteins = TRUE
    )
}, error = function(e) {
    cat("MSstats::dataProcess failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("dataProcess complete\n")
flush.console()

# Save processed object as RDS for groupComparison step
cat("Saving processed object to RDS:", rds_output, "\n")
saveRDS(processed, file = rds_output)
cat("RDS saved\n")

# Extract protein-level abundance data (wide format, log2 scale)
cat("Extracting protein-level abundances...\n")
protein_level <- processed$ProteinLevelData
cat("ProteinLevelData rows:", nrow(protein_level), "\n")
cat("ProteinLevelData columns:", paste(names(protein_level), collapse = ", "), "\n")

# ProteinLevelData is in long format with columns like:
# Protein, Run, ABundance (log2), ...
# We need to pivot back to wide format with sample columns matching original names

# Get unique sample/run names from the original data
original_runs <- unique(psm_data$Sample_Origination)
cat("Original sample columns:", paste(original_runs, collapse = ", "), "\n")

# Pivot to wide format using the Run column as column names
protein_wide <- dcast(as.data.table(protein_level),
                       Protein ~ Run,
                       value.var = "ABundance",
                       fun.aggregate = mean)
setDT(protein_wide)
cat("Wide format:", nrow(protein_wide), "proteins x", ncol(protein_wide), "columns\n")

# Rename Protein column to Master_Protein_Accessions
setnames(protein_wide, "Protein", "Master_Protein_Accessions")

# Load gene mapping if provided
gene_names <- rep(NA, nrow(protein_wide))
protein_ids <- protein_wide$Master_Protein_Accessions

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")

    gene_map <- fread(gene_mapping_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)

    cat("Gene mapping columns:", paste(names(gene_map), collapse = ", "), "\n")

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
        all_ids <- strsplit(protein_ids, ";")
        flat_ids <- trimws(unlist(all_ids))
        flat_ids_base <- sub("-[0-9]+$", "", flat_ids)
        flat_mapped <- mapping[flat_ids_base]
        group_idx <- rep(seq_along(protein_ids), lengths(all_ids))
        gene_names <- tapply(flat_mapped, group_idx, function(x) {
            non_na <- x[!is.na(x)]
            if (length(non_na) > 0) paste(non_na, collapse = ";") else NA
        })

        cat("Loaded gene mapping for", sum(!is.na(gene_names)), "of", length(protein_ids), "proteins\n")
    } else {
        cat("Warning: Gene mapping file has unexpected columns:", paste(names(gene_map), collapse = ", "), "\n")
    }
} else {
    cat("No gene mapping file provided or file not found, using protein IDs as gene names\n")
}

# Handle NA gene names: strip isoform suffix as fallback
gene_names[is.na(gene_names)] <- sub("-\\d+$", "", protein_ids[is.na(gene_names)])

# Get PSM counts (vectorized lookup using first accession for multi-accession proteins)
first_accessions <- sapply(strsplit(protein_ids, ";", fixed = TRUE), function(x) x[1])
psm_counts_vec <- as.integer(protein_psm_counts[first_accessions])
psm_counts_vec[is.na(psm_counts_vec)] <- 0

# Insert Gene_Name and PSM_Count columns
protein_wide[, Gene_Name := gene_names]
protein_wide[, PSM_Count := psm_counts_vec]

# Reorder columns: Master_Protein_Accessions, Gene_Name, PSM_Count, then sample columns
sample_cols <- setdiff(names(protein_wide), c("Master_Protein_Accessions", "Gene_Name", "PSM_Count"))
cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count", sample_cols)
protein_wide <- protein_wide[, ..cols]

# Write output
cat("Writing protein abundances to:", output_file, "\n")
write.table(
    as.data.frame(protein_wide),
    file = output_file,
    sep = "\t",
    row.names = FALSE,
    quote = FALSE
)

cat("Step 6 complete: MSstats protein abundance calculated successfully\n")
cat("Output:", nrow(protein_wide), "proteins\n")
flush.console()
