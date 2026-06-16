#!/usr/bin/env Rscript
#
# PTM Summarization — PD converter + MSstatsPTM data summarization
#
# Reads PD PSM CSV(s), annotation, and FASTA; runs PDtoMSstatsPTMFormat
# followed by dataSummarizationPTM (LF) or dataSummarizationPTM_TMT (TMT).
# Saves a list(PTM = summarized, PROTEIN = summarized) as RDS.
#
# Usage: Rscript ptm_summarization.R <ptm_input_csv> <annotation_csv>
#         <fasta_path> <config_json> <output_rds>
#         [<protein_input_csv> <protein_annotation_csv>]
#
# Config fields:
#   labeling_type (LF/TMT), mod_id, which_proteinid, which_quantification,
#   normalization, summaryMethod, MBimpute

cat("[PTM Summarization] Loading R packages...\n")
suppressPackageStartupMessages({
    library(MSstatsPTM)
    library(data.table)
    library(Biostrings)
    library(jsonlite)
    library(methods)
})
cat("[PTM Summarization] R packages loaded\n")
flush.console()

# ============================================================================
# Parse command line arguments
# ============================================================================
args <- commandArgs(trailingOnly = TRUE)
min_args <- 5
if (length(args) < min_args) {
    stop("Usage: Rscript ptm_summarization.R <ptm_input_csv> <annotation_csv> ",
         "<fasta_path> <config_json> <output_rds> ",
         "[<protein_input_csv> <protein_annotation_csv>]")
}

ptm_input_csv        <- args[1]
annotation_csv       <- args[2]
fasta_path           <- args[3]
config_json          <- args[4]
output_rds           <- args[5]
protein_input_csv    <- if (length(args) >= 6 && nzchar(args[6])) args[6] else NULL
protein_annotation_csv <- if (length(args) >= 7 && nzchar(args[7])) args[7] else NULL

# ============================================================================
# Parse config
# ============================================================================
cat("[PTM Summarization] Parsing config...\n")
config <- fromJSON(config_json, simplifyVector = FALSE)

if (is.null(config$labeling_type))        config$labeling_type        <- "LF"
if (is.null(config$mod_id))               config$mod_id               <- "\\(Phospho\\)"
if (is.null(config$which_proteinid))      config$which_proteinid      <- "Protein.Group.Accessions"
if (is.null(config$which_quantification)) config$which_quantification <- "Precursor.Area"
if (is.null(config$normalization))        config$normalization        <- "equalizeMedians"
if (is.null(config$summaryMethod))        config$summaryMethod        <- "TMP"
if (is.null(config$MBimpute))             config$MBimpute             <- TRUE

cat("[PTM Summarization] Configuration:\n")
cat("  labeling_type:", config$labeling_type, "\n")
cat("  mod_id:", config$mod_id, "\n")
cat("  which_proteinid:", config$which_proteinid, "\n")
cat("  which_quantification:", config$which_quantification, "\n")
cat("  normalization:", config$normalization, "\n")
cat("  summaryMethod:", config$summaryMethod, "\n")
cat("  MBimpute:", config$MBimpute, "\n")
cat("  PTM input:", ptm_input_csv, "\n")
cat("  Annotation:", annotation_csv, "\n")
cat("  FASTA:", fasta_path, "\n")
if (!is.null(protein_input_csv)) {
    cat("  Protein input:", protein_input_csv, "\n")
}
if (!is.null(protein_annotation_csv)) {
    cat("  Protein annotation:", protein_annotation_csv, "\n")
}
cat("  Output RDS:", output_rds, "\n")
flush.console()

# ============================================================================
# Validate input files
# ============================================================================
if (!file.exists(ptm_input_csv)) {
    stop("PTM input file not found: ", ptm_input_csv)
}
if (!file.exists(annotation_csv)) {
    stop("Annotation file not found: ", annotation_csv)
}
if (!file.exists(fasta_path)) {
    stop("FASTA file not found: ", fasta_path)
}
if (!is.null(protein_input_csv) && !file.exists(protein_input_csv)) {
    stop("Protein input file not found: ", protein_input_csv)
}
if (!is.null(protein_annotation_csv) && !file.exists(protein_annotation_csv)) {
    stop("Protein annotation file not found: ", protein_annotation_csv)
}

# ============================================================================
# Read PTM input data
# ============================================================================
cat("[PTM Summarization] Reading PTM PSM data...\n")
ptm_data <- fread(ptm_input_csv, sep = "\t", header = TRUE,
                   stringsAsFactors = FALSE, data.table = TRUE)
cat("[PTM Summarization] Loaded", nrow(ptm_data), "rows from PTM PSM\n")
flush.console()

# ============================================================================
# Read annotation
# ============================================================================
cat("[PTM Summarization] Reading annotation...\n")
annot <- fread(annotation_csv, sep = ",", header = TRUE,
               stringsAsFactors = FALSE, data.table = TRUE)
cat("[PTM Summarization] Loaded annotation with", nrow(annot), "rows\n")
flush.console()

# ============================================================================
# Conditionally read protein-level input (global proteome)
# ============================================================================
protein_data <- NULL
protein_annot <- NULL
use_unmod_peptides <- TRUE

