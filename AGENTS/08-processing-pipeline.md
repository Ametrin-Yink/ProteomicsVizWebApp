# 08 - Processing Pipeline

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered in `pipeline_registry.py`. Both pipelines are 8-step symmetric:

- **msqrob2** (DIA): QFeatures-native pipeline using msqrob2 v1.16 API. Steps 1-5 Python, steps 6-7 R, step 8 Python.
- **MSstats** (TMT): R/MSstats for protein abundance and DE. Steps 1-5 Python, steps 6-7 R, step 8 Python.

GSEA, BioNet, and Compare are on-demand — triggered from visualization/compare routes, not pipeline steps.

## DIA Optimized Path (msqrob2)

When `use_duckdb_streaming=true` (default) and `duckdb` is installed:

- **Steps 1-2** are merged into a single streaming DuckDB query: `read_csv(all files) → JOIN metadata → Unique_PSM → filter contaminants/Quan_Info/Abundance<1 → COPY TO parquet`. Peak memory <500MB. Sets `ctx.df = None` to signal chunked path.
- **Steps 3-5** use chunked Parquet I/O (100K-row batches via `pyarrow.parquet.ParquetFile.iter_batches()`). Step 3 (razor) is two-pass: scan for protein-peptide counts, then apply selection. Step 4 is single-pass row-level filters. Step 5 is two-pass: compute missing-value thresholds, then filter.
- Falls back to pandas path when DuckDB unavailable or disabled.

### Key details (msqrob2)

- **Step 6 R script** (`msqrob2_data_process.R`): Reads `PSM_Abundances.parquet`, runs full QFeatures preprocessing. After aggregation, removes peptide-level assays (`removeAssay()`) to free ~50% R memory. Controlled by `keep_intermediate_assays` config (default false).
- **Step 7 R script** (`msqrob2_group_comparison_multi.R`): Uses msqrob2 v1.16 API. When comparisons exceed `msqrob2_batch_size` (default 10), splits across parallel R subprocesses. Each batch loads a pre-fitted QFeatures RDS, skips `msqrob()` model fitting, and runs only `makeContrast()` + `hypothesisTest()`. Supports optional `label` field per comparison for custom file naming.
- **Ridge regression**: `msqrob2_ridge` defaults to `False`. Ridge requires 5+ replicates — with 3 replicates it causes `lme4` boundary singular fits and returns all-NA.
- **PCA edge case**: QC calculator handles n_features < 2 after NaN removal (returns empty PCA result instead of crashing).

## MSstats Pipeline (8 steps)

```
Steps 1-2: Python (combine_replicates, unique_psm) — keeps ctx.df alive for steps 3-5
Steps 3-5: Python preprocessing (remove_razor, remove_low_quality, filter_criteria)
Step 6:    R (MSstats dataProcess) → Protein_Abundances.tsv
Step 7:    R (MSstats groupComparison) → Diff_Expression_*.tsv — supports batched execution
Step 8:    Python (QC metrics) → QC_Results.json
```

## Architecture

**Pipeline Engine** (`pipeline_engine.py`):
- `PipelineDefinition` — ordered list of `PipelineStep` objects keyed by `PipelineTool`
- `StepContext` — mutable context passed through all steps. After DuckDB streaming, `ctx.df = None` signals chunked I/O path for Steps 3-5.
- `PipelineEngine.run()` — iterates steps, handles cancellation, saves state after each step. Records `step_timings` and `step_memory` in `pipeline_state.json` for profiling.

**Step Handlers** (`services/steps/`):
- Steps 1-2 for DIA: DuckDB streaming path calls `DataProcessor.step1_2_duckdb_dia()` then sets `ctx.df = None`. Pandas fallback uses `step1_combine_replicates_dia()` + `step2_generate_unique_psm()` with in-memory DataFrame.
- Steps 3-5: Each handler checks `ctx.df is None` → uses chunked Parquet I/O from `ctx.psm_file_path`. When `ctx.df` is populated → uses existing pandas in-memory path (backward compat).
- Steps 6-7: R scripts via `Msqrob2Wrapper`. Step 7 supports batched mode via `group_comparison_batched()`.

**DuckDB DataProcessor** (`data_processor.py`):
- `step1_2_duckdb_dia()` — streaming CSV→Parquet via DuckDB SQL. Builds in-memory metadata table, JOINs on filename basename, applies filters, writes Parquet with zstd.
- `step3_remove_razor_chunked()` — two-pass: (1) scan protein-peptide counts, (2) apply best-protein selection per chunk
- `step4_remove_low_quality_chunked()` — single-pass row-level filter
- `step5_filter_by_criteria_chunked()` — two-pass: (1) compute per-condition replicate sets + passing PSM IDs, (2) filter chunks. Uses `defaultdict(set)` for replicate accumulation (not `max(nunique())` — would undercount across row groups).

**Task Manager** (`task_manager.py`):
- Isolates long-running computations into dedicated thread pools per `TaskKind` (PIPELINE, GSEA, BIONET, COMPUTE, LIGHT)
- Prevents pipeline steps from starving the default asyncio executor
- Handles queuing: sessions wait in queue when all pipeline workers are busy

## State Management

Pipeline state persisted to `sessions/{session_id}/pipeline_state.json`:
```json
{
  "current_step": 0,
  "completed_steps": [],
  "failed_step": null,
  "error": null,
  "outputs": {},
  "step_timings": {},
  "step_memory": {}
}
```

## Config Flow

SessionConfig (API) → `config_forward_fields` + metadata mapping → AnalysisConfig (pipeline).

**Critical:** New msqrob2 fields must be added to BOTH `SessionConfig` (API model) AND `config_forward_fields` (processing.py). If a field exists in `AnalysisConfig` but not in `SessionConfig`, `hasattr(sc, field)` returns `False` and the field is silently dropped — the API ignores the user's setting and uses the AnalysisConfig default. This caused the "0 proteins" bug: `msqrob2_ridge` was changed to default `True` but `SessionConfig` lacked the field, so every run used ridge regardless of the user's config.

## Recovery

Failed steps can be retried from the point of failure. Pipeline state is saved after each completed step, allowing resume after server restart. The retry endpoint clears error state and re-runs the pipeline.
