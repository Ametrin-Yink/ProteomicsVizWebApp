# msqrob2 Pipeline Rebuild for Multi-Condition Analysis — Design Spec

**Date:** 2026-05-05
**Status:** Approved
**Template:** `MULTI_CONDITION` (msqrob2)

## Summary

Rebuild the `MULTI_CONDITION` pipeline to use msqrob2's native robust statistical methods end-to-end, replacing the current limma-based DE and achieving full operational parity with the MSstats pipeline (RDS checkpointing, heartbeat logging, per-step timeouts, core calibration, automatic retry).

## Decisions

1. **In-place replacement** — overwrite `MULTI_CONDITION`, do not create a third template
2. **Full operational parity** with MSstats — RDS checkpointing, heartbeat, per-step timeouts, core calibration, retry with 2x multiplier
3. **Remove limma code** — delete `msqrob2_de.R`, `msqrob2_de_multi.R`, `msqrob2_protein.R`
4. **Unified comparison format** — both pipelines accept `{group1: {Condition: "X"}, group2: {Condition: "Y"}}` (already what the frontend generates)

## File Manifest

### Create

| File | Purpose |
|------|---------|
| `backend/scripts/msqrob2_data_process.R` | Step 6: QFeatures preprocessing + protein aggregation + RDS save |
| `backend/scripts/msqrob2_group_comparison_multi.R` | Step 7: msqrob2-native DE from RDS checkpoint |

### Rewrite (major)

| File | Change |
|------|--------|
| `backend/app/services/msqrob2_wrapper.py` | Full refactor: `data_process()`, `group_comparison_multi()`, heartbeat, core calibration, per-step timeouts, RDS support |

### Update (moderate)

| File | Change |
|------|--------|
| `backend/app/services/steps/protein_abundance.py` | Call `data_process()`, add RDS checkpointing |
| `backend/app/services/steps/multi_condition_de.py` | Call `group_comparison_multi()`, load from RDS |
| `backend/app/services/steps/__init__.py` | Update exports if handler names change |
| `backend/app/services/pipeline_registry.py` | Update step display names, handler references |
| `backend/app/core/config.py` | Add `r_msqrob2_data_process_timeout`, `r_msqrob2_group_comparison_timeout` |
| `backend/app/models/analysis.py` | Add msqrob2-specific config fields |
| `frontend/src/types/processing.ts` | Update `PROCESSING_STEPS[6-7]` descriptions |
| `frontend/src/stores/processing-store.ts` | Update `package`/`function` strings for msqrob2 path |
| `frontend/src/app/new/config/page.tsx` | Add msqrob2-specific parameter controls |

### Delete

| File | Reason |
|------|--------|
| `backend/scripts/msqrob2_protein.R` | Replaced by `msqrob2_data_process.R` |
| `backend/scripts/msqrob2_de_multi.R` | Replaced by `msqrob2_group_comparison_multi.R` |
| `backend/scripts/msqrob2_de.R` | Legacy single-comparison, superseded |

### Not Touched

Steps 1-5 (DataProcessor), Steps 8-9 (QC, GSEA), entire MSstats path, frontend wizard flow, StepTracker, LogPanel, WebSocket protocol, API routes.

---

## R Script Design

### Step 6: `msqrob2_data_process.R`

```
Usage: Rscript msqrob2_data_process.R <input_file> <output_file> <rds_output> <gene_mapping_file> <config_json>

Input:  PSM_Abundances.{tsv|parquet} (from Step 5)
Output: Protein_Abundances.tsv (wide, log2 scale)
        MSqRob2_Processed.rds (checkpoint: protein matrix, col_data, rowData,
                               normalization coefficients, gene mapping, PSM counts)
```

Processing steps:
1. Read PSM data (auto-detect TSV/Parquet), filter empty accessions, remove all-NA proteins
2. Reshape long→wide via `dcast` if `Sample_Origination` column present; convert zeros to NA (missing observations, not true zero abundance)
3. Create `QFeatures` object via `readQFeatures()`
4. `logTransform(base=2)` — log base configurable from config_json
5. Normalize via `QFeatures::normalize(method=<config>)` — options: `center.median`, `center.mean`, `quantiles`, `quantiles.robust`, `vsn`, `div.median`, `none`
6. Impute via `QFeatures::impute(method=<config>)` conditional on config — options: `knn`, `bpca`, `MinDet`, `MinProb`, `QRILC`, `MLE`, `none`
7. Aggregate via `aggregateFeatures(fun=<config>)` — options: `robustSummary` (MAD-based, default), `medianPolish`, `sum`, `mean`. Uses `SnowParam` with calibrated worker count; falls back to `SerialParam` on failure
8. Gene mapping: UniProt `Entry` → `Gene.Names`, isoform suffix stripping, multi-ID semicolon handling
9. Write `Protein_Abundances.tsv` — columns: `Master_Protein_Accessions`, `Gene_Name`, `PSM_Count`, then sample abundance columns (log2 scale)
10. Save `MSqRob2_Processed.rds` containing: `list(protein_matrix, col_data, peptide_assay, protein_assay, gene_names, psm_counts, norm_coefficients)`

