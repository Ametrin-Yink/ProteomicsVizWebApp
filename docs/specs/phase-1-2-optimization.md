# Phase 1 & 2 Performance Optimization — Specification

> **Status**: Draft v2 (flaw review complete) | **Date**: 2026-07-09 | **Branch**: `perf/optimize-pipeline`
>
> Based on [Phase 0 profiling results](../superpowers/plans/create-a-new-branch-delightful-clock.md):
> - R steps dominate at 95.5% of pipeline runtime
> - Step 7 (DE) runs 10K comparisons serially: ~10.3 hours on real data (8,336 proteins)
> - Python steps are 4% of runtime — not a bottleneck
> - Current architecture cannot load 1TB+ of DIA data into RAM

---

## Phase 1: Streaming DIA Pre-Processing

### Problem

`step1_combine_replicates_dia()` loads every DIA file into a pandas DataFrame, accumulates all in a Python list, then calls `pd.concat()`. At 20K files × ~50MB each = 1TB, peak memory exceeds 2TB (list of DataFrames + concatenated result). This is a **correctness blocker**: the pipeline cannot run at the target scale on any machine with ≤512GB RAM.

A naive fix that replaces only Step 1 with DuckDB streaming fails because Steps 2-5 read `ctx.df` — the in-memory DataFrame populated by Step 1. Writing to Parquet from DuckDB then loading it back into `ctx.df` brings the full dataset back into RAM (100-200GB compressed), defeating the streaming benefit.

**Therefore Phase 1 must include Steps 1-2 in the streaming query, and Steps 3-5 must read from Parquet in chunked mode.**

### Requirements

**R1 — Streaming CSV-to-Parquet for Steps 1-2.** Steps 1 and 2 are combined into a single streaming DuckDB query that:
- Reads all DIA CSV files as a virtual table
- Applies per-file metadata (condition, replicate, Sample_Origination)
- Adds the `Unique_PSM` column (`Sequence || '|' || Modifications || '|' || Charge`)
- Applies contaminant filter (`Contaminant != 'True'`)
- Removes rows where Quan_Info indicates no value
- Removes rows where Abundance < 1
- Renames "Quan Value" → "Abundance" (with the dual-column edge case: "Abundance_DIA")
- Renames spaces to underscores in column names
- Writes the result as `PSM_Combined.parquet` (zstd compression)

Peak memory during this query must stay under 4GB regardless of input file count. No intermediate `ctx.df` is created.

**R2 — Steps 3-5 read from Parquet in chunked mode.** After Step 2, `ctx.df` is set to `None`. Steps 3 (remove_razor), 4 (remove_low_quality), and 5 (filter_criteria) each:
- Read `PSM_Combined.parquet` in chunks using `pyarrow.parquet.ParquetFile.iter_batches()` or `pd.read_parquet(chunksize=...)`
- Apply their transformation to each chunk
- Write the transformed chunks to a new Parquet file (overwriting the previous)
- Do NOT hold the full DataFrame in memory at any point

Step 5 writes the final `PSM_Abundances.parquet` and remains responsible for freeing memory.

**R3 — Metadata join preserved.** Each row must be annotated with `Condition`, `Replicate`, `Sample_Origination`, and any condition group columns from the per-file metadata. The output schema must be identical to the current implementation for the same inputs.

Metadata matching uses DuckDB: the metadata dict is converted to a DuckDB in-memory table keyed by exact filename. DuckDB's `read_csv` `filename` column extracts the basename, which is joined against the metadata table. The sanitization logic (currently bidirectional filename/stem matching) is reduced to exact filename matching — which is more correct and avoids the need for Python-side sanitization in SQL.

**R4 — Backwards compatible.** For datasets ≤50 files, the DuckDB+chunked path must produce identical output (row count, column names, values) to the current pandas path. The existing 12-file DIA E2E test must pass.

**R5 — Configurable.** A boolean setting (`use_duckdb_streaming`, default `true`) controls whether the DuckDB+chunked path is used. When `false` or when DuckDB is not installed, fall back to the existing pandas implementation (Steps 1-5 unchanged).

