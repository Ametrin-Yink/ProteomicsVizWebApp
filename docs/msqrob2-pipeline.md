# msqrob2 Pipeline Reference (v1.16 API)

End-to-end trace of the msqrob2 consolidated pipeline (5 steps). Uses msqrob2 v1.16.0 API: `msqrob()` + `makeContrast()` + `hypothesisTest()`. Read alongside the source files — every reference includes a line number.

## Overview

```
Step 1-2 (Python)        Step 3 (R)                  Step 4 (R)                Step 5 (Python)
────────────────────────────────────────────────────────────────────────────────────────
PSM CSV files ──→ combine  ──→ read PSM data           ──→ load QFeatures RDS      ──→ QC metrics
                  unique   ──→ filter + reshape             assign conditions             PCA
                  save     ──→ QFeatures pipeline           assign batch                  p-value dist
                               log2 transform               msqrob(formula)               PSM CV
                               normalize                    makeContrast × N              intensity dist
                               impute                       hypothesisTest × N            completeness
                               aggregate → protein          write Diff_Exp_*.tsv
                               gene mapping
                               min peptides filter
                               batch correction
                               set colData
                               save QFeatures RDS + TSV
```

## Step 1: Combine Replicates (Python)

File: `backend/app/services/steps/combine_replicates.py`

- Reads all uploaded PSM CSV files (UTF-8, latin-1 fallback)
- Parses filename for experiment/condition/replicate metadata
- Discovers `Abundance F{code} Sample` column dynamically (TMT channel pattern)
- Validates required columns: `Sequence, Modifications, Charge, Contaminant, Master Protein Accessions, Quan Info`
- Concatenates into single DataFrame, saves `PSM_Combined.parquet`
- Sets `ctx.psm_file_path` for downstream steps

## Step 2: Generate Unique PSM (Python)

File: `backend/app/services/steps/unique_psm.py`

- Creates `Unique_PSM` column: `Sequence | Modifications | Charge`
- Re-saves parquet with Unique_PSM for R step 3
- Frees DataFrame from memory before R steps

## Step 3: Protein Abundance (R)

Script: `backend/scripts/msqrob2_data_process.R`

Invoked by `Msqrob2Wrapper.data_process()`:

```
Rscript msqrob2_data_process.R <input> <output> <rds> <gene_mapping> <config_json>
```

Config built by `_build_data_process_config()` in `msqrob2_wrapper.py:38`:
`normalization, imputation, aggregation, min_peptides, remove_razor, strict_filtering, numberOfCores, batch_column, metadata`

### Flow

1. **Read PSM data** — Parquet via `arrow::read_parquet()` or TSV via `data.table::fread()`
2. **Filter empty accessions** — removes blank `Master_Protein_Accessions`
3. **Contaminant/reverse filter** — conditional on `remove_razor`: removes `Contaminant="+"` and `Reverse="+"` rows
4. **Reshape long→wide** — dual path:
   - Long format (has `Sample_Origination`): aggregates by `Unique_PSM + protein + sample`, casts via `dcast()`, zeros→NA
   - Wide format (TMT): uses `Abundance F{code} Sample` columns
5. **Create QFeatures** — `readQFeatures(name="peptide")`, sets `rowData$Proteins`
6. **Overlapping protein groups** — if `remove_razor`: `smallestUniqueGroups()` filter
7. **nNonZero** — `rowSums(assay > 0)` per peptide
8. **Log2 transform** — `logTransform(pe, base=2, i="peptide", name="peptideLog")`
9. **Normalize** (configurable) — `normalize(pe, method=...)` → `"peptideNorm"`. Saves `normalization_coefficients.tsv`
10. **Impute** (configurable) — `impute(pe, method=...)` → `"peptideImputed"`
11. **Filter by nNonZero** — `strict_filtering` → ≥2, else ≥1
12. **Aggregate** — `aggregateFeatures(pe, i=agg_input, fcol="Proteins", name="protein", fun=agg_fun)` with `SnowParam`/`SerialParam`
13. **Gene mapping** — UniProt ID → Gene Name, stored in `rowData(pe[["protein"]])$Gene_Name`
14. **PSM counts** — stored in `rowData(pe[["protein"]])$PSM_Count`
15. **Min peptides filter** — if `min_peptides > 1`
16. **Set colData** — `colData(pe)$sample <- sample_names` (required for step 4)
17. **Batch correction** — if `batch_column`: `removeBatchEffect()` on protein matrix, stored as `"proteinBatchCorrected"` assay
18. **Write TSV** — `Protein_Abundances.tsv` (batch-corrected if available)
19. **Save RDS** — full QFeatures object as `MSqRob2_Processed.rds`

## Step 4: Differential Expression (R)

Script: `backend/scripts/msqrob2_group_comparison_multi.R`

Invoked by `Msqrob2Wrapper.group_comparison_multi()`:

```
Rscript msqrob2_group_comparison_multi.R <qfeatures_rds> <output_dir> <comparisons_json> <gene_mapping> <config_json>
```