Condition assignment: match sample column names against all Condition values from comparisons, sorted by length descending to avoid substring mismatches (e.g., `DrugLow` before `Drug`). Use `fixed=TRUE` in `grepl()` to avoid regex injection.

### Step 7: `msqrob2_group_comparison_multi.R`

```
Usage: Rscript msqrob2_group_comparison_multi.R <rds_file> <output_dir> <comparisons_json> <gene_mapping_file> <config_json>

Input:  MSqRob2_Processed.rds (from Step 6)
Output: Diff_Expression_{group1Label}_vs_{group2Label}.tsv (per comparison)
```

Processing steps:
1. Load RDS, extract protein matrix and col_data
2. Parse comparisons in unified `[{group1: {Condition: "X"}, group2: {Condition: "Y"}}]` format
3. Extract Condition values from each group dict; for msqrob2 the primary matching key is `Condition`. If multiple keys exist in a group, concatenate values with `+` for labeling
4. Collect all unique condition names, sort by length descending
5. Assign condition to each sample column via `grepl(cond, sample, fixed=TRUE)`, build `col_data$condition` factor
6. Verify all conditions found, warn if any condition has <2 replicates
7. Pre-filter zero-variance proteins (variance < 1e-10), store IDs for re-adding
8. Build design matrix: `~ 0 + condition` (one column per condition, no intercept)
9. Fit model: `msqrobLm(protein_matrix, design, robust=<config>, maxitRob=5)` — robust M-estimation with Huber weights. Alternatively `msqrobGlm()` for count-like data. Ridge penalty configurable.
10. For each comparison: `makeContrast(c(treat=1, ctrl=-1), parameterNames=colnames(design))`
11. `hypothesisTest(model, contrast)` — empirical Bayes moderation
12. `topFeatures(model, contrast, adjust.method=<config>, sort=TRUE)` — options: `BH`, `bonferroni`, `holm`, `BY`, `fdr`
13. Map column names to frontend contract (see Output Column Contract below)
14. Re-add zero-variance proteins with `logFC=0, pval=NA, adjPval=NA, se=NA, df=NA`
15. Write per-comparison TSV

#### Output Column Contract

Must match existing frontend expectations exactly:

| Column | Type | Source |
|--------|------|--------|
| `Master_Protein_Accessions` | str | Protein IDs from Step 6 |
| `Gene_Name` | str | Gene mapping from Step 6 |
| `PSM_Count` | int | From Step 6 |
| `logFC` | float | `topFeatures()` log2 fold change estimate |
| `pval` | float | `hypothesisTest()` raw p-value |
| `adjPval` | float | Multiple-testing adjusted p-value |
| `se` | float | Standard error of logFC |
| `df` | float | Degrees of freedom |

Frontend reads `adjPval`, `logFC`, `Master_Protein_Accessions`, `Gene_Name` — these column names must not change.

---

## Python Wrapper: `Msqrob2Wrapper`

Follows the `MsstatsWrapper` pattern exactly:

