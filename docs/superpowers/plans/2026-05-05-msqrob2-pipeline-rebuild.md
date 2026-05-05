# msqrob2 Pipeline Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MULTI_CONDITION pipeline to use msqrob2's native robust regression end-to-end, with full operational parity to the MSstats pipeline (RDS checkpointing, heartbeat, per-step timeouts, core calibration, retry).

**Architecture:** Two new R scripts (`msqrob2_data_process.R` for protein aggregation, `msqrob2_group_comparison_multi.R` for DE) wired through a refactored `Msqrob2Wrapper` matching the `MsstatsWrapper` pattern. Step handlers add RDS checkpointing. Frontend gains an `Msqrob2ConfigForm` component. Old limma-based scripts deleted.

**Tech Stack:** R 4.5+ (msqrob2, QFeatures, limma, BiocParallel), Python 3.12+ (FastAPI, subprocess, asyncio), TypeScript (React, Zustand)

---

## File Structure

```
Create:
  backend/scripts/msqrob2_data_process.R          # Step 6: QFeatures preprocessing + RDS
  backend/scripts/msqrob2_group_comparison_multi.R # Step 7: msqrob2-native DE
  frontend/src/components/analysis/Msqrob2ConfigForm.tsx  # msqrob2 config UI
  Tests/backend/integration/test_msqrob2_pipeline_performance.py  # Integration tests

Rewrite:
  backend/app/services/msqrob2_wrapper.py          # Full refactor with heartbeat, calibration

Modify:
  backend/app/core/config.py                       # Add 2 timeout settings
  backend/app/models/analysis.py                   # Add 9 msqrob2 config fields
  backend/app/services/steps/protein_abundance.py   # RDS checkpointing + data_process()
  backend/app/services/steps/multi_condition_de.py  # RDS loading + group_comparison_multi()
  backend/app/services/pipeline_registry.py         # Update display names
  frontend/src/types/processing.ts                 # Update step descriptions
  frontend/src/stores/processing-store.ts           # Update package/function strings
  frontend/src/types/index.ts                      # Add msqrob2 config fields
  frontend/src/types/api.ts                        # Add msqrob2 config fields
  frontend/src/app/new/config/page.tsx             # Branch msqrob2 config form

Delete:
  backend/scripts/msqrob2_protein.R
  backend/scripts/msqrob2_de.R
  backend/scripts/msqrob2_de_multi.R
```

---

### Task 1: Add msqrob2 Config Fields to Backend Models

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/models/analysis.py`

- [ ] **Step 1: Add timeout settings to config.py**

Add after `r_group_comparison_timeout` (line 108):

```python
    r_msqrob2_data_process_timeout: int = Field(
        default=7200,  # 2 hours — QFeatures aggregateFeatures is the heaviest step
        description="Timeout for msqrob2 dataProcess (protein abundance) in seconds",
        ge=30,
        le=28800,
    )

    r_msqrob2_group_comparison_timeout: int = Field(
        default=3600,  # 1 hour — per-contrast msqrobLm modeling
        description="Timeout for msqrob2 groupComparison (differential expression) in seconds",
        ge=30,
        le=14400,
    )
```

- [ ] **Step 2: Add msqrob2 config fields to AnalysisConfig**

Add after `msstats_n_cores` (line 108 of models/analysis.py), before `covariate_columns`:

```python
    # msqrob2-specific parameters
    msqrob2_normalization: str = Field(
        default="center.median",
        description="Normalization method: center.median, center.mean, quantiles, quantiles.robust, vsn, div.median, none",
    )
    msqrob2_imputation: str = Field(
        default="none",
        description="Imputation method: none, knn, bpca, MinDet, MinProb, QRILC, MLE",
    )
    msqrob2_aggregation: str = Field(
        default="robustSummary",
        description="Protein aggregation method: robustSummary, medianPolish, sum, mean",
    )
    msqrob2_model: str = Field(
        default="msqrobLm",
        description="DE model type: msqrobLm (robust linear), msqrobGlm (generalized linear)",
    )
    msqrob2_robust: bool = Field(
        default=True,
        description="Use robust M-estimation (Huber weights) for DE model fitting",
    )
    msqrob2_ridge: bool = Field(
        default=False,
        description="Apply ridge penalty for high-dimensional/collinear designs",
    )
    msqrob2_adjust_method: str = Field(
        default="BH",
        description="Multiple testing correction: BH, bonferroni, holm, BY, fdr",
    )
    msqrob2_min_peptides: int = Field(
        default=1, ge=1, le=10,
        description="Minimum peptides per protein for aggregation",
    )
    msqrob2_n_cores: int = Field(
        default=32, ge=1,
        description="Number of CPU cores for parallel msqrob2 processing",
    )
```

- [ ] **Step 3: Verify models import cleanly**

```bash
cd backend && .venv/Scripts/python.exe -c "from app.models.analysis import AnalysisConfig; c = AnalysisConfig(); print(c.msqrob2_normalization); print(c.msqrob2_robust)"
```

Expected: prints `center.median` and `True`

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/config.py backend/app/models/analysis.py
git commit -m "feat: add msqrob2-specific config fields and timeout settings"
```

---

### Task 2: Create msqrob2_data_process.R (Step 6)

**Files:**
- Create: `backend/scripts/msqrob2_data_process.R`

- [ ] **Step 1: Write the complete R script**

