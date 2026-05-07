#!/usr/bin/env Rscript
#
# bionet_network.R
#
# MSstatsBioNet annotation + INDRA subnetwork query.
# Renames columns from DE pipeline output to MSstatsBioNet conventions,
# annotates UniProt accessions with HGNC gene symbols via INDRA,
# then queries the INDRA database for mechanistic relationships.
#
# Usage: Rscript bionet_network.R <input_tsv> <config_json> <nodes_csv> <edges_csv>
#
# Arguments:
#   input_tsv    TSV with columns: Master_Protein_Accessions, logFC, adjPval
#   config_json  JSON with fields: pvalue_cutoff, statement_types,
#                paper_count_cutoff, evidence_count_cutoff, correlation_cutoff,
#                sources_filter (optional)
#   nodes_csv    Output path for nodes CSV
#   edges_csv    Output path for edges CSV
#
# Config fields:
#   pvalue_cutoff         numeric   Adjusted p-value threshold (default: 0.05)
#   statement_types       array     INDRA statement types (e.g. IncreaseAmount, DecreaseAmount)
#   paper_count_cutoff    numeric   Minimum supporting papers (default: 1)
#   evidence_count_cutoff numeric   Minimum evidence count (default: 1)
#   correlation_cutoff    numeric   Correlation cutoff for expression data (NULL = skip)
#   sources_filter        array     Optional filter on INDRA evidence sources (NULL = all)

suppressPackageStartupMessages({
  library(MSstatsBioNet)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 4) {
  stop("Usage: Rscript bionet_network.R <input_tsv> <config_json> <nodes_csv> <edges_csv>")
}

input_tsv   <- args[1]
config_json <- args[2]
nodes_csv   <- args[3]
edges_csv   <- args[4]

# --- Read inputs ----------------------------------------------------------------
df <- read.delim(input_tsv, stringsAsFactors = FALSE, check.names = FALSE)
config <- fromJSON(config_json)

# --- Rename columns to match MSstatsBioNet expectations -------------------------
# getSubnetworkFromIndra internally filters on adj.pvalue (adjusted p-value),
# accesses the "issue" column (must exist; NA = no QC issues), and uses
# Protein, log2FC columns.
colnames(df)[colnames(df) == "Master_Protein_Accessions"] <- "Protein"
colnames(df)[colnames(df) == "logFC"] <- "log2FC"
colnames(df)[colnames(df) == "adjPval"] <- "adj.pvalue"
df$issue <- NA  # required by .filterGetSubnetworkFromIndraInput

# --- Annotate UniProt -> HGNC ---------------------------------------------------
annotated <- annotateProteinInfoFromIndra(df, "Uniprot")

# --- Query INDRA subnetwork -----------------------------------------------------
subnetwork <- getSubnetworkFromIndra(
  annotated,
  pvalueCutoff          = config$pvalue_cutoff,
  statement_types       = unlist(config$statement_types),
  paper_count_cutoff    = config$paper_count_cutoff,
  evidence_count_cutoff = config$evidence_count_cutoff,
  correlation_cutoff    = config$correlation_cutoff,
  sources_filter        = if (is.null(config$sources_filter) || length(config$sources_filter) == 0) NULL else unlist(config$sources_filter)
)

# --- Write outputs --------------------------------------------------------------
write.csv(subnetwork$nodes, nodes_csv, row.names = FALSE)
write.csv(subnetwork$edges, edges_csv, row.names = FALSE)

cat(sprintf("BioNet complete: %d nodes, %d edges\n", nrow(subnetwork$nodes), nrow(subnetwork$edges)))
