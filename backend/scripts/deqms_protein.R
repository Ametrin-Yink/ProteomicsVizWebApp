#!/usr/bin/env Rscript
#
# DEqMS Protein Abundance Calculation (Step 6)
#
# Aggregates PSM-level data to protein level using DEqMS medianSweeping.
# Input: PSM_Abundances.tsv from Steps 1-5
# Output: Protein_Abundances.tsv
#
# Usage: Rscript deqms_protein.R <input_file> <output_file> [gene_mapping_file]

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

if (length(args) < 2) {
    stop("Usage: Rscript deqms_protein.R <input_file> <output_file> [gene_mapping_file]")
}

input_file <- args[1]
output_file <- args[2]
gene_mapping_file <- if (length(args) >= 3) args[3] else NULL

cat("Step 6: Calculating protein abundance with DEqMS\n")
cat("Arguments received:", length(args), "\n")
for (i in 1:length(args)) {
    cat("  arg[", i, "]:", args[i], "\n")
}
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")

# Check if input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# Read PSM data (detect Parquet vs TSV)
cat("Reading PSM data...\n")
if (grepl("\\.parquet$", input_file, ignore.case = TRUE)) {
    library(arrow)
    dat <- as.data.frame(read_parquet(input_file))
} else {
    dat <- fread(input_file, header = TRUE, stringsAsFactors = FALSE)
}
cat("Loaded", nrow(dat), "rows,", ncol(dat), "columns\n")

# Filter empty Master_Protein_Accessions
initial_count <- nrow(dat)
dat <- dat[!is.na(dat$Master_Protein_Accessions) &
           dat$Master_Protein_Accessions != "" &
           dat$Master_Protein_Accessions != " ", ]
if (initial_count > nrow(dat)) {
    cat("Removed", initial_count - nrow(dat), "rows with empty protein accessions\n")
}
cat("After protein filtering:", nrow(dat), "rows\n")

# Identify metadata columns (needed for reshape and abundance detection)
id_cols <- c("Unique_PSM", "Master_Protein_Accessions", "Sequence", "Modifications", "Charge")

# Detect long format (Sample_Origination column present)
is_long_format <- "Sample_Origination" %in% colnames(dat)
cat("Data format:", ifelse(is_long_format, "long", "wide"), "\n")

if (is_long_format) {
    # Reshape long -> wide: one row per PSM, samples as columns
    cat("Reshaping long -> wide format...\n")

    # Compute PSM counts per protein BEFORE reshaping:
    # Step 1: Average Total_#_PSMs across samples for each unique_PSM
    # Step 2: Sum those per-unique_PSM averages per protein
    #
    # If Total_#_PSMs column is absent, count unique_PSMs per protein.
    psm_col_name <- NULL
    if ("Total_#_PSMs" %in% colnames(dat)) {
        psm_col_name <- "Total_#_PSMs"
    } else if ("Total # PSMs" %in% colnames(dat)) {
        psm_col_name <- "Total # PSMs"
    }

    if (!is.null(psm_col_name)) {
        cat("Computing PSM counts per protein (avg per unique_PSM, sum per protein)...\n")
        # Step 1: average Total_#_PSMs for each unique_PSM (collapse across samples)
        unique_psm_df <- aggregate(
            dat[[psm_col_name]],
            by = list(Unique_PSM = dat$Unique_PSM, Master_Protein_Accessions = dat$Master_Protein_Accessions),
            FUN = mean,
            na.rm = TRUE
        )
        colnames(unique_psm_df)[3] <- "psm_avg"
        # Step 2: sum per protein
        psm_counts <- tapply(unique_psm_df$psm_avg, unique_psm_df$Master_Protein_Accessions, sum, na.rm = TRUE)
        psm_counts <- round(psm_counts)
        cat("  Proteins with PSM_Count = 1:", sum(psm_counts == 1), "\n")
    } else {
        cat("No PSM count column — counting unique PSMs per protein...\n")
        psm_counts <- tapply(dat$Unique_PSM, dat$Master_Protein_Accessions, function(x) length(unique(x)))
    }

    # Keep only columns needed for DEqMS reshape (drop extra columns that would contaminate dcast)
    needed_cols <- c(id_cols, "Abundance", "Sample_Origination")
    available_cols <- intersect(needed_cols, colnames(dat))
    dat <- dat[, available_cols, drop = FALSE]
    cat("  Kept columns for reshape:", paste(available_cols, collapse = ", "), "\n")

    dat <- dcast(as.data.table(dat),
                 Unique_PSM + Master_Protein_Accessions + Sequence + Modifications + Charge ~ Sample_Origination,
                 value.var = "Abundance",
                 fun.aggregate = function(x) median(x, na.rm = TRUE))
    # Replace NaN/Inf with NA
    dat[is.na(dat)] <- NA
    dat[sapply(dat, is.infinite)] <- NA
    # Convert back to data.frame to avoid data.table column selection issues
    dat <- as.data.frame(dat)

    # Ensure abundance columns are numeric (dcast may produce character from median of mixed types)
    sample_cols_reshape <- setdiff(colnames(dat), id_cols)
    for (col in sample_cols_reshape) {
        dat[[col]] <- suppressWarnings(as.numeric(as.character(dat[[col]])))
    }

    cat("After reshape:", nrow(dat), "rows,", ncol(dat), "columns\n")
}