```r
#!/usr/bin/env Rscript
#
# msqrob2 Data Process — Protein Abundance via QFeatures (Step 6)
#
# Performs peptide-to-protein aggregation using QFeatures preprocessing:
# logTransform -> normalize -> impute -> aggregateFeatures.
# Saves intermediate RDS checkpoint for Step 7.
#
# Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output> <gene_mapping_file> <config_json>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(QFeatures)
    library(limma)
    library(SummarizedExperiment)
    library(matrixStats)
    library(BiocParallel)
    library(jsonlite)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste("Usage: Rscript msqrob2_data_process.R <input_file> <output_file>",
               "<rds_output> <gene_mapping_file> <config_json>"))
}

input_file       <- args[1]
output_file      <- args[2]
rds_output       <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- if (length(args) >= 5 && nzchar(args[5])) args[5] else "{}"

# Parse config JSON
config <- fromJSON(config_json)
normalization   <- if (!is.null(config$normalization)) config$normalization else "center.median"
imputation      <- if (!is.null(config$imputation)) config$imputation else "none"
aggregation     <- if (!is.null(config$aggregation)) config$aggregation else "robustSummary"
min_peptides    <- if (!is.null(config$min_peptides)) as.integer(config$min_peptides) else 1
n_cores         <- if (!is.null(config$numberOfCores)) as.integer(config$numberOfCores) else 1

cat("Step 6: Calculating protein abundance with msqrob2/QFeatures\n")
cat("Input file:", input_file, "\n")
cat("Output file:", output_file, "\n")
cat("RDS output:", rds_output, "\n")
cat("Gene mapping file:", gene_mapping_file, "\n")
cat("Config - normalization:", normalization, ", imputation:", imputation,
    ", aggregation:", aggregation, ", min_peptides:", min_peptides,
    ", n_cores:", n_cores, "\n")
flush.console()

# Check input file exists
if (!file.exists(input_file)) {
    stop(paste("Input file not found:", input_file))
}

# ── Read PSM data ──────────────────────────────────────────────────────────────
cat("Reading PSM data...\n")
if (grepl("\\.parquet$", input_file, ignore.case = TRUE)) {
    library(arrow)
    psm_data <- as.data.table(read_parquet(input_file))
    cat("Loaded", nrow(psm_data), "PSMs from Parquet\n")
} else {
    psm_data <- fread(input_file, sep = "\t", header = TRUE, stringsAsFactors = FALSE, data.table = TRUE)
    cat("Loaded", nrow(psm_data), "PSMs from TSV\n")
}

# Filter empty accessions
psm_data <- psm_data[psm_data$Master_Protein_Accessions != '' & !is.na(psm_data$Master_Protein_Accessions), ]
cat("Filtered to", nrow(psm_data), "PSMs with valid protein accessions\n")

# Identify abundance columns (exclude metadata)
metadata_cols <- c("Sequence", "Modifications", "Charge", "Contaminant",
                   "Master_Protein_Accessions", "Quan_Info", "Sample_Origination",
                   "Condition", "Replicate", "Unique_PSM")
abundance_cols <- setdiff(names(psm_data), metadata_cols)

# Convert abundance columns to numeric (vectorized)
for (col in abundance_cols) {
    if (!is.numeric(psm_data[[col]])) {
        psm_data[[col]] <- suppressWarnings(as.numeric(psm_data[[col]]))
    }
}
abundance_cols <- abundance_cols[vapply(psm_data[, ..abundance_cols],
    function(x) is.numeric(x) && !all(is.na(x)), logical(1))]
cat("Found", length(abundance_cols), "valid abundance columns\n")

if (length(abundance_cols) == 0) {
    stop("No abundance columns found in input file")
}

# Remove proteins where ALL abundance values are NA
if (nrow(psm_data) > 0) {
    all_na_mask <- rowSums(is.na(psm_data[, ..abundance_cols])) == length(abundance_cols)
    n_removed <- sum(all_na_mask)
    if (n_removed > 0) {
        cat("Removing", n_removed, "proteins with no abundance data\n")
        psm_data <- psm_data[!all_na_mask, ]
    }
}

# ── Reshape long → wide (if needed) ───────────────────────────────────────────
if ("Sample_Origination" %in% names(psm_data)) {
    cat("Data is in long format, reshaping to wide format...\n")
    setDT(psm_data)
    psm_dt_agg <- psm_data[, .(Abundance = sum(Abundance, na.rm = TRUE)),
                           by = .(Unique_PSM, Master_Protein_Accessions, Sample_Origination)]
    cat("Aggregated from", nrow(psm_data), "to", nrow(psm_dt_agg), "rows\n")

    psm_wide_dt <- dcast(psm_dt_agg,
                         Unique_PSM + Master_Protein_Accessions ~ Sample_Origination,
                         value.var = "Abundance", fun.aggregate = sum)
    names(psm_wide_dt) <- gsub("Abundance\\.", "", names(psm_wide_dt))
    cat("Reshaped to wide format:", nrow(psm_wide_dt), "rows x", ncol(psm_wide_dt), "columns\n")

    # Convert zeros to NA (missing peptide observations, not true zero abundance)
    sample_cols <- setdiff(names(psm_wide_dt), c("Unique_PSM", "Master_Protein_Accessions"))
    for (col in sample_cols) {
        psm_wide_dt[[col]] <- fifelse(psm_wide_dt[[col]] == 0, NA_real_, psm_wide_dt[[col]])
    }
    n_zeros <- sum(is.na(psm_wide_dt[, ..sample_cols]))
    cat("Converted", n_zeros, "zero values to NA (missing peptide observations)\n")

    # Create QFeatures from wide format
    quant_col_indices <- which(!names(psm_wide_dt) %in% c("Unique_PSM", "Master_Protein_Accessions"))
    pe <- readQFeatures(
        assayData = psm_wide_dt,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    rowData(pe[["peptide"]])$Proteins <- psm_wide_dt$Master_Protein_Accessions

} else {
    cat("Data is in wide format, using readQFeatures...\n")
    quant_col_indices <- grep("^Abundance F[0-9A-Za-z]+ Sample$", names(psm_data))
    pe <- readQFeatures(
        assayData = psm_data,
        quantCols = quant_col_indices,
        name = "peptide"
    )
    rowData(pe[["peptide"]])$Proteins <- psm_data$Master_Protein_Accessions
}

cat("Created QFeatures object with", nrow(pe[["peptide"]]), "peptides\n")

# Count PSMs per protein before aggregation
peptide_proteins <- rowData(pe[["peptide"]])$Proteins
protein_psm_counts <- table(peptide_proteins)
cat("Calculated PSM counts for", length(protein_psm_counts), "proteins\n")

# ── Log2 transform ────────────────────────────────────────────────────────────
cat("Log2 transforming peptide abundances...\n")
pe <- logTransform(pe, base = 2, i = "peptide", name = "peptide_log2")
cat("Log2 transformation complete\n")

# ── Normalize ─────────────────────────────────────────────────────────────────
if (normalization != "none") {
    cat("Applying normalization:", normalization, "\n")
    pe <- normalize(pe, i = "peptide_log2", name = "peptide_norm", method = normalization)
    cat("Normalization complete\n")
    norm_from <- "peptide_norm"
} else {
    cat("Skipping normalization\n")
    norm_from <- "peptide_log2"
}

# ── Impute (optional) ─────────────────────────────────────────────────────────
if (imputation != "none") {
    cat("Applying imputation:", imputation, "\n")
    pe <- impute(pe, i = norm_from, name = "peptide_imputed", method = imputation)
    cat("Imputation complete\n")
    agg_from <- "peptide_imputed"
} else {
    cat("Skipping imputation\n")
    agg_from <- norm_from
}

# Save normalization coefficients (median of each sample in the normalized assay)
norm_assay <- assay(pe[[agg_from]])
sample_medians <- colMedians(norm_assay, na.rm = TRUE)
max_median <- max(sample_medians, na.rm = TRUE)
shift_log2 <- max_median - sample_medians
norm_coeff_file <- file.path(dirname(output_file), "normalization_coefficients.tsv")
norm_df <- data.frame(
    Sample = colnames(norm_assay),
    Log2Shift = shift_log2,
    LinearFactor = 2.0 ^ shift_log2,
    stringsAsFactors = FALSE
)
write.table(norm_df, file = norm_coeff_file, sep = "\t", row.names = FALSE, quote = FALSE)
cat("Normalization coefficients saved to:", norm_coeff_file, "\n")

# ── Aggregate to protein level ────────────────────────────────────────────────
cat("Aggregating peptides to protein level...\n")
cat("Using method:", aggregation, "\n")
cat("Processing", nrow(pe[[agg_from]]), "peptides for",
    length(unique(rowData(pe[[agg_from]])$Proteins)), "proteins\n")
flush.console()

# Select aggregation function
agg_fun <- switch(aggregation,
    robustSummary = MsCoreUtils::robustSummary,
    medianPolish = MsCoreUtils::medianPolish,
    sum = colSums,
    mean = colMeans,
    stop(paste("Unknown aggregation method:", aggregation))
)

# Configure parallel processing
if (n_cores > 1) {
    cat("Attempting parallel aggregation with", n_cores, "workers (SnowParam)\n")
    param <- tryCatch({
        SnowParam(workers = n_cores, progressbar = TRUE)
    }, error = function(e) {
        cat("SnowParam creation failed:", conditionMessage(e), "\n")
        NULL
    })
    if (is.null(param)) {
        cat("Falling back to SerialParam\n")
        param <- SerialParam()
    }
} else {
    cat("Using SerialParam for aggregation\n")
    param <- SerialParam()
}

pe <- tryCatch({
    aggregateFeatures(
        object = pe,
        i = agg_from,
        fcol = "Proteins",
        name = "protein",
        fun = agg_fun,
        BPPARAM = param
    )
}, error = function(e) {
    if (inherits(param, "SnowParam")) {
        cat("Parallel aggregation failed:", conditionMessage(e), "\n")
        cat("Retrying with SerialParam...\n")
        aggregateFeatures(
            object = pe,
            i = agg_from,
            fcol = "Proteins",
            name = "protein",
            fun = agg_fun,
            BPPARAM = SerialParam()
        )
    } else {
        stop(e)
    }
})

cat("Aggregation complete:", nrow(pe[["protein"]]), "proteins\n")

# ── Extract protein abundances ────────────────────────────────────────────────
protein_assay <- pe[["protein"]]
protein_matrix <- assay(protein_assay)
protein_ids <- rownames(protein_matrix)
cat("Protein abundances are on log2 scale\n")

# ── Gene mapping ──────────────────────────────────────────────────────────────
gene_names <- rep(NA, length(protein_ids))

if (!is.null(gene_mapping_file) && file.exists(gene_mapping_file)) {
    cat("Loading gene mapping from:", gene_mapping_file, "\n")
    gene_map <- read.delim(gene_mapping_file, sep = "\t", stringsAsFactors = FALSE, check.names = TRUE)

    entry_col <- if ("Entry" %in% names(gene_map)) "Entry" else NULL
    gene_col <- if ("Gene.Names" %in% names(gene_map)) "Gene.Names" else
                if ("Gene_Names" %in% names(gene_map)) "Gene_Names" else
                if ("GeneNames" %in% names(gene_map)) "GeneNames" else NULL
    if (is.null(gene_col) && "Gene Names" %in% names(gene_map)) {
        gene_col <- "Gene Names"
    }

    if (!is.null(entry_col) && !is.null(gene_col)) {
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
    }
}

gene_names[is.na(gene_names)] <- sub("-\\d+$", "", protein_ids[is.na(gene_names)])

# PSM counts
psm_counts <- as.integer(protein_psm_counts[protein_ids])
psm_counts[is.na(psm_counts)] <- 0

# ── Write Protein_Abundances.tsv ───────────────────────────────────────────────
protein_df <- as.data.frame(protein_matrix)
protein_df$Master_Protein_Accessions <- protein_ids
protein_df$Gene_Name <- gene_names
protein_df$PSM_Count <- psm_counts

# Reorder: ID columns first, then sample columns
cols <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count",
          setdiff(names(protein_df), c("Master_Protein_Accessions", "Gene_Name", "PSM_Count")))
protein_df <- protein_df[, cols]

cat("Writing protein abundances to:", output_file, "\n")
write.table(protein_df, file = output_file, sep = "\t", row.names = FALSE, quote = FALSE)

# ── Save RDS checkpoint ───────────────────────────────────────────────────────
cat("Saving RDS checkpoint to:", rds_output, "\n")

# Build col_data with sample names (condition assignment happens in Step 7)
sample_names <- setdiff(names(protein_df), c("Master_Protein_Accessions", "Gene_Name", "PSM_Count"))

checkpoint <- list(
    protein_matrix = protein_matrix,
    sample_names = sample_names,
    gene_names = gene_names,
    psm_counts = psm_counts,
    norm_coefficients = norm_df
)
saveRDS(checkpoint, file = rds_output)
cat("RDS checkpoint saved\n")

cat("Step 6 complete: Protein abundance calculated successfully\n")
cat("Output:", nrow(protein_df), "proteins x", length(sample_names), "samples\n")
```

