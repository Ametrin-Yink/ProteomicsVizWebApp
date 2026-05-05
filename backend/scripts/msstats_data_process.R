#!/usr/bin/env Rscript
#
# MSstats Protein Abundance Calculation (Step 6 - MSstats pipeline)
#
# Transforms PSM data to MSstats DDARawData format, uses OpenMStoMSstatsFormat
# converter for proper preprocessing, then calls dataProcess().
#
# Usage: Rscript msstats_data_process.R <input_file> <output_file> <rds_output>
#        <gene_mapping_file> <config_json>
#        Where config_json is a JSON string with named analysis parameters

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(MSstats)
    library(MSstatsConvert)
    library(jsonlite)
})
cat("R packages loaded successfully\n")

# Parse command line arguments (5 args: 4 file paths + 1 JSON config)
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste("Usage: Rscript msstats_data_process.R <input_file> <output_file> <rds_output>",
               "<gene_mapping_file> <config_json>"))
}

input_file       <- args[1]
output_file      <- args[2]
rds_output       <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- args[5]

# Parse JSON config
cat("Parsing configuration...\n")
config <- fromJSON(config_json)

# Set defaults for missing config parameters
if (is.null(config$normalization)) config$normalization <- "equalizeMedians"
if (is.null(config$logTrans)) config$logTrans <- 2
if (is.null(config$summaryMethod)) config$summaryMethod <- "TMP"
if (is.null(config$MBimpute)) config$MBimpute <- TRUE
if (is.null(config$featureSubset)) config$featureSubset <- "all"
if (is.null(config$censoredInt)) config$censoredInt <- "NA"
if (is.null(config$maxQuantileforCensored)) config$maxQuantileforCensored <- 0.999
if (is.null(config$remove50missing)) config$remove50missing <- FALSE
if (is.null(config$min_peptides)) config$min_peptides <- 1

