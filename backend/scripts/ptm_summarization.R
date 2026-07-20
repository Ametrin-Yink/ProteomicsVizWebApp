#!/usr/bin/env Rscript

suppressPackageStartupMessages({
    library(MSstatsPTM)
    library(data.table)
    library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 5) {
    stop("Usage: ptm_summarization.R <ptm.tsv> <protein.tsv|''> <config.json> <output.rds> <output.dir>")
}

ptm_path <- args[1]
protein_path <- if (nzchar(args[2])) args[2] else NULL
config <- fromJSON(args[3])
output_rds <- args[4]
output_dir <- args[5]

required <- c(
    "ProteinName", "PeptideSequence", "Charge", "PSM", "Mixture",
    "TechRepMixture", "Run", "Channel", "Condition", "BioReplicate",
    "Intensity"
)

read_input <- function(path, label) {
    value <- fread(path, sep = "\t", header = TRUE, data.table = FALSE)
    missing <- setdiff(required, colnames(value))
    if (length(missing) > 0) {
        stop(label, " input is missing columns: ", paste(missing, collapse = ", "))
    }
    value[, required, drop = FALSE]
}

input <- list(PTM = read_input(ptm_path, "PTM"))
if (!is.null(protein_path)) {
    input$PROTEIN <- read_input(protein_path, "Protein")
}

has_reference <- isTRUE(config$has_reference)
imputation <- if (is.null(config$imputation)) TRUE else isTRUE(config$imputation)

cat("[PTM] Summarizing", nrow(input$PTM), "PTM feature rows\n")
if (!is.null(input$PROTEIN)) {
    cat("[PTM] Summarizing", nrow(input$PROTEIN), "protein feature rows\n")
}

summarized <- dataSummarizationPTM_TMT(
    input,
    method = "msstats",
    global_norm = TRUE,
    global_norm.PTM = FALSE,
    reference_norm = has_reference,
    reference_norm.PTM = has_reference,
    remove_norm_channel = TRUE,
    remove_empty_channel = TRUE,
    MBimpute = imputation,
    MBimpute.PTM = imputation,
    use_log_file = FALSE,
    verbose = TRUE
)

saveRDS(summarized, output_rds)
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
fwrite(summarized$PTM$FeatureLevelData, file.path(output_dir, "ptm_feature_level.tsv"), sep = "\t", na = "NA")
fwrite(summarized$PTM$ProteinLevelData, file.path(output_dir, "ptm_site_summarized.tsv"), sep = "\t", na = "NA")
if (!is.null(summarized$PROTEIN)) {
    fwrite(summarized$PROTEIN$FeatureLevelData, file.path(output_dir, "protein_feature_level.tsv"), sep = "\t", na = "NA")
    fwrite(summarized$PROTEIN$ProteinLevelData, file.path(output_dir, "protein_summarized.tsv"), sep = "\t", na = "NA")
}
cat("PTM_SUMMARIZATION_COMPLETE\n")