- [ ] **Step 2: Verify R script syntax**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" --no-save -e 'parse(file="backend/scripts/msqrob2_data_process.R"); cat("Syntax OK\n")'
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/msqrob2_data_process.R
git commit -m "feat: add msqrob2_data_process.R for QFeatures-based protein aggregation with RDS checkpoint"
```

---

### Task 3: Create msqrob2_group_comparison_multi.R (Step 7)

**Files:**
- Create: `backend/scripts/msqrob2_group_comparison_multi.R`

- [ ] **Step 1: Write the complete R script**

```r
#!/usr/bin/env Rscript
#
# msqrob2 Group Comparison — Multi-Condition DE (Step 7)
#
# Loads RDS checkpoint from Step 6, runs msqrob2-native DE:
# msqrobLm -> makeContrast -> hypothesisTest -> topFeatures
# Writes one Diff_Expression_{label}.tsv per comparison.
#
# Usage: Rscript msqrob2_group_comparison_multi.R <rds_file> <output_dir>
#        <comparisons_json> <gene_mapping_file> <config_json>

cat("Loading R packages...\n")
suppressPackageStartupMessages({
    library(data.table)
    library(msqrob2)
    library(limma)
    library(matrixStats)
    library(jsonlite)
})
cat("R packages loaded successfully\n")

# Parse command line arguments
args <- commandArgs(trailingOnly = TRUE)

if (length(args) < 5) {
    stop(paste("Usage: Rscript msqrob2_group_comparison_multi.R <rds_file> <output_dir>",
               "<comparisons_json> <gene_mapping_file> <config_json>"))
}

rds_file         <- args[1]
output_dir       <- args[2]
comparisons_json <- args[3]
gene_mapping_file <- if (nzchar(args[4])) args[4] else NULL
config_json      <- if (length(args) >= 5 && nzchar(args[5])) args[5] else "{}"

# Parse config JSON
config <- fromJSON(config_json)
model_type      <- if (!is.null(config$model)) config$model else "msqrobLm"
robust          <- if (!is.null(config$robust)) as.logical(config$robust) else TRUE
ridge           <- if (!is.null(config$ridge)) as.logical(config$ridge) else FALSE
adjust_method   <- if (!is.null(config$adjust_method)) config$adjust_method else "BH"

cat("Step 7: Running msqrob2-native differential expression analysis\n")
cat("RDS file:", rds_file, "\n")
cat("Output dir:", output_dir, "\n")
cat("Comparisons JSON:", comparisons_json, "\n")
cat("Config - model:", model_type, ", robust:", robust, ", ridge:", ridge,
    ", adjust_method:", adjust_method, "\n")
flush.console()

# Check RDS exists
if (!file.exists(rds_file)) {
    stop(paste("RDS file not found:", rds_file))
}

# Create output directory
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Load RDS checkpoint ───────────────────────────────────────────────────────
cat("Loading RDS checkpoint...\n")
checkpoint <- readRDS(rds_file)
protein_matrix <- checkpoint$protein_matrix
sample_names   <- checkpoint$sample_names
gene_names     <- checkpoint$gene_names
psm_counts     <- checkpoint$psm_counts
cat("Loaded", nrow(protein_matrix), "proteins x", ncol(protein_matrix), "samples\n")

# ── Parse comparisons (unified {group1, group2} format) ───────────────────────
comparisons <- fromJSON(comparisons_json, simplifyVector = FALSE)
if (length(comparisons) == 0) {
    stop("No comparisons provided in JSON")
}
cat("Number of comparisons:", length(comparisons), "\n")

# Build comparison labels: extract Condition from each group, concatenate multi-key groups with +
build_label <- function(group) {
    vals <- unlist(group)
    paste(vals, collapse = "+")
}

comparison_labels <- sapply(comparisons, function(x) {
    paste0(build_label(x$group1), "_vs_", build_label(x$group2))
})

for (i in seq_along(comparisons)) {
    cat("  Comparison", i, ":", comparison_labels[i], "\n")
}
flush.console()

# ── Collect unique condition names ────────────────────────────────────────────
all_conditions <- unique(c(
    unlist(sapply(comparisons, function(x) unlist(x$group1))),
    unlist(sapply(comparisons, function(x) unlist(x$group2)))
))
# Sort by length descending to avoid substring mismatches
all_conditions <- all_conditions[order(-nchar(all_conditions))]
cat("All unique condition values:", paste(all_conditions, collapse = ", "), "\n")

# ── Assign condition to each sample ───────────────────────────────────────────
col_data <- data.frame(
    sample = sample_names,
    stringsAsFactors = FALSE
)

col_data$condition <- sapply(sample_names, function(x) {
    for (cond in all_conditions) {
        if (grepl(cond, x, ignore.case = TRUE, fixed = TRUE)) {
            return(cond)
        }
    }
    parts <- strsplit(x, "_")[[1]]
    if (length(parts) >= 2) return(parts[1])
    return(x)
})

col_data$condition <- factor(col_data$condition, levels = all_conditions)

cat("Sample conditions:\n")
print(table(col_data$condition))

# Verify all conditions found
conditions_found <- unique(col_data$condition)
missing_conditions <- setdiff(all_conditions, conditions_found)
if (length(missing_conditions) > 0) {
    stop(paste("Condition(s) not found in sample columns:",
               paste(missing_conditions, collapse = ", ")))
}

# Warn if < 2 replicates
condition_counts <- table(col_data$condition)
if (any(condition_counts < 2)) {
    warning("Some conditions have fewer than 2 replicates: ",
            paste(names(condition_counts[condition_counts < 2]), collapse = ", "))
}

if (length(unique(col_data$condition)) < 2) {
    stop("At least two conditions must be present in the data")
}

# ── Pre-filter zero-variance proteins ─────────────────────────────────────────
cat("Checking for low-variance proteins...\n")
valid_mask <- rowSums(!is.na(protein_matrix)) >= 3
var_per_protein <- rep(NA, nrow(protein_matrix))
if (any(valid_mask)) {
    var_per_protein[valid_mask] <- rowVars(protein_matrix[valid_mask, , drop = FALSE], na.rm = TRUE)
}
zero_var <- which(!is.na(var_per_protein) & var_per_protein < 1e-10)
if (length(zero_var) > 0) {
    cat("Pre-filtering", length(zero_var), "low-variance proteins (will be added back to output)\n")
    zero_var_ids <- rownames(protein_matrix)[zero_var]
    protein_matrix <- protein_matrix[-zero_var, , drop = FALSE]
} else {
    zero_var_ids <- character(0)
}
if (nrow(protein_matrix) == 0) {
    stop("All proteins were filtered out due to low variance.")
}
cat("Matrix after filtering:", nrow(protein_matrix), "proteins x", ncol(protein_matrix), "samples\n")

# ── Build design matrix ───────────────────────────────────────────────────────
cat("Creating design matrix: ~ 0 + condition\n")
design <- model.matrix(~ 0 + condition, data = col_data)
colnames(design) <- levels(col_data$condition)

cat("Design matrix:\n")
print(design)

if (nrow(design) != ncol(protein_matrix)) {
    stop(paste("Dimension mismatch: design has", nrow(design), "rows but protein matrix has",
               ncol(protein_matrix), "columns"))
}

# ── Fit msqrob2 model ─────────────────────────────────────────────────────────
cat("Fitting", model_type, "model...\n")
flush.console()

if (model_type == "msqrobLm") {
    fit_model <- msqrobLm(
        y = protein_matrix,
        formula = ~ condition,
        data = col_data,
        robust = robust,
        maxitRob = 5
    )
} else if (model_type == "msqrobGlm") {
    fit_model <- msqrobGlm(
        y = protein_matrix,
        npep = psm_counts[rownames(protein_matrix)],
        formula = ~ condition,
        data = col_data
    )
} else {
    stop(paste("Unknown model type:", model_type))
}

cat("Model fitting complete\n")
flush.console()

# ── Per-comparison DE ─────────────────────────────────────────────────────────
cat("Extracting differential expression results...\n")