if (!is.null(protein_input_csv)) {
    cat("[PTM Summarization] Reading global proteome PSM data...\n")
    protein_data <- fread(protein_input_csv, sep = "\t", header = TRUE,
                           stringsAsFactors = FALSE, data.table = TRUE)
    cat("[PTM Summarization] Loaded", nrow(protein_data), "rows from global proteome\n")

    if (!is.null(protein_annotation_csv)) {
        cat("[PTM Summarization] Reading protein annotation...\n")
        protein_annot <- fread(protein_annotation_csv, sep = ",", header = TRUE,
                                stringsAsFactors = FALSE, data.table = TRUE)
        cat("[PTM Summarization] Loaded protein annotation with", nrow(protein_annot), "rows\n")
    }

    # Mode B: both PTM and global proteome data provided
    use_unmod_peptides <- FALSE
    cat("[PTM Summarization] Mode B: PTM + global proteome (use_unmod_peptides = FALSE)\n")
} else {
    # Mode A: PTM-only, use unmodified peptides as fallback
    use_unmod_peptides <- TRUE
    cat("[PTM Summarization] Mode A: PTM-only (use_unmod_peptides = TRUE)\n")
}
flush.console()

# ============================================================================
# Step 1: Convert PD format to MSstatsPTM format
# ============================================================================
cat("[PTM Summarization] Running PDtoMSstatsPTMFormat...\n")
flush.console()

result <- PDtoMSstatsPTMFormat(
    input                 = ptm_data,
    annotation            = annot,
    fasta_path            = fasta_path,
    protein_input         = protein_data,
    annotation_protein    = protein_annot,
    use_unmod_peptides    = use_unmod_peptides,
    labeling_type         = config$labeling_type,
    mod_id                = config$mod_id,
    which_proteinid       = config$which_proteinid,
    which_quantification  = config$which_quantification,
    use_log_file          = TRUE,
    verbose               = FALSE,
    use_localization_cutoff    = FALSE,
    remove_unlocalized_peptides = TRUE,
    useUniquePeptide           = TRUE,
    removeFewMeasurements      = TRUE,
    summaryforMultipleRows     = "max",
    fasta_protein_name         = "uniprot_iso"
)

cat("[PTM Summarization] PDtoMSstatsPTMFormat complete\n")
flush.console()

# ============================================================================
# Extract components
# ============================================================================
ptm_data_converted <- result$PTM
protein_data_converted <- result$PROTEIN

cat("[PTM Summarization] Converted PTM features:", nrow(ptm_data_converted), "\n")
if (!is.null(protein_data_converted)) {
    cat("[PTM Summarization] Converted PROTEIN features:", nrow(protein_data_converted), "\n")
} else {
    cat("[PTM Summarization] No PROTEIN data in converter output\n")
}
flush.console()

# ============================================================================
# Step 2: Data summarization (branch on labeling type)
# ============================================================================
cat("[PTM Summarization] Running data summarization (", config$labeling_type, ")...\n", sep = "")
flush.console()

if (toupper(config$labeling_type) == "TMT") {
    # TMT summarization
    cat("[PTM Summarization] Using dataSummarizationPTM_TMT\n")
    flush.console()

    summarized <- dataSummarizationPTM_TMT(
        result,
        method         = "msstats",
        global_norm    = TRUE,
        reference_norm = TRUE
    )
} else {
    # Label-Free summarization (default)
    cat("[PTM Summarization] Using dataSummarizationPTM (LF)\n")
    cat("[PTM Summarization]   normalization:", config$normalization, "\n")
    cat("[PTM Summarization]   summaryMethod:", config$summaryMethod, "\n")
    cat("[PTM Summarization]   MBimpute:", config$MBimpute, "\n")
    flush.console()

    summarized <- dataSummarizationPTM(
        result,
        normalization          = config$normalization,
        summaryMethod          = config$summaryMethod,
        MBimpute               = config$MBimpute,
        censoredInt            = "NA",
        useUniquePeptide       = TRUE,
        removeFewMeasurements  = TRUE,
        summaryforMultipleRows = "max"
    )
}

cat("[PTM Summarization] Data summarization complete\n")
flush.console()

# ============================================================================
# Extract summarized components
# ============================================================================
summarized_ptm <- summarized$PTM
summarized_protein <- summarized$PROTEIN

cat("[PTM Summarization] Summarized PTM features:", nrow(summarized_ptm), "\n")
if (!is.null(summarized_protein)) {
    cat("[PTM Summarization] Summarized PROTEIN features:", nrow(summarized_protein), "\n")
} else {
    cat("[PTM Summarization] No summarized PROTEIN data\n")
}
flush.console()

# ============================================================================
# Save output RDS
# ============================================================================
cat("[PTM Summarization] Saving RDS to:", output_rds, "\n")
saveRDS(list(PTM = summarized_ptm, PROTEIN = summarized_protein), file = output_rds)

if (file.exists(output_rds)) {
    cat("[PTM Summarization] RDS saved:", file.info(output_rds)$size, "bytes\n")
} else {
    stop("Failed to save RDS file: ", output_rds)
}
flush.console()

# ============================================================================
# Done
# ============================================================================
cat("[PTM Summarization] PTM summarization completed successfully\n")
cat("PTM_SUMMARIZATION_COMPLETE\n")
flush.console()
