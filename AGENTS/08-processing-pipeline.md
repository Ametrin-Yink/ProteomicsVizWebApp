# 08 - Processing Pipeline (9 Steps)

The pipeline uses a **plugin-based engine** (`pipeline_engine.py`) with step handlers registered in `pipeline_registry.py`. The active template is `MULTI_CONDITION` (`"multi_condition_comparison"`); `TIME_SERIES` is reserved.

```
Input: PSM CSV Files → Steps 1-9 → Output: Results, QC Plots, GSEA
```

| Step | Description | Package | Output |
|------|-------------|---------|--------|
| 1 | Combine Replicates | Python/Pandas | `PSM_Abundances.tsv` |
| 2 | Generate Unique PSM | Python/Pandas | (in place) |
| 3 | Remove Razor (optional) | Python | (in place) |
| 4 | Remove Low Quality | Python/Pandas | (in place) |
| 5 | Filter by Criteria | Python/Pandas | saves PSM to Parquet/TSV |
| 6 | Protein Abundance | R/msqrob2 (`msqrob2_protein.R`) | `Protein_Abundances.tsv` |
| 7 | Differential Expression (multi-condition) | R/msqrob2 (`msqrob2_de_multi.R`) | `Diff_Expression.tsv` |
| 8 | QC Metrics | Python/sklearn PCA | `QC_Results.json` |
| 9 | GSEA Analysis | Python/gseapy `gp.prerank()` | GSEA results (5 databases) |

## Architecture

**Pipeline Engine** (`pipeline_engine.py`):
- `PipelineDefinition` — ordered list of `PipelineStep` objects keyed by template name
- `StepContext` — mutable context passed through all steps (config, session_id, file_paths, df, cancel event)
- `PipelineEngine.run()` — iterates steps, handles cancellation, saves state after each step

**Step Handlers** (`services/steps/`):
- Each step is a separate file exporting an async handler function
- Steps 1-5 use `DataProcessor` methods, Steps 6-7 call R via `msqrob2_wrapper`, Steps 8-9 are pure Python
- `_helpers.py` provides shared utilities (gene mapping, PSM input validation, log callbacks)

**MSstats Alternative Pathway:**
An MSstats-based pipeline exists but is **not wired into any template**:
- `msstats_data_process.R` — protein abundance (alternative to Step 6)
- `msstats_group_comparison_multi.R` — group comparison (alternative to Step 7)
- `group_comparison_multi.py` — combined step handler (unregistered)

## Key Details

### Steps 1-5 (Python/Pandas)
- Combine uploaded CSVs, extract abundance columns, filter contaminants and low-quality PSMs
- Strict filtering: 20% missing value threshold, remove proteins with only 1 PSM
- Lenient filtering: 40% missing value threshold

### Steps 6-7 (R/msqrob2)
- R integration via subprocess, never rpy2
- Step 6 aggregates peptide-level data to protein-level using robust M-estimation (msqrob2)
- Step 7 handles N conditions with M arbitrary contrasts via limma (`msqrob2_de_multi.R`)
- Legacy single-comparison script `msqrob2_de.R` still exists but is not used by the active pipeline

### Step 8 (QC)
- PCA on protein abundances (sklearn)
- P-value distribution, CV metrics, intensity distributions, data completeness

### Step 9 (GSEA)
- 5 databases: GO BP/MF/CC, KEGG, Reactome
- Requires biomart for UniProt→gene symbol mapping (implement fallback)

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