for (i in seq_along(comparisons)) {
    comp <- comparisons[[i]]
    label <- comparison_labels[i]
    cat("  Processing comparison", i, ":", label, "\n")

    # Extract Condition values from group1 and group2
    treat_cond <- comp$group1$Condition
    ctrl_cond  <- comp$group2$Condition

    if (is.null(treat_cond) || is.null(ctrl_cond)) {
        stop(paste("Comparison", i, "missing 'Condition' key in group1 or group2"))
    }

    if (!(treat_cond %in% colnames(design))) {
        stop(paste("Treatment condition '", treat_cond, "' not in design columns:",
                   paste(colnames(design), collapse = ", ")))
    }
    if (!(ctrl_cond %in% colnames(design))) {
        stop(paste("Control condition '", ctrl_cond, "' not in design columns:",
                   paste(colnames(design), collapse = ", ")))
    }

    # Build contrast: +1 treatment, -1 control
    contrast_vec <- rep(0, ncol(design))
    names(contrast_vec) <- colnames(design)
    contrast_vec[treat_cond] <- 1
    contrast_vec[ctrl_cond] <- -1

    contrast <- makeContrast(contrast_vec, parameterNames = colnames(design))
    cat("    Contrast:", paste(names(contrast_vec), "=", contrast_vec, collapse = ", "), "\n")

    # Hypothesis test
    test_result <- hypothesisTest(fit_model, contrast)

    # Extract top features
    results_df <- topFeatures(test_result, contrast = contrast,
                              adjust.method = adjust_method, sort = TRUE)

    if (!is.data.frame(results_df)) {
        results_df <- as.data.frame(results_df)
    }

    # ── Map column names to frontend contract ──────────────────────────────────
    results_df$Master_Protein_Accessions <- rownames(results_df)

    # Gene names
    if (!is.null(gene_names)) {
        results_df$Gene_Name <- gene_names[rownames(results_df)]
    }

    # PSM counts
    if (!is.null(psm_counts)) {
        results_df$PSM_Count <- psm_counts[rownames(results_df)]
        results_df$PSM_Count[is.na(results_df$PSM_Count)] <- 0
    }

    # Standardized column names
    if (!"logFC" %in% names(results_df)) {
        if ("estimate" %in% names(results_df)) {
            results_df$logFC <- results_df$estimate
        } else if ("coef" %in% names(results_df)) {
            results_df$logFC <- results_df$coef
        } else if ("log2FC" %in% names(results_df)) {
            results_df$logFC <- results_df$log2FC
        } else {
            results_df$logFC <- NA
            cat("    Warning: could not find logFC column in topFeatures output\n")
        }
    }
    if (!"pval" %in% names(results_df)) {
        if ("p.value" %in% names(results_df)) {
            results_df$pval <- results_df$p.value
        } else if ("pValue" %in% names(results_df)) {
            results_df$pval <- results_df$pValue
        } else if ("P.Value" %in% names(results_df)) {
            results_df$pval <- results_df$P.Value
        } else {
            results_df$pval <- NA
        }
    }
    if (!"adjPval" %in% names(results_df)) {
        if ("adj.p.value" %in% names(results_df)) {
            results_df$adjPval <- results_df$adj.p.value
        } else if ("adjPValue" %in% names(results_df)) {
            results_df$adjPval <- results_df$adjPValue
        } else if ("padj" %in% names(results_df)) {
            results_df$adjPval <- results_df$padj
        } else {
            results_df$adjPval <- NA
        }
    }
    if (!"se" %in% names(results_df)) {
        if ("se" %in% names(results_df)) {
            # already present
        } else if ("SE" %in% names(results_df)) {
            results_df$se <- results_df$SE
        } else {
            results_df$se <- NA
        }
    }
    if (!"df" %in% names(results_df)) {
        if ("df" %in% names(results_df)) {
            # already present
        } else if ("dfPosterior" %in% names(results_df)) {
            results_df$df <- results_df$dfPosterior
        } else {
            results_df$df <- NA
        }
    }

    # Reorder columns to frontend contract
    col_order <- c("Master_Protein_Accessions", "Gene_Name", "PSM_Count",
                   "logFC", "pval", "adjPval", "se", "df")
    cols_present <- intersect(col_order, names(results_df))
    other_cols <- setdiff(names(results_df), cols_present)
    results_df <- results_df[, c(cols_present, other_cols)]

    # ── Add back zero-variance proteins ─────────────────────────────────────────
    if (length(zero_var_ids) > 0) {
        cat("    Adding back", length(zero_var_ids), "zero-variance proteins\n")
        zero_var_df <- data.frame(
            Master_Protein_Accessions = zero_var_ids,
            stringsAsFactors = FALSE
        )
        if ("Gene_Name" %in% names(results_df) && !is.null(gene_names)) {
            zero_var_df$Gene_Name <- gene_names[zero_var_ids]
        }
        if ("PSM_Count" %in% names(results_df) && !is.null(psm_counts)) {
            zero_var_df$PSM_Count <- psm_counts[zero_var_ids]
            zero_var_df$PSM_Count[is.na(zero_var_df$PSM_Count)] <- 0
        }
        zero_var_df$logFC <- 0
        zero_var_df$pval <- NA
        zero_var_df$adjPval <- NA
        if ("se" %in% names(results_df)) zero_var_df$se <- NA
        if ("df" %in% names(results_df)) zero_var_df$df <- NA
        for (col in setdiff(names(results_df), names(zero_var_df))) {
            zero_var_df[[col]] <- NA
        }
        zero_var_df <- zero_var_df[, names(results_df)]
        results_df <- rbind(results_df, zero_var_df)
    }

    # ── Write output ────────────────────────────────────────────────────────────
    output_file <- file.path(output_dir, paste0("Diff_Expression_", label, ".tsv"))
    cat("    Writing results to:", output_file, "\n")
    write.table(results_df, file = output_file, sep = "\t", row.names = FALSE, quote = FALSE)

    # Summary
    sig_count <- sum(results_df$adjPval < 0.05, na.rm = TRUE)
    up_count <- sum(results_df$logFC > 0 & results_df$adjPval < 0.05, na.rm = TRUE)
    down_count <- sum(results_df$logFC < 0 & results_df$adjPval < 0.05, na.rm = TRUE)
    cat("    Total proteins:", nrow(results_df), "\n")
    cat("    Significant (adjPval < 0.05):", sig_count, "\n")
    cat("    Upregulated:", up_count, "\n")
    cat("    Downregulated:", down_count, "\n")
    flush.console()
}

cat("\nStep 7 complete: msqrob2 multi-condition differential expression finished successfully\n")
```

- [ ] **Step 2: Verify R script syntax**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" --no-save -e 'parse(file="backend/scripts/msqrob2_group_comparison_multi.R"); cat("Syntax OK\n")'
```

Expected: `Syntax OK`

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/msqrob2_group_comparison_multi.R
git commit -m "feat: add msqrob2_group_comparison_multi.R for native msqrob2 DE with unified comparison format"
```

---

### Task 4: Rewrite Msqrob2Wrapper with Full Operational Parity

**Files:**
- Rewrite: `backend/app/services/msqrob2_wrapper.py`

- [ ] **Step 1: Write the refactored wrapper**

Replace the entire file content:

```python
"""
R/msqrob2 integration via subprocess.

Handles protein abundance (QFeatures aggregation) and differential expression
(msqrob2 robust regression) through subprocess calls (NEVER rpy2).

Implements steps 6-7 of the MULTI_CONDITION pipeline with full operational parity
to the MSstats wrapper: heartbeat logging, RDS checkpointing, per-step timeouts,
SnowParam core calibration, and automatic timeout retry.
"""

import asyncio
import json
import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional

from app.core.config import settings
from app.core.exceptions import RScriptError
from app.models.analysis import AnalysisConfig

logger = logging.getLogger("proteomics")