Config built by `_build_gc_config()` in `msqrob2_wrapper.py:52`:
`ridge, maxitRob=10, adjust_method, numberOfCores, batch_column, metadata`

### Flow

1. **Load QFeatures RDS** — `pe <- readRDS(rds_file)`
2. **Extract sample names** — from `colnames(assay(pe[["protein"]]))` (not `colnames(pe)` which returns CharacterList)
3. **Parse comparisons** — JSON array `[{group1: {condition_1:"X",...}, group2: {condition_1:"Y",...}}]`
4. **Assign conditions** — metadata-based: for each sample, finds matching metadata entry by grepl all condition values, builds combined string `"cond1_cond2_cond3"` with underscore separator. Values sorted by length descending to prevent substring mismatches ("4h" in "24h"). Legacy fallback when no metadata.
5. **Assign batch** — if `batch_column` configured, same metadata matching logic
6. **Set colData** — `colData(pe) <- DataFrame(col_data, row.names=sample_names)`
7. **Build formula** — `~ 0 + condition` or `~ 0 + condition + batch`
8. **Fit model** — `msqrob(object=pe, i="protein", formula=formula, robust=TRUE, ridge=ridge, maxitRob=maxitRob)`. Stores per-protein models in rowData$msqrobModels.
9. **For each comparison**:
   - Match group values against condition levels → find `cond_x`, `cond_y`
   - `L <- makeContrast("cond_x - cond_y = 0", c(cond_x, cond_y))`
   - `pe <- hypothesisTest(pe, i="protein", contrast=L, adjust.method=adjust_method, overwrite=TRUE)`
   - Extract: `rowData(pe[["protein"]])[[colnames(L)[1]]]`
   - Map columns: `logFC, pval, adjPval, se, df`
   - Overwrite zero-variance proteins: `logFC=0, pval=NA, adjPval=NA, se=NA, df=NA`
   - Write `Diff_Expression_{label}.tsv`

### Output columns

```
Master_Protein_Accessions    Gene_Name    PSM_Count    logFC    pval    adjPval    se    df
```

## Step 5: QC Metrics (Python)

File: `backend/app/services/steps/qc_metrics_msqrob2.py`

- Reads `Diff_Expression_*.tsv` files, `Protein_Abundances.tsv`, `PSM_Combined.parquet`
- Computes PCA, p-value distributions, PSM CV, intensity distributions, data completeness
- Writes `QC_Results.json`
- Uses `ctx.step_outputs[5]` (separate from MSstats QC handler which uses `[8]`)

## Config → Step Mapping

| Config field | Step | Location |
|-------------|------|----------|
| `remove_razor` | 3 | Contaminant/reverse filtering + overlapping protein groups |
| `strict_filtering` | 3 | `filterFeatures(pe, ~ nNonZero >= 2)` vs `>= 1` |
| `msqrob2_normalization` | 3 | `normalize(pe, method=...)` |
| `msqrob2_imputation` | 3 | `impute(pe, method=...)` |
| `msqrob2_aggregation` | 3 | `aggregateFeatures(pe, fun=...)` |
| `msqrob2_min_peptides` | 3 | Min peptides filter after aggregation |
| `msqrob2_ridge` | 4 | `msqrob(..., ridge=TRUE)` |
| `msqrob2_adjust_method` | 4 | `hypothesisTest(..., adjust.method=...)` |
| `msqrob2_batch_column` | 3, 4 | Formula covariate + `removeBatchEffect()` |
| `msqrob2_n_cores` | 3, 4 | SnowParam workers + BiocParallel registration |
| `msqrob2_model` | — | **Deprecated.** `msqrob()` replaces `msqrobLm`; no msqrobGlm in v1.16 |
| `msqrob2_robust` | — | **Deprecated.** `msqrob()` always uses robust regression |
| `pvalue_threshold` | 4, 5 | Sig-protein counting + volcano |
| `logfc_threshold` | — | Frontend volcano filtering |

## Key Files

| File | Purpose |
|------|---------|
| `backend/app/services/pipeline_registry.py` | Pipeline definitions (msqrob2 5 steps, MSstats 8 steps) |
| `backend/app/services/pipeline_engine.py` | Execution engine with state tracking |
| `backend/app/services/processing_orchestrator.py` | Adapts engine to session lifecycle |
| `backend/app/services/msqrob2_wrapper.py` | R subprocess wrapper, config builders |
| `backend/app/services/steps/combine_replicates.py` | Step 1: combine files, save parquet |
| `backend/app/services/steps/unique_psm.py` | Step 2: Unique_PSM, re-save |
| `backend/app/services/steps/protein_abundance.py` | Step 3: invoke R data process |
| `backend/app/services/steps/multi_condition_de.py` | Step 4: invoke R DE |
| `backend/app/services/steps/qc_metrics_msqrob2.py` | Step 5: QC metrics |
| `backend/scripts/msqrob2_data_process.R` | Step 3 R: QFeatures pipeline |
| `backend/scripts/msqrob2_group_comparison_multi.R` | Step 4 R: msqrob DE |
| `backend/app/models/analysis.py` | `AnalysisConfig` model with all defaults |