**R6 — Cross-platform.** DuckDB has zero system dependencies. The chunked Parquet path uses pyarrow, already a dependency. Must work identically on Windows and Linux.

**R7 — TMT unaffected.** TMT uses `step1_combine_replicates_tmt()` and a different Step 1 handler. No TMT code path changes. Existing TMT tests must continue to pass.

### Non-Requirements

- **NOT**: Collapsing Steps 3-5 into DuckDB SQL. The step structure (razor removal, low quality filter, criteria filter) is preserved as separate pipeline steps. Only Steps 1-2 are merged into one streaming query.
- **NOT**: Changing the metadata format or upload API. Metadata continues to be passed as `metadata_columns: dict[str, dict]` in the session config.
- **NOT**: Optimizing TMT input. Phase 1 is DIA-only.

### Interface Contract (for Phase 2 dependency)

After Phase 1 completes:
- `ctx.df` is `None` (not a DataFrame)
- `ctx.psm_file_path` points to `PSM_Combined.parquet` (after Steps 1-2) and `PSM_Abundances.parquet` (after Step 5)
- `ctx.step_outputs[1]` and `ctx.step_outputs[2]` point to `PSM_Combined.parquet`
- `ctx.step_outputs[5]` points to `PSM_Abundances.parquet`
- The R scripts (Steps 6-7) read from `PSM_Abundances.parquet` on disk — they are unaffected
- Phase 2 development can assume `ctx.df is None` after Phase 1 and design accordingly

### Acceptance Criteria

1. A 500-file DIA dataset processes through Steps 1-5 with peak memory under 4GB, measured via `psutil.Process().memory_info().rss`.
2. For the 12-file DIA E2E test: output `PSM_Combined.parquet` and `PSM_Abundances.parquet` are identical (row count, columns, values) to the pandas path.
3. The full DIA E2E test (upload → pipeline → results) passes.
4. The TMT E2E test passes unchanged.
5. DuckDB is optional: setting `use_duckdb_streaming=false` or missing `duckdb` package falls back to the existing pandas path. Backend starts without DuckDB installed.
6. `duckdb` is listed in `requirements.txt` with a comment marking it as optional.

---

## Phase 2: msqrob2 Differential Expression Optimization

### 2.1 — Batched DE with Pre-fitted Model

#### Problem

`msqrob2_group_comparison_multi.R` runs all comparisons in a serial `for` loop inside a single R process. Phase 0 profiling shows: `time = 661s (model fit + setup) + 3.65s × n (per comparison)` on real data (8,336 proteins). For 10K comparisons, this is ~10.3 hours. Each comparison is independent once the model is fitted — they are embarrassingly parallel.

The initial spec proposed extracting fitted model parameters into a lightweight RDS. This is infeasible: msqrob2 stores model parameters inside the QFeatures rowData, and `hypothesisTest()` requires the full QFeatures object. There is no standalone model serialization API.

**Correct approach**: Two-phase execution where Phase A saves a fitted QFeatures RDS (same size as the original, but with `msqrob()` already run), and Phase B batches load this RDS and skip directly to `makeContrast()` + `hypothesisTest()`.

#### Requirements

**R1 — Two-phase execution.**
- **Phase A (fit once)**: Load QFeatures RDS from Step 6, run `msqrob()`, save the fitted QFeatures as a new RDS (`MSqRob2_Fitted.rds`). This runs in a single R process. On real data, this takes ~11 minutes (model fit + setup).
- **Phase B (test in parallel)**: Split comparisons into batches. Each batch runs in its own R subprocess via `ProcessPoolExecutor`, loading the fitted QFeatures RDS and running `makeContrast()` + `hypothesisTest()` for its subset of comparisons. No batch re-runs `msqrob()`.

**R2 — Batching configuration.** New settings match the existing MSstats batching pattern:
- `msqrob2_batch_size` (default `10`, range `1-50`): comparisons per R subprocess. Upper bound of 50 keeps the comparison JSON under the Windows 32K command-line limit (~900 chars at batch_size=10, ~4,500 at batch_size=50).
- `msqrob2_max_workers` (default `min(cpu_count//2, 32)`, range `1-64`): concurrent R subprocesses.
- `msqrob2_n_cores_cap` (default `32`, range `1-64`): max BiocParallel cores per R subprocess.