# Identify abundance columns (all numeric columns except metadata)
abundance_cols <- setdiff(colnames(dat), id_cols)
# Keep only numeric abundance columns
abundance_cols <- abundance_cols[sapply(dat[, abundance_cols, drop = FALSE], is.numeric)]
cat("Abundance columns:", length(abundance_cols), "-", paste(abundance_cols, collapse = ", "), "\n")

# Log2 transform abundances (input may be raw intensities)
cat("Log2 transforming abundances...\n")
for (col in abundance_cols) {
    vals <- dat[[col]]
    vals[!is.na(vals) & vals > 0] <- log2(vals[!is.na(vals) & vals > 0])
    dat[[col]] <- vals
}

# Use pre-computed PSM counts (from long format) or count unique PSMs
if (!exists("psm_counts")) {
    cat("Counting unique PSMs per protein...\n")
    psm_counts <- tapply(dat$Unique_PSM, dat$Master_Protein_Accessions, function(x) length(unique(x)))
}
psm_counts <- psm_counts[!is.na(names(psm_counts))]
cat("Total proteins with PSM counts:", length(psm_counts), "\n")

# DEqMS medianSweeping: expects [ID_col, protein_group_col, sample1, sample2, ...]
# All columns from 3 onward must be numeric abundances.
# Build a minimal input with just Master_Protein_Accessions + sample columns.
cat("Building medianSweeping input (protein + samples only)...\n")
sweep_input <- data.frame(
    Row_ID = seq_len(nrow(dat)),
    Master_Protein_Accessions = dat$Master_Protein_Accessions,
    stringsAsFactors = FALSE
)
for (col in abundance_cols) {
    sweep_input[[col]] <- dat[[col]]
}
cat("medianSweeping input:", nrow(sweep_input), "rows,", ncol(sweep_input), "cols\n")

cat("Running DEqMS medianSweeping...\n")
dat.norm <- DEqMS::medianSweeping(sweep_input, group_col = 2)
cat("medianSweeping complete:", nrow(dat.norm), "proteins\n")

# Gene mapping
cat("Loading gene mapping...\n")
gene_mapping <- NULL
gene_col_name <- NULL  # Actual column name for gene names
if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    tryCatch({
        gene_mapping <- fread(gene_mapping_file, header = TRUE, stringsAsFactors = FALSE, data.table = FALSE)
        cat("Gene mapping loaded:", nrow(gene_mapping), "entries\n")
        cat("Gene mapping columns:", paste(colnames(gene_mapping), collapse = ", "), "\n")
        # Find the gene name column (may be 'Gene.Names' or 'Gene Names')
        if ("Gene.Names" %in% colnames(gene_mapping)) {
            gene_col_name <- "Gene.Names"
        } else if ("Gene Names" %in% colnames(gene_mapping)) {
            gene_col_name <- "Gene Names"
        }
        if (!is.null(gene_col_name)) {
            cat("Using gene column:", gene_col_name, "\n")
        }
    }, error = function(e) {
        cat("Warning: Failed to load gene mapping:", e$message, "\n")
    })
}

# Build output data frame
output_df <- data.frame(
    Master_Protein_Accessions = rownames(dat.norm),
    stringsAsFactors = FALSE
)

# Add Gene_Name via mapping — extract FIRST gene name only (matches msqrob2 behavior)
if (!is.null(gene_mapping) && !is.null(gene_col_name) && "Entry" %in% colnames(gene_mapping) && nrow(gene_mapping) > 0) {
    # Extract first gene name from each database entry (before space or semicolon)
    first_gene <- sapply(gene_mapping[[gene_col_name]], function(x) {
        if (is.na(x) || x == "" || x == " ") return(NA_character_)
        gsub(";.*$", "", gsub(" .*$", "", x))
    })
    mapping_lookup <- setNames(first_gene, gene_mapping$Entry)
    output_df$Gene_Name <- sapply(output_df$Master_Protein_Accessions, function(protein) {
        proteins <- strsplit(as.character(protein), ";")[[1]]
        # Strip isoform suffix (e.g., P46087-2 -> P46087)
        proteins <- sub("-[0-9]+$", "", trimws(proteins))
        genes <- vapply(proteins, function(p) {
            if (!p %in% names(mapping_lookup)) return("")
            g <- mapping_lookup[[p]]
            if (is.null(g) || is.na(g)) "" else as.character(g)
        }, character(1))
        genes <- genes[genes != ""]
        if (length(genes) > 0) genes[1] else ""  # Take first gene name only
    })
} else {
    output_df$Gene_Name <- ""
}

# Fallback: use protein accession (stripped of isoform suffix) for unmapped proteins
unmapped <- output_df$Gene_Name == "" | is.na(output_df$Gene_Name)
if (any(unmapped)) {
    output_df$Gene_Name[unmapped] <- sub("-\\d+$", "", output_df$Master_Protein_Accessions[unmapped])
}

# Add abundance columns (log2, normalized)
sample_cols <- colnames(dat.norm)
for (col in sample_cols) {
    output_df[[col]] <- dat.norm[[col]]
}

# Add PSM_Count
output_df$PSM_Count <- as.integer(psm_counts[output_df$Master_Protein_Accessions])
output_df$PSM_Count[is.na(output_df$PSM_Count)] <- 0L

# Write output
cat("Writing output to", output_file, "\n")
fwrite(output_df, output_file, sep = "\t")
cat("Step 6 complete:", nrow(output_df), "proteins\n")