cat("Step 6: Calculating protein abundance with MSstats\n")
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("RDS output:", rds_output, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")
cat("Config parameters:", paste(names(config), collapse = ", "), "\n")
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

# Transform to MSstats DDARawData format (10 columns)
cat("Transforming to MSstats DDARawData format...\n")

# Use first accession if semicolon-separated
psm_data[, ProteinName := sapply(strsplit(Master_Protein_Accessions, ";", fixed = TRUE), function(x) x[1])]
# Append charge to peptide sequence (matches DDARawData format: "S.PVDIDTK_5")
psm_data[, PeptideSequence := paste0(Sequence, "_", Charge)]
psm_data[, PrecursorCharge := as.integer(Charge)]
psm_data[, Run := Sample_Origination]
psm_data[, Condition := Condition]
psm_data[, BioReplicate := as.integer(Replicate)]
psm_data[, Intensity := Abundance]
psm_data[, IsotopeLabelType := "L"]
# MSstats requires these columns even for DDA data
psm_data[, FragmentIon := "NA"]  # String "NA", not NA_character_
psm_data[, ProductCharge := NA]   # Logical NA

# Select the 10 DDARawData columns
msstats_long <- psm_data[, .(ProteinName, PeptideSequence, PrecursorCharge,
                              FragmentIon, ProductCharge, IsotopeLabelType,
                              Condition, BioReplicate, Run, Intensity)]

# Remove rows with NA intensity
msstats_long <- msstats_long[!is.na(Intensity)]

# Convert to data.frame for MSstats converter
msstats_df <- as.data.frame(msstats_long)
msstats_df$ProteinName <- as.character(msstats_df$ProteinName)
msstats_df$PeptideSequence <- as.character(msstats_df$PeptideSequence)
msstats_df$PrecursorCharge <- as.integer(msstats_df$PrecursorCharge)
msstats_df$FragmentIon <- as.character(msstats_df$FragmentIon)
msstats_df$ProductCharge <- as.logical(msstats_df$ProductCharge)
msstats_df$IsotopeLabelType <- as.character(msstats_df$IsotopeLabelType)
msstats_df$Condition <- as.character(msstats_df$Condition)
msstats_df$BioReplicate <- as.integer(msstats_df$BioReplicate)
msstats_df$Run <- as.character(msstats_df$Run)
msstats_df$Intensity <- as.numeric(msstats_df$Intensity)

cat("MSstats DDARawData format:", nrow(msstats_df), "rows\n")
cat("Unique proteins:", length(unique(msstats_df$ProteinName)), "\n")
cat("Unique runs:", length(unique(msstats_df$Run)), "\n")
cat("Conditions:", paste(unique(msstats_df$Condition), collapse = ", "), "\n")
cat("Run-Condition mapping:\n")
print(unique(msstats_df[, c("Run", "Condition", "BioReplicate")]))
flush.console()

# Step 1: Convert raw data to MSstats internal format using OpenMStoMSstatsFormat
# This handles all preprocessing: feature definition, shared peptide removal,
# balanced design, etc. This is the recommended approach for DDA label-free data.
cat("\nConverting to MSstats format using OpenMStoMSstatsFormat...\n")
flush.console()

remove_few <- identical(tolower(config$featureSubset), "topn")

converted <- tryCatch({
    MSstatsConvert::OpenMStoMSstatsFormat(
        msstats_df,
        useUniquePeptide = TRUE,
        removeFewMeasurements = !remove_few,
        removeProteins_with1Feature = (config$min_peptides > 1),
        summaryforMultipleRows = max,
        use_log_file = FALSE,
        verbose = FALSE
    )
}, error = function(e) {
    cat("OpenMStoMSstatsFormat failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("Data conversion complete\n")
flush.console()

# Step 2: Call MSstats::dataProcess on the converted data
cat("Calling MSstats::dataProcess...\n")
cat("  normalization:", config$normalization, "\n")
cat("  impute:", config$MBimpute, "\n")
cat("  log base:", config$logTrans, "\n")
cat("  feature subset:", config$featureSubset, "\n")
flush.console()

# min_feature_count: use configured value, fall back to MSstats default (2)
effective_min_feature_count <- if (!is.null(config$min_feature_count) && !is.na(config$min_feature_count)) {
    config$min_feature_count
} else {
    2
}

# Build dataProcess arguments dynamically
dp_args <- list(
    data = converted,
    normalization = config$normalization,
    logTrans = config$logTrans,
    summaryMethod = config$summaryMethod,
    MBimpute = config$MBimpute,
    featureSubset = config$featureSubset,
    censoredInt = config$censoredInt,
    maxQuantileforCensored = config$maxQuantileforCensored,
    remove50missing = config$remove50missing,
    min_feature_count = effective_min_feature_count,
    use_log_file = FALSE,
    verbose = FALSE
)

# Add n_top_feature only when using topN feature subset
if (tolower(config$featureSubset) == "topn" && !is.null(config$n_top_feature)) {
    dp_args$n_top_feature <- config$n_top_feature
}

# Add optional parameters when non-NULL
if (!is.null(config$remove_uninformative_feature_outlier)) {
    dp_args$remove_uninformative_feature_outlier <- config$remove_uninformative_feature_outlier
}
if (!is.null(config$equalFeatureVar)) {
    dp_args$equalFeatureVar <- config$equalFeatureVar
}
if (!is.null(config$nameStandards)) {
    dp_args$nameStandards <- config$nameStandards
}
if (!is.null(config$numberOfCores)) {
    dp_args$numberOfCores <- config$numberOfCores
}

processed <- tryCatch({
    do.call(MSstats::dataProcess, dp_args)
}, error = function(e) {
    cat("MSstats::dataProcess failed:", conditionMessage(e), "\n")
    stop(e)
})

cat("dataProcess complete\n")
flush.console()

# Save BOTH objects as RDS for groupComparison step:
# - 'converted': preprocessed object (for groupComparison)
# - 'processed': dataProcess output (for protein abundance extraction)
cat("Saving processed object to RDS:", rds_output, "\n")
saveRDS(list(converted = converted, processed = processed), file = rds_output)
cat("RDS saved\n")

# Extract protein-level abundance data (wide format, log2 scale)
cat("Extracting protein-level abundances...\n")
protein_level <- processed$ProteinLevelData
cat("ProteinLevelData rows:", nrow(protein_level), "\n")
cat("ProteinLevelData columns:", paste(names(protein_level), collapse = ", "), "\n")

# ProteinLevelData columns: RUN, Protein, LogIntensities, originalRUN, GROUP, SUBJECT, ...
# Use originalRUN for sample column names, LogIntensities for values

# Check which abundance column exists
abundance_col <- if ("LogIntensities" %in% names(protein_level)) "LogIntensities" else
                 if ("ABundance" %in% names(protein_level)) "ABundance" else
                 stop("No abundance column found in ProteinLevelData")
run_col <- if ("originalRUN" %in% names(protein_level)) "originalRUN" else
           if ("RUN" %in% names(protein_level)) "RUN" else
           stop("No run column found in ProteinLevelData")

cat("Using abundance column:", abundance_col, "\n")
cat("Using run column:", run_col, "\n")

# Pivot to wide format
protein_wide <- dcast(as.data.table(protein_level),
                       Protein ~ get(run_col),
                       value.var = abundance_col,
                       fun.aggregate = mean)
setDT(protein_wide)
cat("Wide format:", nrow(protein_wide), "proteins x", ncol(protein_wide), "columns\n")

# Rename Protein column to Master_Protein_Accessions
setnames(protein_wide, "Protein", "Master_Protein_Accessions")

# Ensure Master_Protein_Accessions is character (may be factor from MSstats output)
protein_wide[, Master_Protein_Accessions := as.character(Master_Protein_Accessions)]

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

# Handle NA gene names
gene_names[is.na(gene_names)] <- sub("-\\d+$", "", protein_ids[is.na(gene_names)])

# Get PSM counts
first_accessions <- sapply(strsplit(protein_ids, ";", fixed = TRUE), function(x) x[1])
psm_counts_vec <- as.integer(protein_psm_counts[first_accessions])
psm_counts_vec[is.na(psm_counts_vec)] <- 0

# Insert Gene_Name and PSM_Count columns
protein_wide[, Gene_Name := gene_names]
protein_wide[, PSM_Count := psm_counts_vec]

# Reorder columns
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
