# Spec: Consolidated msqrob2 Pipeline (v1.16.0 API)

## Context

msqrob2 v1.16.0 broke the DE workflow: `msqrobLm()` now returns a per-protein
list of `StatModel` objects, and `hypothesisTest()` only accepts `QFeatures` or
`SummarizedExperiment`. The old approach of calling `msqrobLm(y=matrix,
formula=~condition, data=col_data)` then `hypothesisTest(fit, contrast=...)` is
dead.

The new API uses `msqrob(pe, i="protein", formula=~condition)` which stores
per-protein models in `rowData(pe[["protein"]])$msqrobModels`, and
`hypothesisTest(pe, i="protein", contrast=L, adjust.method="BH")` which
internally calls `topFeatures()` and stores results in rowData. `makeContrast()`
builds the contrast matrix from parameter names.

The rewrite consolidates Python preprocessing (old steps 3-5: remove_razor,
remove_low_quality, filter_criteria) into the R QFeatures pipeline, eliminating
a redundant Python-R file round-trip. MSstats pipeline is untouched.

**Input contract (unchanged):** PSM CSV files, metadata_columns, comparisons,
AnalysisConfig with all msqrob2 fields.

**Output contract (unchanged):** `Diff_Expression_{label}.tsv` with columns:
`Master_Protein_Accessions, Gene_Name, PSM_Count, logFC, pval, adjPval, se, df`

## Verified API Details (msqrob2 v1.16.0)

Tested end-to-end with actual session data:

- `msqrob(object, i, formula, modelColumnName="msqrobModels", robust=TRUE, ridge=FALSE, maxitRob=1, ...)` — QFeatures dispatch
- `hypothesisTest(object, i, contrast, adjust.method="BH", modelColumn="msqrobModels", resultsColumnNamePrefix="", overwrite=FALSE)` — QFeatures dispatch
- `makeContrast("A - B = 0", c("A", "B"))` → 2×1 matrix, colname `"A - B"`
- `makeContrast("A=0", c("A"))` → 1×1 matrix, colname `"A"`
- Result columns from rowData: `logFC, se, df, t, pval, adjPval` (6 columns)
- `overwrite=TRUE` required when calling hypothesisTest multiple times on the same assay
- Formula variables must be in `colData(pe)` — msqrob validates this

## New Pipeline (msqrob2 — 5 steps)

```
Step 1 (Python): combine_replicates     — read CSVs, validate, concat, → PSM_Combined.parquet
Step 2 (Python): generate_unique_psm    — load parquet, add Unique_PSM, re-save
Step 3 (R):      protein_abundance      — QFeatures pipeline: filter, log2, normalize,
                                           impute, aggregate, gene map, min-peptides,
                                           batch correct, set colData, → QFeatures RDS + TSV
Step 4 (R):      differential_expression — msqrob(formula, robust=TRUE, maxitRob=10),
                                            makeContrast + hypothesisTest(overwrite=TRUE)
                                            for N comparisons, → Diff_Expression_*.tsv
Step 5 (Python): qc_metrics             — QC from DE files + protein abundances
```

## Step 3 Detail

Input: `PSM_Combined.parquet` (from step 2), `gene_mapping_file`, `config_json`

1. Read PSM data (Parquet or TSV)
2. Filter empty accessions + contaminants + reverse sequences
3. Handle overlapping protein groups (if remove_razor configured)
4. Reshape long→wide (same dual-path logic as today)
5. Create QFeatures object named `"peptide"`
6. Calculate nNonZero per peptide → `rowData(pe[["peptide"]])$nNonZero`
7. Log2 transform → `"peptideLog"`
8. Normalize (configurable) → `"peptideNorm"`
9. Impute (configurable) → `"peptideImputed"`
10. Filter by nNonZero (strict_filtering → min 2 obs, else min 1)
11. Aggregate peptides→protein via `aggregateFeatures()` → `"protein"`
12. Gene mapping from UniProt file → `rowData(pe[["protein"]])$Gene_Name`
13. PSM counts → `rowData(pe[["protein"]])$PSM_Count`
14. Min peptides filter (if configured)
15. **Set `colData(pe)$sample <- sample_names`** (critical for step 4)
16. Batch correction: `removeBatchEffect()` on protein matrix → save corrected
    version to `"proteinBatchCorrected"` assay
17. Write `Protein_Abundances.tsv` (batch-corrected if available)
18. Save QFeatures object as `MSqRob2_Processed.rds`

## Step 4 Detail

Input: `MSqRob2_Processed.rds` (QFeatures), `comparisons_json`, `config_json`