```python
class Msqrob2Wrapper:
    _optimal_ncores: int | None    # cached calibration result

    async def _run_r_script(cmd, script_path, log_callback, timeout):
        # subprocess.Popen with daemon stdout/stderr threads
        # heartbeat thread (60s intervals, "Still working... (Ns elapsed)")
        # await asyncio.to_thread(process.wait, timeout=effective_timeout)
        # on timeout: process.kill(), process.wait() to reap zombie

    async def _calibrate_ncores(input_file) -> int:
        # Benchmark SnowParam on 100K-row slice at [1, 4, 8, 16, 32] workers
        # Run aggregation with each count, pick fastest
        # Cache result in self._optimal_ncores

    async def data_process(input_file, output_file, rds_output,
                           gene_mapping_file=None, config=None,
                           log_callback=None, timeout=None,
                           timeout_multiplier=1) -> Path:
        # Build config JSON from msqrob2 fields
        # Calibrate n_cores if not overridden
        # Invoke: Rscript msqrob2_data_process.R <input> <output> <rds> <gene_map> <config_json>
        # Timeout: settings.r_msqrob2_data_process_timeout * timeout_multiplier

    async def group_comparison_multi(rds_file, output_dir, comparisons,
                                     gene_mapping_file=None, log_callback=None,
                                     timeout=None, timeout_multiplier=1) -> Path:
        # Build config JSON for DE parameters
        # Invoke: Rscript msqrob2_group_comparison_multi.R <rds> <output_dir> <comparisons_json> <gene_map> <config_json>
        # Timeout: settings.r_msqrob2_group_comparison_timeout * timeout_multiplier
```

Key differences from old wrapper:
- `_run_r_script` gains heartbeat thread (copied from MsstatsWrapper)
- `_run_r_script` accepts per-call `timeout` parameter instead of using `self.timeout`
- New methods `data_process` and `group_comparison_multi` replace `step6_protein_abundance`, `step7_differential_expression`, `step7_differential_expression_multi`
- `_calibrate_ncores` added (copied pattern from MsstatsWrapper but benchmarks msqrob2 aggregation)

---

## Configuration

### New in `config.py`

```python
r_msqrob2_data_process_timeout: int = Field(default=7200, ge=30, le=28800)
r_msqrob2_group_comparison_timeout: int = Field(default=3600, ge=30, le=14400)
```

### New in `AnalysisConfig` (models/analysis.py)

```python
# msqrob2-specific parameters
msqrob2_normalization: str = Field(default="center.median")
msqrob2_imputation: str = Field(default="none")
msqrob2_aggregation: str = Field(default="robustSummary")
msqrob2_model: str = Field(default="msqrobLm")
msqrob2_robust: bool = Field(default=True)
msqrob2_ridge: bool = Field(default=False)
msqrob2_adjust_method: str = Field(default="BH")
msqrob2_min_peptides: int = Field(default=1, ge=1, le=10)
msqrob2_n_cores: int = Field(default=32, ge=1)
```

These mirror the MSstats parameter set in structure but are msqrob2/QFeatures-specific in values — just like `msstats_normalization`, `msstats_summary_method`, etc. are MSstats-specific.

---

## Step Handlers

### `protein_abundance.py` — `step_protein_abundance_msqrob2`

- Input: PSM file from `get_psm_input(ctx)`
- Output: `Protein_Abundances.tsv` + `MSqRob2_Processed.rds`
- **Checkpoint:** if RDS exists and is newer than PSM input, skip re-processing and read existing TSV
- Calls `msqrob2_wrapper.data_process(...)` with `timeout_multiplier=ctx.timeout_multiplier`
- Sets `ctx.result.protein_abundances_path`, `ctx.result.total_proteins`, `ctx.step_outputs[6]`

### `multi_condition_de.py` — `step_multi_condition_de`

- Input: `MSqRob2_Processed.rds` (fails if missing — Step 6 must complete first)
- Output: `Diff_Expression_{label}.tsv` per comparison
- Reads comparisons from `ctx.config.comparisons` (unified `{group1, group2}` format)
- No fallback to `treatment`/`control` — comparison list is authoritative
- Calls `msqrob2_wrapper.group_comparison_multi(...)` with `timeout_multiplier=ctx.timeout_multiplier`
- Counts significant proteins (adjPval < threshold) across all output files
- Sets `ctx.result.diff_expression_path`, `ctx.result.significant_proteins`, `ctx.step_outputs[7]`

---

## Pipeline Registry

Step 6 display name: `"Protein Abundance (msqrob2/QFeatures)"`
Step 7 display name: `"Differential Expression (msqrob2)"` — unchanged from current
Handler references updated to new wrapper method calls.

---

## Frontend Changes

### `PROCESSING_STEPS` (processing.ts)

Steps 6-7 descriptions updated:
```typescript
{ id: 6, name: 'Calculate Protein Abundance',
  description: 'Normalize, impute, and aggregate peptides to proteins via QFeatures',
  package: '', function: '' },
{ id: 7, name: 'Differential Expression Analysis',
  description: 'Robust statistical testing via msqrob2 (M-estimation with empirical Bayes)',
  package: '', function: '' },
```

### `processing-store.ts` — patch strings

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