**R3 — Automatic fallback.** When `len(comparisons) ≤ batch_size`, use the existing single-process path (no `ProcessPoolExecutor` overhead). The two-phase split (fit-then-test) still applies — the single process just handles all comparisons.

**R4 — Output equivalence.** Batched DE must produce output files whose values match the serial path **within biologically irrelevant tolerance**: p-values and logFC within `1e-6` of serial output. Row counts must be identical. Significance calls (adjPval < 0.05) must agree on ≥99.9% of proteins.

*Rationale for relaxed tolerance: `hypothesisTest()` uses BiocParallel internally. Iterative algorithms produce minor numerical differences under parallelism. The MSstats batching path already accepts this behavior.*

**R5 — Failure isolation.** If one batch fails (non-zero R exit), other batches continue independently. Failed batch errors are collected. After all batches complete, if any failed, raise a combined error listing which batches failed and why. Successful batch outputs are preserved.

**R6 — Timeout per batch.** Each batch R subprocess has a timeout (configurable via `r_msqrob2_group_comparison_timeout`, default 3600s). A timeout kills that batch's subprocess but does not abort other batches.

**R7 — Resource-aware worker count.** Concurrent workers are capped so that `workers × n_cores_per ≤ total_cpu_cores`, where `n_cores_per = max(1, total_cores // workers)` and `total_cores = os.cpu_count()`.

**R8 — RDS I/O mitigation.** The fitted QFeatures RDS may be large (3-10GB). Reading it from disk by N concurrent workers creates I/O contention. The first worker to open the file populates the OS page cache; subsequent workers read from RAM. No explicit I/O coordination is required beyond relying on OS-level caching.

#### Acceptance Criteria

1. A DE run with 100 comparisons, `batch_size=10, max_workers=4` completes in less wall-clock time than the serial path (measured and compared).
2. All 100 `Diff_Expression_*.tsv` files match the serial output: identical row counts, p-value/logFC within `1e-6`.
3. Significance calls agree on ≥99.9% of proteins.
4. A single batch failure (simulated by passing an invalid condition name) does not prevent other batches from completing. The error message lists the failed batch index and reason.
5. The existing DIA E2E test passes (3 comparisons, falls back to single-process path).
6. TMT/MSstats E2E test is unaffected.

---

### 2.2 — QFeatures Memory Hygiene

#### Problem

`msqrob2_data_process.R` creates 4-6 full assay copies inside the QFeatures object: `peptide` (raw), `peptideLog` (log2), `peptideNorm` (normalized), `peptideImputed` (imputed), `protein` (aggregated), `proteinBatchCorrected` (batch-corrected). All are kept in memory simultaneously. For large datasets, peak R memory reaches 4-6× the data size, risking OOM.

Step 7 only needs the `protein` assay (and `proteinBatchCorrected` if batch correction is enabled). All peptide-level assays are unused after aggregation.

#### Requirements

**R1 — Remove peptide-level assays after aggregation.** After `aggregateFeatures()` completes successfully, explicitly remove the following assays from the QFeatures object: `peptide`, `peptideLog`, `peptideNorm`, `peptideImputed`. Use the QFeatures API (`removeAssay()` or equivalent) to properly unregister them from the object's internal tracking. Trigger R garbage collection after removal.

**R2 — Preserve protein-level assays.** The `protein` assay and `proteinBatchCorrected` assay (if batch correction is enabled) must be preserved in the saved RDS. These are required by Step 7.

**R3 — Configurable.** A `keep_intermediate_assays` field in the R config (default `false`) controls this. When `true`, no assays are removed (current behavior). This provides an escape hatch for debugging without requiring a code change.

**R4 — No output change.** Removing peptide-level assays must not affect:
- `Protein_Abundances.tsv` (written before RDS save, so inherently unaffected)
- Normalization coefficients
- The `protein` assay data in the saved RDS
- Step 7's ability to load the RDS and run DE