1. Load QFeatures RDS
2. Parse comparisons JSON (same format as today)
3. Assign conditions to samples via `grepl(fixed=TRUE)` matching
4. Set `colData(pe)$condition <- factor(conditions)`
5. If batch_column configured: assign batch, set `colData(pe)$batch <- factor(batch)`
6. Build formula: `~ 0 + condition` or `~ 0 + condition + batch`
7. Call `msqrob(object=pe, i="protein", formula=formula, robust=TRUE, maxitRob=10)`
   (pass `ridge=TRUE` if msqrob2_ridge configured)
8. For each comparison:
   a. Extract condition values from group1 and group2
   b. Build contrast string: `"condX - condY = 0"`
   c. `L <- makeContrast(contrast_string, c(paramX, paramY))`
   d. `pe <- hypothesisTest(pe, i="protein", contrast=L, adjust.method=adjust_method, overwrite=TRUE)`
   e. Extract: `results <- rowData(pe[["protein"]])[["condX - condY"]]`
   f. Map columns: `logFC → logFC, pval → pval, adjPval → adjPval, se → se, df → df`
   g. Add `Master_Protein_Accessions <- rownames(results)`
   h. Add `Gene_Name` and `PSM_Count` from rowData
   i. Re-add zero-variance proteins (logFC=0, pval=NA, adjPval=NA, se=NA, df=NA)
   j. Write `Diff_Expression_{label}.tsv` with columns in standard order

## Batch Correction

- Step 3: `removeBatchEffect(protein_matrix, batch, design)` applied for
  visualization — saves corrected matrix as `"proteinBatchCorrected"` assay
- Step 4: batch included in formula: `~ 0 + condition + batch`. This is the
  statistically correct approach — batch is a covariate in the linear model.

## Config Field Mapping

| Config field | New behavior |
|-------------|-------------|
| `remove_razor` | Passed to R: overlapping protein group filter + contaminant/reverse removal |
| `strict_filtering` | Passed to R: `filterFeatures(pe, ~ nNonZero >= 2)` vs `>= 1` |
| `msqrob2_normalization` | Unchanged: `normalize(pe, method=...)` |
| `msqrob2_imputation` | Unchanged: `impute(pe, method=...)` |
| `msqrob2_aggregation` | Unchanged: `aggregateFeatures(pe, fun=...)` |
| `msqrob2_model` | **Removed.** `msqrob()` replaces `msqrobLm`; no msqrobGlm equivalent |
| `msqrob2_robust` | **No-op.** `msqrob(..., robust=TRUE)` is the default |
| `msqrob2_ridge` | `msqrob(..., ridge=TRUE)` (new: pass `maxitRob=10` to match old behavior) |
| `msqrob2_adjust_method` | `hypothesisTest(..., adjust.method="BH")` — verified works |
| `msqrob2_batch_column` | Formula covariate in step 4 + `removeBatchEffect()` in step 3 |
| `msqrob2_n_cores` | BiocParallel registration before msqrob() call |
| `msqrob2_min_peptides` | Unchanged: filter in step 3 after aggregation |
| `pvalue_threshold` | Unchanged: QC step sig-protein counting |
| `logfc_threshold` | Unchanged: volcano plot filtering |

## MSstats Isolation

MSstats pipeline stays at 8 steps, unchanged. The Python step handlers are
pipeline-aware via the registry. Steps 1-2 handlers are shared;
the msqrob2 pipeline's steps 3-5 are R-based (old Python 3-5 are removed from
the msqrob2 pipeline definition only).

## Files Changed

| File | Change |
|------|--------|
| `backend/app/services/pipeline_registry.py` | Redefine msqrob2 steps: 5 steps |
| `backend/app/models/analysis.py` | Deprecate `msqrob2_model`, note `msqrob2_robust` no-op |
| `backend/app/services/msqrob2_wrapper.py` | Update `_build_data_process_config` + `_build_gc_config` |
| `backend/app/services/steps/combine_replicates.py` | Save `PSM_Combined.parquet`, set `ctx.psm_file_path` |
| `backend/app/services/steps/unique_psm.py` | Load/save parquet with Unique_PSM |
| `backend/app/services/steps/protein_abundance.py` | Update for new step 3: pass parquet from step 2 |
| `backend/app/services/steps/multi_condition_de.py` | Update for new step 4 |
| `backend/app/services/steps/qc_metrics.py` | Update PSM source path |
| `backend/scripts/msqrob2_data_process.R` | Rewrite: full QFeatures pipeline, save QFeatures RDS with colData |
| `backend/scripts/msqrob2_group_comparison_multi.R` | Rewrite: `msqrob()` + `makeContrast()` + `hypothesisTest()` |

## Verification

1. `"C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe"` syntax check both R scripts
2. Backend unit tests: `pytest Tests/backend/unit -v` (107 baseline)
3. Run session `99b2de1b-f049-4730-a7fa-fbd5e08925a3` through the new pipeline
4. Verify all 8 Diff_Expression files are produced with correct columns
5. Frontend build: `cd frontend && npm run build`
6. MSstats pipeline unaffected — run an MSstats session to verify
