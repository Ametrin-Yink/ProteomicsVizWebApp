# 08 - Processing Pipeline (8 Steps)

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered in `pipeline_registry.py`. Two statistical pipelines are available, selected via `PipelineTool`:

- **msqrob2** (default): R/msqrob2 + QFeatures for protein abundance and DE
- **MSstats**: R/MSstats for protein abundance and DE (fully wired)

Both share steps 1-5 (Python preprocessing) and step 8 (QC metrics). GSEA, BioNet, and Compare are on-demand — triggered from visualization/compare routes, not pipeline steps.

```
Input: PSM CSV Files → Steps 1-8 → Output: DE Results, QC Plots
                               └── On-demand: GSEA, BioNet, Compare
```

| Step | Description | Package | Output |
|------|-------------|---------|--------|
| 1 | Combine Replicates | Python/Pandas | `PSM_Abundances.tsv` |
| 2 | Generate Unique PSM | Python/Pandas | (in place) |
| 3 | Remove Razor (optional) | Python | (in place) |
| 4 | Remove Low Quality | Python/Pandas | (in place) |
| 5 | Filter by Criteria | Python/Pandas | saves PSM to Parquet/TSV |
| 6 | Protein Abundance | R (msqrob2 or MSstats) | `Protein_Abundances.tsv` |
| 7 | Differential Expression | R (msqrob2 or MSstats) | `Diff_Expression.tsv` |
| 8 | QC Metrics | Python/sklearn PCA | `QC_Results.json` |

## Architecture

**Pipeline Engine** (`pipeline_engine.py`):
- `PipelineDefinition` — ordered list of `PipelineStep` objects keyed by `PipelineTool`
- `StepContext` — mutable context passed through all steps (config, session_id, file_paths, df, cancel event)
- `PipelineEngine.run()` — iterates steps, handles cancellation, saves state after each step

**Step Handlers** (`services/steps/`):
- Each step is a separate file exporting an async handler function
- Steps 1-5 use `DataProcessor` methods, Steps 6-7 call R via `base_r_wrapper.py` subclasses, Step 8 is pure Python
- `_helpers.py` provides shared utilities (gene mapping, PSM input validation, log callbacks)

**Task Manager** (`task_manager.py`):
- Isolates long-running computations into dedicated thread pools per `TaskKind` (PIPELINE, GSEA, BIONET, COMPUTE, LIGHT)
- Prevents pipeline steps from starving the default asyncio executor
- Handles queuing: sessions wait in queue when all pipeline workers are busy

## Key Details

### Steps 1-5 (Python/Pandas)
- Combine uploaded CSVs, extract abundance columns, filter contaminants and low-quality PSMs
- Strict filtering: 20% missing value threshold, remove proteins with only 1 PSM
- Lenient filtering: 40% missing value threshold

### Steps 6-7 (R — msqrob2 or MSstats)
- R integration via subprocess, never rpy2
- `base_r_wrapper.py` provides Template Method pattern shared by `Msqrob2Wrapper` and `MsstatsWrapper`
- Step 6 aggregates peptide-level data to protein-level
- Step 7 handles N conditions with M arbitrary contrasts
- Pipeline selected via `PipelineTool` enum, passed to `AnalysisConfig.pipeline`

### Step 8 (QC)
- PCA on protein abundances (sklearn)
- P-value distribution, CV metrics, intensity distributions, data completeness

## On-Demand Analysis

These are triggered from visualization/compare routes AFTER the pipeline completes:

| Feature | Trigger | Service | Route |
|---------|---------|---------|-------|
| GSEA | POST per-comparison | `gsea_service.py` + `gsea_cache_service.py` | `/api/sessions/{id}/gsea/run` |
| BioNet | Manual invocation | `bionet_service.py` + `bionet_network.R` | (visualization) |
| Compare | POST protein/matrix/venn | `compare_service.py` | `/api/sessions/{id}/compare/*` |

GSEA caches results by input data hash via `gsea_cache_service.py`. Five databases: GO BP/MF/CC, KEGG, Reactome.

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

## Recovery

Failed steps can be retried from the point of failure. Pipeline state is saved after each completed step, allowing resume after server restart.
