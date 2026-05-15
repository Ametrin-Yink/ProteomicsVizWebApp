# 08 - Processing Pipeline

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered in `pipeline_registry.py`. Two statistical pipelines are available, selected via `PipelineTool`:

- **msqrob2** (default, 5 steps): Consolidated QFeatures-native pipeline using msqrob2 v1.16 API. Python preprocessing (razor, quality, filter) is handled inside the R QFeatures pipeline.
- **MSstats** (8 steps): R/MSstats for protein abundance and DE. Steps 1-5 are Python preprocessing, steps 6-7 are R, step 8 is QC.

Both share steps 1-2 (Python: combine replicates, generate Unique PSM). GSEA, BioNet, and Compare are on-demand — triggered from visualization/compare routes, not pipeline steps.

## msqrob2 Pipeline (5 steps)

```
Step 1 (Python): combine_replicates → PSM_Combined.parquet
Step 2 (Python): generate_unique_psm → re-save with Unique_PSM
Step 3 (R):      protein_abundance → QFeatures pipeline (filter, log2, normalize, impute,
                  aggregate, gene map, batch correct) → QFeatures RDS + Protein_Abundances.tsv
Step 4 (R):      differential_expression → msqrob() + makeContrast() + hypothesisTest()
                  for N contrasts → Diff_Expression_*.tsv
Step 5 (Python): qc_metrics → QC_Results.json
```

### Key details (msqrob2)

- **Step 3 R script** (`msqrob2_data_process.R`): Reads `PSM_Combined.parquet`, runs full QFeatures preprocessing. `remove_razor` controls contaminant/reverse/overlapping-group filtering. `strict_filtering` controls min observations per peptide (2 vs 1). Sets `colData(pe)$sample` for step 4 formula validation. Saves full QFeatures object (not flat list) as `MSqRob2_Processed.rds`.
- **Step 4 R script** (`msqrob2_group_comparison_multi.R`): Uses msqrob2 v1.16 API. Assigns conditions from metadata entries (combined strings like `"Jurkat_INCB224525_24h"` with underscore separator). `msqrob(object=pe, i="protein", formula=~0+condition[+batch], robust=TRUE, maxitRob=10)`. Contrasts built via `makeContrast()`, tested via `hypothesisTest(pe, i="protein", contrast=L, adjust.method="BH", overwrite=TRUE)`. Results extracted from `rowData(pe[["protein"]])`. Zero-variance proteins overwritten with NA values (not appended).
- **Step 5 QC handler** (`qc_metrics_msqrob2.py`): Separate from MSstats QC handler (uses `ctx.step_outputs[5]` vs `[8]`).
- **Batch correction**: `removeBatchEffect()` in step 3 for visualization; batch as formula covariate in step 4 for proper DE.

## MSstats Pipeline (8 steps, unchanged)

```
Steps 1-2: Python (shared with msqrob2)
Steps 3-5: Python preprocessing (remove_razor, remove_low_quality, filter_criteria)
Step 6:    R (MSstats dataProcess) → Protein_Abundances.tsv
Step 7:    R (MSstats groupComparison) → Diff_Expression_*.tsv
Step 8:    Python (QC metrics) → QC_Results.json
```

## Architecture

**Pipeline Engine** (`pipeline_engine.py`):
- `PipelineDefinition` — ordered list of `PipelineStep` objects keyed by `PipelineTool`
- `StepContext` — mutable context passed through all steps (config, session_id, file_paths, df, psm_file_path, cancel event)
- `PipelineEngine.run()` — iterates steps, handles cancellation, saves state after each step

**Step Handlers** (`services/steps/`):
- Each step is a separate file exporting an async handler function
- Steps 1-2 use `DataProcessor` methods; msqrob2 steps 3-4 call R via `Msqrob2Wrapper`; MSstats steps 6-7 call R via `MsstatsWrapper`
- `_helpers.py` provides shared utilities (gene mapping, PSM input validation, log callbacks)
- `get_psm_input(ctx, step=5)` — parameterized step number for error messages

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
  "outputs": {}
}
```

## Config Flow

SessionConfig (API) → `_CONFIG_FORWARD_FIELDS` + metadata mapping → AnalysisConfig (pipeline). The `msqrob2_batch_column` field must be in `_CONFIG_FORWARD_FIELDS` to flow from SessionConfig to AnalysisConfig.

## Recovery

Failed steps can be retried from the point of failure. Pipeline state is saved after each completed step, allowing resume after server restart. The retry endpoint clears error state and re-runs the pipeline.