Step 7 accesses `assay(pe[["protein"]])` and `rowData(pe[["protein"]])`. It does not access peptide-level assays. The saved RDS will be smaller but functionally identical for Step 7.

#### Acceptance Criteria

1. Peak R memory during Step 6, measured via `gc()` output or OS tools, is reduced by ≥30% with `keep_intermediate_assays=false` on a dataset with ≥1,000 proteins.
2. `Protein_Abundances.tsv` is byte-identical regardless of the flag setting.
3. Step 7 loads the RDS saved with `keep_intermediate_assays=false` and produces DE results identical (row counts, p-value/logFC within `1e-6`) to loading a full-assay RDS.
4. The flag defaults to `false`. Setting it to `true` preserves all assays.

---

### 2.3 — Ridge Regression for Many-Condition Designs

#### Problem

The msqrob2 model fitting uses `ridge=FALSE` by default (verified: `analysis.py:169`). For designs with many conditions, the design matrix is poorly conditioned without regularization. The 2025 msqrob2TMT paper (Vandenbulcke et al., *MCP*) demonstrates that ridge regression improves both statistical performance (sensitivity with FDR control) and computational performance (better-conditioned matrices converge faster).

#### Requirements

**R1 — Ridge regression enabled by default.** The `msqrob2_ridge` field in `AnalysisConfig` changes from `default=False` to `default=True`. The `_build_gc_config()` method in `Msqrob2Wrapper` already reads this field and passes it to the R script — no wrapper change needed.

**R2 — Configurable override.** Users may set `msqrob2_ridge: false` in their session config to disable ridge regression.

**R3 — No change for small designs.** For designs with 2-3 conditions, ridge regression produces results nearly identical to non-ridge. The existing DIA E2E test (3 conditions) must continue to pass with ridge enabled.

#### Acceptance Criteria

1. The existing DIA E2E test passes with `msqrob2_ridge=true` (new default).
2. The `AnalysisConfig` model reports `msqrob2_ridge` default as `True`.
3. Setting `msqrob2_ridge: false` restores the pre-Phase-2.3 behavior.

---

## Cross-Cutting Constraints

- **CC1 — TMT regression.** No TMT/MSstats pipeline behavior may change. All existing TMT tests must continue to pass.
- **CC2 — Python version.** Python 3.12+. No PEP 695 generics, no `match`/`case`.
- **CC3 — R version.** R 4.5+, msqrob2 1.16+, QFeatures, BiocParallel. No new R package dependencies for Phase 2.
- **CC4 — New Python dependency.** Phase 1 introduces `duckdb` as an optional dependency. Listed in `requirements.txt` with an `# optional: streaming DIA ingestion` comment. Not imported at module level — imported lazily inside the DuckDB code path.
- **CC5 — Test location.** All tests in `Tests/backend/`. Unit tests in `unit/`, integration tests in `integration/`.
- **CC6 — No rpy2.** R integration is exclusively via subprocess.
- **CC7 — asyncio for blocking I/O.** All file I/O in async context uses `asyncio.to_thread()`.
- **CC8 — No partial DataFrame population.** After Phase 1, `ctx.df` is `None` during Steps 1-2 (DuckDB streaming) and is only populated chunk-by-chunk during Steps 3-5. Code that assumes `ctx.df` is a full DataFrame in these steps must be updated or guarded.

---

## Phase Dependency Map

```
Phase 1 (Streaming DIA) ─── defines ctx.df=None contract ───┐
                                                              │
Phase 2.1 (Batched DE) ─── reads RDS from Step 6 ─── independent of Phase 1
Phase 2.2 (QFeatures mem) ── modifies RDS format ─── Phase 2.1 must handle reduced RDS
Phase 2.3 (Ridge default) ── one-line config change ── independent
```

Phase 2.1 depends on Phase 2.2 only in that the RDS loaded by Phase 2.1 may have fewer assays. Phase 2.1's code (`assay(pe[["protein"]])`) doesn't reference peptide-level assays, so this dependency is non-blocking. Both can be developed in parallel.

Phase 1 is independent of all Phase 2 work. They can be developed in parallel.