### Config Page (`config/page.tsx`)

When `selectedPipeline === 'msqrob2'`, show msqrob2-specific controls instead of MSstats controls:

| Control | Type | Options |
|---------|------|---------|
| Normalization | Select | center.median, center.mean, quantiles, quantiles.robust, vsn, div.median, none |
| Imputation | Select | none, knn, bpca, MinDet, MinProb, QRILC, MLE |
| Aggregation | Select | robustSummary, medianPolish, sum, mean |
| DE Model | Select | msqrobLm, msqrobGlm |
| Robust estimation | Toggle | true/false |
| Ridge penalty | Toggle | true/false |
| Multiple testing | Select | BH, bonferroni, holm, BY, fdr |

Same layout pattern as the existing MSstats config section. The pipeline badge already shows "msqrob2 Pipeline" based on `selectedPipeline`.

### Unified Comparison Format

Both pipelines now accept the same format — no frontend change needed since it already generates `{group1, group2}` for all pipelines:

```typescript
interface Comparison {
  group1: Record<string, string>;  // e.g., { Condition: "Drug" }
  group2: Record<string, string>;  // e.g., { Condition: "DMSO" }
}
```

The msqrob2 R script extracts `group1["Condition"]` and `group2["Condition"]` for treatment/control labeling. If a group has multiple keys, values are concatenated with `+` for the output filename.

---

## Data Flow

```
Upload: PSM_*.csv × N files
  ↓
Steps 1-5: Python DataProcessor (unchanged)
  ↓  PSM_Abundances.parquet
Step 6: msqrob2_data_process.R
  ├─ Read PSM → QFeatures
  ├─ logTransform → normalize → impute → aggregateFeatures
  ├─ Output: Protein_Abundances.tsv (proteins × samples, log2 scale)
  └─ Output: MSqRob2_Processed.rds (checkpoint for Step 7)
  ↓  MSqRob2_Processed.rds
Step 7: msqrob2_group_comparison_multi.R
  ├─ Load RDS, extract protein matrix + col_data
  ├─ Build design matrix: ~ 0 + condition
  ├─ msqrobLm(protein_matrix, design, robust=TRUE)
  ├─ makeContrast + hypothesisTest → topFeatures → per comparison
  └─ Output: Diff_Expression_{A}_vs_{B}.tsv × M comparisons
  ↓
Steps 8-9: QC + GSEA (unchanged)
```

---

## Test Plan

| Layer | What to Test |
|-------|-------------|
| **R script integration** | Run both R scripts against fixture PSM data; verify TSV column names match contract; verify RDS round-trips correctly; verify msqrobLm outputs match expected structure |
| **Msqrob2Wrapper** | `data_process()` succeeds with fixture data; `group_comparison_multi()` succeeds; timeout triggers retry with 2x multiplier; heartbeat logs appear every 60s; RDS checkpoint skips re-processing; core calibration runs and caches result |
| **Step handlers** | `step_protein_abundance_msqrob2` correctly reads/writes StepContext fields; `step_multi_condition_de` correctly counts significant proteins from all comparison files |
| **Pipeline engine** | Full 9-step msqrob2 pipeline completes end-to-end; retry from failed step works; cancellation between steps works |
| **Config** | msqrob2 config fields validate, serialize to JSON correctly, flow through wrapper to R script |
| **Frontend E2E** | `01-new-analysis-wizard.spec.ts` msqrob2 happy path still passes (pipeline selection → processing → results); config page shows correct parameter controls per pipeline selection |
| **MSstats regression** | All existing MSstats tests unchanged and still passing |
| **Legacy cleanup** | Verify deleted R scripts are not referenced anywhere; `msqrob2_de.R` single-comparison fallback removed cleanly |

---

## Architectural Constraints (Red Lines)

- **NEVER rpy2** — all R integration via `subprocess.Popen` with streaming output
- **UTF-8 encoding** with latin-1 fallback for R subprocess output
- **Output column names must not change** — `Master_Protein_Accessions`, `Gene_Name`, `logFC`, `pval`, `adjPval`, `se`, `df` are the frontend contract
- **Step numbering (1-9) unchanged** — all frontend components reference steps by ID
- **MSstats path untouched** — no changes to `msstats_wrapper.py`, MSstats R scripts, or MSstats step handlers
- **Use `fixed=TRUE` in `grepl()`** when matching user-provided condition names to avoid regex injection
- **All tests in `Tests/` directory** — no test files elsewhere