class Msqrob2Wrapper:
    """
    Wrapper for R/msqrob2+QFeatures functionality via subprocess.

    Implements steps 6 and 7 of the multi-condition pipeline:
    - Step 6: Protein Abundance via QFeatures (data_process)
    - Step 7: Differential Expression via msqrob2 (group_comparison_multi)
    """

    def __init__(self):
        """Initialize wrapper with R executable path."""
        self.r_executable = settings.r_executable
        self._optimal_ncores: int | None = None
        self.timeout = settings.r_script_timeout
        self.scripts_dir = Path(__file__).parent.parent.parent / "scripts"

    async def _calibrate_ncores(self, input_file: Path) -> int:
        """Benchmark SnowParam worker counts on a data slice, return optimal ncores.

        Runs aggregation on first 100K rows with worker counts [1, 4, 8, 16, 32],
        picks the fastest. Result cached for backend process lifetime.
        """
        if self._optimal_ncores is not None:
            return self._optimal_ncores

        logger.info("Calibrating optimal SnowParam worker count...")
        candidate_counts = [1, 4, 8, 16, 32]
        best_n = 4
        best_time = float("inf")

        for n in candidate_counts:
            try:
                elapsed = await self._benchmark_ncores(input_file, n)
                logger.info(f"  n_cores={n}: {elapsed:.1f}s")
                if elapsed < best_time:
                    best_time = elapsed
                    best_n = n
            except Exception as e:
                logger.warning(f"  n_cores={n}: calibration failed ({e})")

        self._optimal_ncores = best_n
        logger.info(f"Calibration complete: optimal n_cores={best_n} ({best_time:.1f}s)")
        return best_n

    async def _benchmark_ncores(self, input_file: Path, n_cores: int) -> float:
        """Run a quick aggregation benchmark with n_cores on a data slice."""
        import time

        slice_file = input_file.parent / f"_msqrob2_calibration_slice_{n_cores}.parquet"
        rds_file = input_file.parent / f"_msqrob2_calibration_{n_cores}.rds"
        out_file = input_file.parent / f"_msqrob2_calibration_output_{n_cores}.tsv"

        try:
            import pandas as pd
            df = pd.read_parquet(input_file)
            slice_df = df.head(100000)
            slice_df.to_parquet(slice_file)

            bench_config = {
                "normalization": "center.median",
                "imputation": "none",
                "aggregation": "robustSummary",
                "min_peptides": 1,
                "numberOfCores": n_cores,
            }

            script_path = self.scripts_dir / "msqrob2_data_process.R"
            config_json = json.dumps(bench_config)
            cmd = [
                self.r_executable, str(script_path),
                str(slice_file), str(out_file), str(rds_file), "", config_json,
            ]

            start = time.time()
            await self._run_r_script(cmd, script_path, timeout=120)
            return time.time() - start
        finally:
            for f in [slice_file, rds_file, out_file]:
                if f.exists():
                    f.unlink(missing_ok=True)

    async def _run_r_script(
        self, cmd: list[str], script_path: Path,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
    ) -> None:
        """
        Run an R script via subprocess with real-time output streaming and heartbeat.

        Args:
            cmd: Full command list (executable + script + args)
            script_path: Path to R script (for error messages)
            log_callback: Optional async callback (level, message) for real-time logging
            timeout: Per-call timeout override

        Raises:
            RScriptError: If script fails or times out
        """
        effective_timeout = timeout if timeout is not None else self.timeout
        logger.info(f"Starting R script with timeout {effective_timeout}s")

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env={**os.environ, "R_NCORES": str(settings.r_n_cores)},
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        def stream_output(pipe, lines_list, log_prefix, log_level="info", log_cb=None, event_loop=None):
            """Stream output from pipe and log immediately."""
            try:
                for line in iter(pipe.readline, ""):
                    if not line:
                        break
                    line = line.rstrip("\n\r")
                    lines_list.append(line)
                    logger.info(f"{log_prefix}: {line}")
                    if log_cb and event_loop:
                        try:
                            asyncio.run_coroutine_threadsafe(
                                log_cb(log_level, line), event_loop
                            )
                        except Exception:
                            pass
                pipe.close()
            except Exception as e:
                logger.error(f"Error reading {log_prefix}: {e}")

        stdout_thread = threading.Thread(
            target=stream_output,
            args=(process.stdout, stdout_lines, "R", "info", log_callback, loop),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=stream_output,
            args=(process.stderr, stderr_lines, "R-err", "warning", log_callback, loop),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        # Heartbeat thread: logs every 60s while process runs
        heartbeat_stop = threading.Event()

        def heartbeat():
            count = 0
            while not heartbeat_stop.is_set():
                if heartbeat_stop.wait(60):
                    break
                count += 1
                msg = f"Still working... ({count * 60}s elapsed)"
                logger.info(f"Heartbeat: {msg}")
                if log_callback and loop:
                    try:
                        asyncio.run_coroutine_threadsafe(
                            log_callback("info", msg), loop
                        )
                    except Exception:
                        pass

        heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
        heartbeat_thread.start()

        try:
            await asyncio.to_thread(process.wait, timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            await asyncio.to_thread(process.wait)
            stdout_thread.join(timeout=5)
            stderr_thread.join(timeout=5)
            raise
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1)

        stdout_thread.join(timeout=30)
        stderr_thread.join(timeout=30)

        stdout_str = "\n".join(stdout_lines)
        stderr_str = "\n".join(stderr_lines)

        if process.returncode != 0:
            error_msg = stderr_str if stderr_str else "Unknown error"
            logger.error(
                f"R script failed with return code {process.returncode}: {error_msg}"
            )
            raise RScriptError(
                message=error_msg,
                details={
                    "returncode": process.returncode,
                    "stderr": error_msg[:500],
                    "stdout": stdout_str[:500],
                    "script": str(script_path),
                },
            )

    async def data_process(
        self,
        input_file: Path,
        output_file: Path,
        rds_output: Path,
        gene_mapping_file: Optional[Path] = None,
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
        """
        Step 6: Calculate protein abundance using QFeatures preprocessing.

        Transforms PSM-level data to protein-level abundance using the QFeatures
        framework: logTransform -> normalize -> impute -> aggregateFeatures.

        Args:
            input_file: Path to PSM_Abundances.{tsv|parquet}
            output_file: Path for Protein_Abundances.tsv output
            rds_output: Path for MSqRob2_Processed.rds (intermediate checkpoint)
            gene_mapping_file: Optional protein to gene mapping file
            config: AnalysisConfig with msqrob2 parameters
            log_callback: Optional callback for real-time log messages (level, message)
            timeout: Per-call timeout override
            timeout_multiplier: Multiplier for timeout (2x on retry)

        Returns:
            Path to output file

        Raises:
            RScriptError: If R script fails or times out
        """
        logger.info(
            "Step 6: Calculating protein abundance with msqrob2/QFeatures",
            extra={"session_id": "unknown", "input": str(input_file)},
        )

        script_path = self.scripts_dir / "msqrob2_data_process.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        cfg = config if config else AnalysisConfig()

        # Calibrate n_cores if user hasn't overridden
        n_cores = cfg.msqrob2_n_cores
        if n_cores is None or n_cores == 32:
            try:
                if self._optimal_ncores is not None:
                    n_cores = self._optimal_ncores
                else:
                    n_cores = await self._calibrate_ncores(input_file)
            except Exception:
                n_cores = 4

        r_config = {
            "normalization": cfg.msqrob2_normalization,
            "imputation": cfg.msqrob2_imputation,
            "aggregation": cfg.msqrob2_aggregation,
            "min_peptides": cfg.msqrob2_min_peptides,
            "numberOfCores": n_cores,
        }

        config_json = json.dumps(r_config)

        cmd = [
            self.r_executable,
            str(script_path),
            str(input_file),
            str(output_file),
            str(rds_output),
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd)}")

        try:
            effective_timeout = (timeout if timeout is not None else settings.r_msqrob2_data_process_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)

            logger.info(
                "Step 6 complete: Protein abundance calculated",
                extra={"output": str(output_file)},
            )

            return output_file

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"Protein abundance calculation timed out after {effective_timeout}s",
                details={"timeout": effective_timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback
            raise RScriptError(
                message=f"Protein abundance calculation failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def group_comparison_multi(
        self,
        rds_file: Path,
        output_dir: Path,
        comparisons: list[dict],
        gene_mapping_file: Optional[Path] = None,
        config: Optional[AnalysisConfig] = None,
        log_callback: Optional[callable] = None,
        timeout: int | None = None,
        timeout_multiplier: int = 1,
    ) -> Path:
        """
        Step 7 (multi-condition): Run msqrob2-native DE for all contrasts.

        Args:
            rds_file: Path to MSqRob2_Processed.rds from data_process step
            output_dir: Directory for per-comparison Diff_Expression_*.tsv files
            comparisons: List of {group1: {Condition: "X"}, group2: {Condition: "Y"}} dicts
            gene_mapping_file: Optional protein to gene mapping file (API compat)
            log_callback: Optional callback for real-time log messages
            timeout: Per-call timeout override
            timeout_multiplier: Multiplier for timeout (2x on retry)

        Returns:
            Path to output directory

        Raises:
            RScriptError: If R script fails or times out
        """
        logger.info(
            "Step 7 (multi): Running msqrob2-native multi-condition DE",
            extra={"input": str(rds_file), "comparisons": len(comparisons)},
        )

        script_path = self.scripts_dir / "msqrob2_group_comparison_multi.R"

        if not script_path.exists():
            raise RScriptError(
                message=f"R script not found: {script_path}",
                details={"script": str(script_path)},
            )

        comparisons_json = json.dumps(comparisons)

        cfg = config if config else AnalysisConfig()

        # Build config for DE parameters from AnalysisConfig msqrob2 fields
        gc_config = {
            "model": cfg.msqrob2_model,
            "robust": cfg.msqrob2_robust,
            "ridge": cfg.msqrob2_ridge,
            "adjust_method": cfg.msqrob2_adjust_method,
        }
        config_json = json.dumps(gc_config)

        cmd = [
            self.r_executable,
            str(script_path),
            str(rds_file),
            str(output_dir),
            comparisons_json,
            str(gene_mapping_file) if gene_mapping_file else "",
            config_json,
        ]

        logger.info(f"R command: {' '.join(cmd[:5])}...")

        try:
            effective_timeout = (timeout if timeout is not None else settings.r_msqrob2_group_comparison_timeout) * timeout_multiplier
            await self._run_r_script(cmd, script_path, log_callback, timeout=effective_timeout)

            logger.info(
                "Step 7 (multi) complete: msqrob2 multi-condition DE calculated",
                extra={"output_dir": str(output_dir)},
            )

            return output_dir

        except subprocess.TimeoutExpired:
            raise RScriptError(
                message=f"msqrob2 DE analysis timed out after {effective_timeout}s",
                details={"timeout": effective_timeout},
            )
        except RScriptError:
            raise
        except Exception as e:
            import traceback
            raise RScriptError(
                message=f"msqrob2 DE analysis failed: {str(e)}",
                details={"error": str(e), "traceback": traceback.format_exc()},
            )

    async def verify_r_packages(self) -> dict:
        """
        Verify that required R packages are installed.

        Returns:
            Dictionary with verification results
        """
        script_path = self.scripts_dir / "verify_r_packages.R"

        if not script_path.exists():
            return {
                "success": False,
                "error": f"Verification script not found: {script_path}",
            }

        try:
            def run_verify():
                return subprocess.run(
                    [self.r_executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=60,
                )

            process = await asyncio.to_thread(run_verify)

            stdout_str = process.stdout if process.stdout else ""
            stderr_str = process.stderr if process.stderr else ""

            if process.returncode == 0:
                return {"success": True, "output": stdout_str}
            else:
                return {
                    "success": False,
                    "error": stderr_str or "Unknown error",
                    "output": stdout_str,
                }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Verification timed out"}
        except Exception as e:
            return {"success": False, "error": str(e)}


# Global wrapper instance
msqrob2_wrapper = Msqrob2Wrapper()
```

- [ ] **Step 2: Verify Python import**

```bash
cd backend && .venv/Scripts/python.exe -c "from app.services.msqrob2_wrapper import msqrob2_wrapper; print('Import OK'); print(type(msqrob2_wrapper).__name__)"
```

Expected: `Import OK` and `Msqrob2Wrapper`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/msqrob2_wrapper.py
git commit -m "feat: refactor Msqrob2Wrapper with heartbeat, core calibration, per-step timeouts, and RDS support"
```

---

### Task 5: Update Step Handlers with RDS Checkpointing

**Files:**
- Modify: `backend/app/services/steps/protein_abundance.py`
- Modify: `backend/app/services/steps/multi_condition_de.py`

- [ ] **Step 1: Rewrite protein_abundance.py**

Replace file content:

```python
"""Step 6: Protein abundance calculation (msqrob2/QFeatures)."""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
    get_psm_input,
)

logger = logging.getLogger("proteomics")


async def step_protein_abundance_msqrob2(ctx: StepContext) -> None:
    """Step 6: Protein abundance via QFeatures aggregation.

    Writes Protein_Abundances.tsv and MSqRob2_Processed.rds.
    Skips if a valid RDS checkpoint exists (newer than the input PSM file).
    """
    gene_mapping = get_gene_mapping(ctx.config.organism)
    psm_input = get_psm_input(ctx)

    protein_output = ctx.results_dir / "Protein_Abundances.tsv"
    rds_output = ctx.results_dir / "MSqRob2_Processed.rds"

    # Checkpoint: skip data_process if valid RDS exists
    if rds_output.exists() and psm_input.exists():
        rds_mtime = rds_output.stat().st_mtime
        psm_mtime = psm_input.stat().st_mtime
        if rds_mtime > psm_mtime:
            logger.info(
                "RDS checkpoint found (newer than input), skipping data_process",
                extra={"rds": str(rds_output), "rds_mtime": rds_mtime, "psm_mtime": psm_mtime},
            )
            ctx.state.add_log("info", "Checkpoint found — skipping protein abundance", step=6)
            if protein_output.exists():
                protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
                ctx.result.total_proteins = len(protein_df)
            ctx.result.protein_abundances_path = str(protein_output)
            ctx.step_outputs[6] = protein_output
            return

    logger.info("Step 6: About to run protein abundance via QFeatures")

    await msqrob2_wrapper.data_process(
        input_file=psm_input,
        output_file=protein_output,
        rds_output=rds_output,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=6),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    ctx.result.protein_abundances_path = str(protein_output)
    ctx.step_outputs[6] = protein_output

    protein_df = await asyncio.to_thread(pd.read_csv, protein_output, sep="\t")
    ctx.result.total_proteins = len(protein_df)
```

- [ ] **Step 2: Rewrite multi_condition_de.py**

Replace file content:

```python
"""Step 7: Multi-condition differential expression analysis (msqrob2)."""

import asyncio
import logging

import pandas as pd

from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import StepContext
from app.services.steps._helpers import (
    create_log_callback,
    get_gene_mapping,
)

logger = logging.getLogger("proteomics")


async def step_multi_condition_de(ctx: StepContext) -> None:
    """Step 7: Multi-condition DE using msqrob2 native robust regression.

    Loads MSqRob2_Processed.rds from step 6, runs msqrobLm + hypothesisTest
    for all contrasts, writes per-comparison Diff_Expression_*.tsv files.
    """
    rds_input = ctx.results_dir / "MSqRob2_Processed.rds"
    if not rds_input.exists():
        raise FileNotFoundError(
            f"MSqRob2_Processed.rds not found at {rds_input}. "
            "Step 6 (data_process) must complete first."
        )

    comparisons = ctx.config.comparisons if ctx.config.comparisons else []
    if not comparisons:
        raise ValueError("No comparisons specified for multi-condition analysis")

    logger.info(f"Step 7 (msqrob2 multi): Running {len(comparisons)} comparisons")

    gene_mapping = get_gene_mapping(ctx.config.organism)

    await msqrob2_wrapper.group_comparison_multi(
        rds_file=rds_input,
        output_dir=ctx.results_dir,
        comparisons=comparisons,
        gene_mapping_file=gene_mapping,
        config=ctx.config,
        log_callback=create_log_callback(ctx, step=7),
        timeout_multiplier=ctx.timeout_multiplier,
    )

    # Record the first comparison result as the primary diff_expression_path
    if comparisons:
        first = comparisons[0]
        label = _build_label(first["group1"]) + "_vs_" + _build_label(first["group2"])
        ctx.result.diff_expression_path = str(
            ctx.results_dir / f"Diff_Expression_{label}.tsv"
        )

    ctx.step_outputs[7] = ctx.results_dir

    # Count total significant proteins across all comparison files
    total_sig = 0
    for comp in comparisons:
        label = _build_label(comp["group1"]) + "_vs_" + _build_label(comp["group2"])
        de_file = ctx.results_dir / f"Diff_Expression_{label}.tsv"
        if de_file.exists():
            de_df = await asyncio.to_thread(pd.read_csv, de_file, sep="\t")
            sig_count = len(de_df[de_df["adjPval"] < ctx.config.pvalue_threshold])
            total_sig += sig_count

    ctx.result.significant_proteins = total_sig


def _build_label(group: dict) -> str:
    """Build a label from a comparison group dict, e.g. {Condition: 'Drug'} -> 'Drug'."""
    return "+".join(str(v) for v in group.values())
```

- [ ] **Step 3: Verify step handler imports**

```bash
cd backend && .venv/Scripts/python.exe -c "from app.services.steps import step_protein_abundance_msqrob2, step_multi_condition_de; print('Both handlers import OK')"
```

Expected: `Both handlers import OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/steps/protein_abundance.py backend/app/services/steps/multi_condition_de.py
git commit -m "feat: add RDS checkpointing to msqrob2 step handlers, use unified comparison format"
```

---

### Task 6: Update Pipeline Registry and Step Exports

**Files:**
- Modify: `backend/app/services/pipeline_registry.py`
- Modify: `backend/app/services/steps/__init__.py` (if needed)

- [ ] **Step 1: Update pipeline_registry.py display names**

Change lines 46-48 (Step 6 display name) to:

```python
        PipelineStep(
            6,
            "protein_abundance",
            "Protein Abundance (msqrob2/QFeatures)",
            step_protein_abundance_msqrob2,
        ),
```

And lines 52-54 (Step 7 display name) to:

```python
        PipelineStep(
            7,
            "multi_condition_de",
            "Differential Expression (msqrob2)",
            step_multi_condition_de,
        ),
```

Note: The handler function names (`step_protein_abundance_msqrob2`, `step_multi_condition_de`) are unchanged from current, so `__init__.py` does not need modification. Verify this.

- [ ] **Step 2: Verify pipeline registry loads**

```bash
cd backend && .venv/Scripts/python.exe -c "from app.services.pipeline_registry import PIPELINES; print(list(PIPELINES.keys())); pipe = PIPELINES['multi_condition_comparison']; print([(s.number, s.display_name) for s in pipe.steps])"
```

Expected: Prints both pipeline templates with updated display names for steps 6 and 7.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/pipeline_registry.py
git commit -m "chore: update msqrob2 pipeline step display names"
```

---

### Task 7: Delete Old R Scripts

**Files:**
- Delete: `backend/scripts/msqrob2_protein.R`
- Delete: `backend/scripts/msqrob2_de.R`
- Delete: `backend/scripts/msqrob2_de_multi.R`

- [ ] **Step 1: Verify no remaining references to old scripts**

```bash
cd backend && grep -r "msqrob2_protein\.R\|msqrob2_de\.R\|msqrob2_de_multi\.R" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.md" . || echo "No references found"
```

Expected: Either no references or only references in documentation that will be updated.

If references found in code (not .md docs), fix them before deletion.

- [ ] **Step 2: Delete old scripts**

```bash
git rm backend/scripts/msqrob2_protein.R backend/scripts/msqrob2_de.R backend/scripts/msqrob2_de_multi.R
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove legacy limma-based msqrob2 R scripts"
```

---

### Task 8: Add Frontend msqrob2 Config Types

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add msqrob2 fields to SessionConfig in index.ts**

After `msstats_n_cores` (line 82), before `covariate_columns` (line 83):

```typescript
  // msqrob2
  msqrob2_normalization?: string;
  msqrob2_imputation?: string;
  msqrob2_aggregation?: string;
  msqrob2_model?: string;
  msqrob2_robust?: boolean;
  msqrob2_ridge?: boolean;
  msqrob2_adjust_method?: string;
  msqrob2_min_peptides?: number;
  msqrob2_n_cores?: number;
```

- [ ] **Step 2: Add same fields to SessionConfig in api.ts**

Find the `SessionConfig` interface in `frontend/src/types/api.ts` and add the same 9 fields after the MSstats fields.

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/types/api.ts
git commit -m "feat: add msqrob2 config fields to frontend types"
```

---

### Task 9: Create Msqrob2ConfigForm Component

**Files:**
- Create: `frontend/src/components/analysis/Msqrob2ConfigForm.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import React from 'react';
import type { SessionConfig } from '@/types';

interface Msqrob2ConfigFormProps {
  config: SessionConfig;
  setConfig: (partial: Partial<SessionConfig>) => void;
}

export default function Msqrob2ConfigForm({ config, setConfig }: Msqrob2ConfigFormProps) {
  return (
    <div className="space-y-5">
      {/* Normalization Method */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Normalization Method
        </label>
        <select
          data-testid="msqrob2-normalization-select"
          value={config.msqrob2_normalization ?? 'center.median'}
          onChange={(e) => setConfig({ msqrob2_normalization: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="center.median">Center Median (shift to max)</option>
          <option value="center.mean">Center Mean</option>
          <option value="quantiles">Quantiles</option>
          <option value="quantiles.robust">Robust Quantiles</option>
          <option value="vsn">VSN (Variance Stabilization)</option>
          <option value="div.median">Divide by Median</option>
          <option value="none">None (No Normalization)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Normalization corrects for systematic technical variation across samples
        </p>
      </div>

      {/* Imputation Method */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Missing Value Imputation
        </label>
        <select
          data-testid="msqrob2-imputation-select"
          value={config.msqrob2_imputation ?? 'none'}
          onChange={(e) => setConfig({ msqrob2_imputation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="none">None (Filter only)</option>
          <option value="knn">KNN (k-Nearest Neighbors)</option>
          <option value="bpca">BPCA (Bayesian PCA)</option>
          <option value="MinDet">MinDet (Deterministic Minimum)</option>
          <option value="MinProb">MinProb (Probabilistic Minimum)</option>
          <option value="QRILC">QRILC (Quantile Regression)</option>
          <option value="MLE">MLE (Maximum Likelihood)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Impute missing peptide intensities before protein aggregation
        </p>
      </div>

      {/* Aggregation Method */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Protein Aggregation Method
        </label>
        <select
          data-testid="msqrob2-aggregation-select"
          value={config.msqrob2_aggregation ?? 'robustSummary'}
          onChange={(e) => setConfig({ msqrob2_aggregation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="robustSummary">Robust Summary (MAD-based, recommended)</option>
          <option value="medianPolish">Median Polish (Tukey)</option>
          <option value="sum">Sum</option>
          <option value="mean">Mean</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          How peptide intensities are combined into protein-level values
        </p>
      </div>

      {/* DE Model */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Differential Expression Model
        </label>
        <select
          data-testid="msqrob2-model-select"
          value={config.msqrob2_model ?? 'msqrobLm'}
          onChange={(e) => setConfig({ msqrob2_model: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="msqrobLm">msqrobLm (Robust Linear Model, recommended)</option>
          <option value="msqrobGlm">msqrobGlm (Generalized Linear Model)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          msqrobLm uses M-estimation with Huber weights for outlier resistance. msqrobGlm is for count-like data
        </p>
      </div>

      {/* Robust estimation toggle (only for msqrobLm) */}
      {(config.msqrob2_model ?? 'msqrobLm') === 'msqrobLm' && (
        <>
          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text">Robust Estimation (M-estimation)</span>
              <p className="text-xs text-text-muted mt-0.5">
                Use Huber weights to down-weight outlier observations in model fitting
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msqrob2-robust-checkbox"
              checked={config.msqrob2_robust ?? true}
              onChange={(e) => setConfig({ msqrob2_robust: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>

          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text">Ridge Penalty</span>
              <p className="text-xs text-text-muted mt-0.5">
                Apply ridge regression penalty for high-dimensional or collinear experimental designs
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msqrob2-ridge-checkbox"
              checked={config.msqrob2_ridge ?? false}
              onChange={(e) => setConfig({ msqrob2_ridge: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>
        </>
      )}

      {/* Multiple Testing Correction */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Multiple Testing Correction
        </label>
        <select
          data-testid="msqrob2-adjust-select"
          value={config.msqrob2_adjust_method ?? 'BH'}
          onChange={(e) => setConfig({ msqrob2_adjust_method: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="BH">Benjamini-Hochberg (BH, recommended)</option>
          <option value="bonferroni">Bonferroni</option>
          <option value="holm">Holm</option>
          <option value="BY">Benjamini-Yekutieli (BY)</option>
          <option value="fdr">FDR</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Method for adjusting p-values to control false discovery rate
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/analysis/Msqrob2ConfigForm.tsx
git commit -m "feat: add Msqrob2ConfigForm component for msqrob2-specific parameters"
```

---

### Task 10: Wire Msqrob2ConfigForm into Config Page

**Files:**
- Modify: `frontend/src/app/new/config/page.tsx`

- [ ] **Step 1: Import and add Msqrob2ConfigForm to config page**

Add import after line 23:

```tsx
import Msqrob2ConfigForm from '@/components/analysis/Msqrob2ConfigForm';
```

Add msqrob2 section after the MSstats section (after line 193, before the validation warning):

```tsx
      {/* msqrob2-specific parameters */}
      {selectedPipeline === 'msqrob2' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Dna className="w-5 h-5 text-accent" />
            <div>
              <h2 className="text-lg font-semibold text-text">msqrob2 Parameters</h2>
              <p className="text-sm text-text-muted">
                Configure msqrob2/QFeatures preprocessing and statistical modeling options
              </p>
            </div>
          </div>
          <div className="p-5">
            <Msqrob2ConfigForm config={config} setConfig={setConfig} />
          </div>
        </section>
      )}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/new/config/page.tsx
git commit -m "feat: wire Msqrob2ConfigForm into config page for msqrob2 pipeline"
```

---

### Task 11: Update Frontend Processing Steps and Store

**Files:**
- Modify: `frontend/src/types/processing.ts`
- Modify: `frontend/src/stores/processing-store.ts`

- [ ] **Step 1: Update PROCESSING_STEPS descriptions**

In `processing.ts`, change steps 6 and 7:

```typescript
  {
    id: 6,
    name: 'Calculate Protein Abundance',
    description: 'Normalize, impute, and aggregate peptides to proteins via QFeatures',
    package: '',
    function: '',
  },
  {
    id: 7,
    name: 'Differential Expression Analysis',
    description: 'Robust statistical testing via msqrob2 (M-estimation with empirical Bayes)',
    package: '',
    function: '',
  },
```

- [ ] **Step 2: Update processing-store.ts patch strings**

In `processing-store.ts`, change lines 64-71 to:

```typescript
      if (step.id === 6) {
        patched.package = pipeline === 'msstats' ? 'R/MSstats' : 'R/msqrob2+QFeatures';
        patched.function = pipeline === 'msstats' ? 'dataProcess()' : 'dataProcess()';
      }
      if (step.id === 7) {
        patched.package = pipeline === 'msstats' ? 'R/MSstats' : 'R/msqrob2';
        patched.function = pipeline === 'msstats' ? 'groupComparison()' : 'msqrobLm()';
      }
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/processing.ts frontend/src/stores/processing-store.ts
git commit -m "feat: update frontend processing step descriptions and function labels for msqrob2 rebuild"
```

---

### Task 12: Write Integration Tests

**Files:**
- Create: `Tests/backend/integration/test_msqrob2_pipeline_performance.py`

- [ ] **Step 1: Write integration tests**

```python
"""
Integration tests for msqrob2 pipeline performance features.

Verifies: step count, per-step timeouts, wrapper config serialization,
RDS checkpoint behavior, heartbeat logging, and timeout retry.
"""

import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from app.core.config import settings
from app.models.analysis import AnalysisConfig, AnalysisTemplate
from app.services.msqrob2_wrapper import msqrob2_wrapper
from app.services.pipeline_engine import PipelineDefinition, PipelineStep, PipelineEngine, StepContext
from app.services.steps import (
    step_combine_replicates,
    step_generate_unique_psm,
    step_remove_razor,
    step_remove_low_quality_default,
    step_filter_criteria_default,
    step_protein_abundance_msqrob2,
    step_multi_condition_de,
    step_qc_metrics,
    step_gsea_analysis,
)


class TestMsqrob2PipelineStructure:
    """Verify msqrob2 pipeline definition is correctly structured."""

    def test_nine_steps(self):
        """Pipeline has exactly 9 steps."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        assert len(pipeline.steps) == 9

    def test_step_numbers_sequential(self):
        """Steps are numbered 1 through 9."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        numbers = [s.number for s in pipeline.steps]
        assert numbers == list(range(1, 10))

    def test_step_6_is_msqrob2(self):
        """Step 6 uses msqrob2 handler."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        step6 = pipeline.steps[5]  # index 5 = step 6
        assert step6.number == 6
        assert "msqrob2" in step6.display_name.lower()
        assert step6.handler == step_protein_abundance_msqrob2

    def test_step_7_is_msqrob2(self):
        """Step 7 uses msqrob2 handler."""
        from app.services.pipeline_registry import PIPELINES
        pipeline = PIPELINES[AnalysisTemplate.MULTI_CONDITION]
        step7 = pipeline.steps[6]  # index 6 = step 7
        assert step7.number == 7
        assert step7.handler == step_multi_condition_de


class TestMsqrob2Config:
    """Verify msqrob2 config fields serialize correctly."""

    def test_default_config(self):
        """Default AnalysisConfig has sensible msqrob2 defaults."""
        config = AnalysisConfig(template=AnalysisTemplate.MULTI_CONDITION)
        assert config.msqrob2_normalization == "center.median"
        assert config.msqrob2_imputation == "none"
        assert config.msqrob2_aggregation == "robustSummary"
        assert config.msqrob2_model == "msqrobLm"
        assert config.msqrob2_robust is True
        assert config.msqrob2_ridge is False
        assert config.msqrob2_adjust_method == "BH"

    def test_config_serialization(self):
        """Config serializes to dict with msqrob2 fields."""
        config = AnalysisConfig(template=AnalysisTemplate.MULTI_CONDITION)
        d = config.model_dump()
        assert "msqrob2_normalization" in d
        assert d["msqrob2_normalization"] == "center.median"
        assert d["msqrob2_robust"] is True

    def test_data_process_config_json(self):
        """Wrapper builds correct config JSON for data_process."""
        config = AnalysisConfig(
            template=AnalysisTemplate.MULTI_CONDITION,
            msqrob2_normalization="quantiles",
            msqrob2_imputation="knn",
            msqrob2_aggregation="medianPolish",
            msqrob2_n_cores=8,
        )
        # Simulate what the wrapper sends to R
        r_config = {
            "normalization": config.msqrob2_normalization,
            "imputation": config.msqrob2_imputation,
            "aggregation": config.msqrob2_aggregation,
            "min_peptides": config.msqrob2_min_peptides,
            "numberOfCores": config.msqrob2_n_cores,
        }
        json_str = json.dumps(r_config)
        parsed = json.loads(json_str)
        assert parsed["normalization"] == "quantiles"
        assert parsed["imputation"] == "knn"
        assert parsed["aggregation"] == "medianPolish"
        assert parsed["numberOfCores"] == 8


class TestMsqrob2Timeouts:
    """Verify per-step timeout settings exist."""

    def test_data_process_timeout(self):
        """data_process has its own timeout setting."""
        assert settings.r_msqrob2_data_process_timeout == 7200

    def test_group_comparison_timeout(self):
        """group_comparison has its own timeout setting."""
        assert settings.r_msqrob2_group_comparison_timeout == 3600

    def test_timeouts_are_distinct(self):
        """Step 6 and Step 7 have different timeout settings."""
        assert settings.r_msqrob2_data_process_timeout != settings.r_msqrob2_group_comparison_timeout


class TestMsqrob2TimeoutRetry:
    """Verify timeout detection works for msqrob2 wrapper."""

    def test_timeout_expired_detection(self):
        """subprocess.TimeoutExpired is detectable."""
        import subprocess as sp
        assert issubclass(sp.TimeoutExpired, sp.SubprocessError)

    def test_wrapper_has_timeout_multiplier_param(self):
        """Wrapper methods accept timeout_multiplier."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.data_process)
        assert "timeout_multiplier" in sig.parameters
        sig2 = inspect.signature(msqrob2_wrapper.group_comparison_multi)
        assert "timeout_multiplier" in sig2.parameters


class TestMsqrob2WrapperAttributes:
    """Verify wrapper has required attributes and methods."""

    def test_has_rds_parameter(self):
        """data_process accepts rds_output parameter."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.data_process)
        assert "rds_output" in sig.parameters

    def test_group_comparison_accepts_rds(self):
        """group_comparison_multi accepts rds_file parameter."""
        import inspect
        sig = inspect.signature(msqrob2_wrapper.group_comparison_multi)
        assert "rds_file" in sig.parameters

    def test_has_calibration(self):
        """Wrapper has core calibration method."""
        assert hasattr(msqrob2_wrapper, "_calibrate_ncores")
        assert callable(msqrob2_wrapper._calibrate_ncores)

    def test_has_optimal_ncores_cache(self):
        """Wrapper caches calibration result."""
        assert hasattr(msqrob2_wrapper, "_optimal_ncores")


class TestMsqrob2ScriptExistence:
    """Verify new R scripts exist and old ones don't."""

    def test_data_process_script_exists(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_data_process.R"
        assert script.exists(), f"Missing: {script}"

    def test_group_comparison_script_exists(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_group_comparison_multi.R"
        assert script.exists(), f"Missing: {script}"

    def test_old_protein_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_protein.R"
        assert not script.exists(), f"Should be deleted: {script}"

    def test_old_de_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_de.R"
        assert not script.exists(), f"Should be deleted: {script}"

    def test_old_de_multi_script_removed(self):
        script = msqrob2_wrapper.scripts_dir / "msqrob2_de_multi.R"
        assert not script.exists(), f"Should be deleted: {script}"


class TestMSstatsUnaffected:
    """Verify MSstats pipeline is untouched."""

    def test_msstats_pipeline_still_registered(self):
        from app.services.pipeline_registry import PIPELINES
        assert AnalysisTemplate.MSSTATS in PIPELINES

    def test_msstats_step_6_unchanged(self):
        from app.services.pipeline_registry import PIPELINES
        from app.services.steps import step_msstats_protein_abundance
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step6 = [s for s in pipeline.steps if s.number == 6][0]
        assert step6.handler == step_msstats_protein_abundance

    def test_msstats_step_7_unchanged(self):
        from app.services.pipeline_registry import PIPELINES
        from app.services.steps import step_msstats_group_comparison
        pipeline = PIPELINES[AnalysisTemplate.MSSTATS]
        step7 = [s for s in pipeline.steps if s.number == 7][0]
        assert step7.handler == step_msstats_group_comparison
```

- [ ] **Step 2: Run the tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_msqrob2_pipeline_performance.py -v
```

Expected: All tests pass (script existence tests will pass after Tasks 2-3; deletion tests after Task 7).

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/integration/test_msqrob2_pipeline_performance.py
git commit -m "test: add integration tests for msqrob2 pipeline performance features"
```

---

### Task 13: Verify MSstats Regression

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run existing MSstats tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_msstats_pipeline_performance.py -v
```

Expected: All tests pass, no changes.

- [ ] **Step 2: Run existing R integration tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_r_integration.py -v
```

Expected: Tests for `msqrob2`, `QFeatures`, `limma` packages pass. Old script existence tests for `msqrob2_protein.R`, `msqrob2_de.R` will fail — update them to point to new scripts.

- [ ] **Step 3: Update test_r_integration.py script references**

Change `test_msqrob2_protein_script_exists` to check for `msqrob2_data_process.R`:

```python
    def test_msqrob2_data_process_script_exists(self):
        """msqrob2_data_process.R exists."""
        script_path = SCRIPTS_DIR / "msqrob2_data_process.R"
        assert script_path.exists(), f"Script not found: {script_path}"
```

Change `test_msqrob2_de_script_exists` to check for `msqrob2_group_comparison_multi.R`:

```python
    def test_msqrob2_group_comparison_script_exists(self):
        """msqrob2_group_comparison_multi.R exists."""
        script_path = SCRIPTS_DIR / "msqrob2_group_comparison_multi.R"
        assert script_path.exists(), f"Script not found: {script_path}"
```

- [ ] **Step 4: Run all backend integration tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/ -v
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add Tests/backend/integration/test_r_integration.py
git commit -m "test: update R integration tests for new msqrob2 script names"
```

---

### Task 14: End-to-End Verification

**Files:**
- None modified; verification only.

- [ ] **Step 1: Verify R packages available**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" -e "suppressPackageStartupMessages({library(msqrob2); library(QFeatures); library(limma); library(SummarizedExperiment); library(BiocParallel)}); cat('All packages OK\n')"
```

Expected: `All packages OK`

- [ ] **Step 2: Verify R script syntax (both new scripts)**

```bash
"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe" --no-save -e 'parse(file="backend/scripts/msqrob2_data_process.R"); parse(file="backend/scripts/msqrob2_group_comparison_multi.R"); cat("Both scripts parse OK\n")'
```

Expected: `Both scripts parse OK`

- [ ] **Step 3: Start backend and verify it boots**

```bash
taskkill //F //IM python.exe 2>$null; cd backend && .venv/Scripts/python.exe -c "from app.main import app; print('Backend imports OK')"
```

Expected: `Backend imports OK`

- [ ] **Step 4: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Verify no references to deleted scripts in code**

```bash
grep -r "msqrob2_protein\|msqrob2_de\.\|msqrob2_de_multi" --include="*.py" --include="*.ts" --include="*.tsx" backend/ frontend/ Tests/ 2>$null || echo "No references found (clean)"
```

Expected: No references to old script names in source code.

---

## Execution Order

```
Task 1 (config) ─────────────────────────────────────────────────┐
    │                                                             │
    ├── Task 2 (data_process.R) ──┐                               │
    ├── Task 3 (group_comparison.R)│                               │
    ├── Task 4 (wrapper rewrite) ─┤                               │
    │                              │                              │
    └── Task 5 (step handlers) ───┤                               │
                                   ├── Task 7 (delete old scripts)│
    Task 8 (frontend types) ──────┤                               │
    Task 9 (config form) ─────────┤                               │
    Task 10 (wire config page) ───┤                               │
    Task 11 (processing steps) ───┤                               │
                                   │                              │
    Task 6 (pipeline registry) ───┤                               │
                                   │                              │
    Task 12 (integration tests) ──┘                               │
    Task 13 (MSstats regression) ─┘                               │
    Task 14 (E2E verification) ───┘
```

**Parallel groups:**
- Tasks 2, 3, 4, 8 can start after Task 1
- Tasks 9, 10, 11 can start after Task 8 (frontend types)
- Task 5 depends on Task 4 (wrapper) being complete
- Task 6 is independent of most tasks
- Task 7 waits until Tasks 2-3 confirm new scripts work and Tasks 5-6 confirm nothing references old handlers
- Tasks 12-14 are final verification after all changes
