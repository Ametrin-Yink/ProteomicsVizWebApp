# Task 2: Step Library & Pipeline Composition

## Context

After Task 1 (backend foundation), this task restructures the pipeline system into a composable step library. Both pipelines become 8-step symmetric layouts with shared step functions. Full spec: `docs/specs/pipeline-reform-tmt-dia.md`, Section 8.

## Requirements

### 1. Directory Structure

Create these directories:
- `backend/app/services/steps/inputs/` (with `__init__.py`)
- `backend/app/services/steps/shared/` (with `__init__.py`)  
- `backend/app/services/steps/engines/` (with `__init__.py`)

### 2. Unified Step Handlers

**`backend/app/services/steps/shared/step_unique_psm.py`** — MERGE `unique_psm_msqrob2.py` + `unique_psm_msstats.py`:
- Single `step_unique_psm(ctx)` function
- Calls `DataProcessor.step2_generate_unique_psm(ctx.df)` to add Unique_PSM column
- Re-saves parquet at `ctx.psm_file_path`
- Does NOT free `ctx.df` (managed by pipeline engine)
- Step output: `ctx.step_outputs[ctx.current_step_number] = ctx.psm_file_path`

**`backend/app/services/steps/shared/step_qc_metrics.py`** — MERGE `qc_metrics.py` + `qc_metrics_msqrob2.py`:
- Single `step_qc_metrics(ctx)` function
- Reads Protein_Abundances.tsv and Diff_Expression_*.tsv from ctx.results_dir
- Uses QCCalculator.calculate_all_metrics()
- Step output uses `ctx.current_step_number` (not hardcoded 5 or 8)

### 3. Input Handlers

**`backend/app/services/steps/inputs/step_input_tmt.py`** — `step_input_tmt(ctx)`:
- Read TMT file(s) from `ctx.file_paths` (tab-delimited .txt, auto-detect delimiter)
- Detect columns matching `Abundance \d+[NC]?`
- Melt with channel identity: `pd.melt(id_vars=[all non-abundance columns], value_vars=[abundance columns], var_name='Channel', value_name='Abundance')`
- Join Channel column with `ctx.config.tmt_channel_mapping` to get condition groups + replicate
- Drop Channel column after mapping
- Convert empty abundance strings to NaN, drop NaN rows
- Drop rows where Abundance == 0
- Build `Condition` by joining all group values with `_` in UI column order
- Build `Sample_Origination = "{Condition}_{replicate}"`
- Rename spaces→underscores in non-abundance columns
- Save to `ctx.results_dir / "PSM_Combined.parquet"`
- Set `ctx.psm_file_path`
- Support multiple files (concatenate after melting)

**`backend/app/services/steps/inputs/step_input_dia.py`** — `step_input_dia(ctx)`:
- Read N DIA files from `ctx.file_paths`
- For each file, look up metadata from `ctx.config.metadata_columns`
- Match by comparing sanitized filenames (case-insensitive, special chars stripped)
- Rename `Quan Value` → `Abundance` FIRST (before space→underscore pass)
- If Abundance already exists, rename to `Abundance_DIA` with warning
- Then rename spaces→underscores in all other columns
- Build `Condition` by joining all group values with `_` in UI column order
- Build `Sample_Origination = "{Condition}_{replicate}"`
- Save to `ctx.results_dir / "PSM_Combined.parquet"`
- Set `ctx.psm_file_path`

### 4. Pipeline Engine Update (`backend/app/services/pipeline_engine.py`)

Before calling each step handler, set:
```python
ctx.current_step_number = step.number
```

Add to `StepContext`:
```python
current_step_number: int = 0
```

### 5. Pipeline Registry Rewrite (`backend/app/services/pipeline_registry.py`)

Rewrite using plain list composition. After Task 2, the file should look like:

```python
from app.services.steps.inputs.step_input_tmt import step_input_tmt
from app.services.steps.inputs.step_input_dia import step_input_dia
from app.services.steps.shared.step_unique_psm import step_unique_psm
from app.services.steps.shared.step_remove_razor import step_remove_razor
from app.services.steps.shared.step_remove_low_quality import step_remove_low_quality_default
from app.services.steps.shared.step_filter_criteria import step_filter_criteria_default
from app.services.steps.shared.step_qc_metrics import step_qc_metrics
from app.services.steps.engines.step_msqrob2_abundance import step_protein_abundance_msqrob2
from app.services.steps.engines.step_msqrob2_de import step_multi_condition_de
from app.services.steps.engines.step_msstats_abundance import step_msstats_protein_abundance
from app.services.steps.engines.step_msstats_de import step_msstats_group_comparison
# PTM steps preserved
from app.services.steps import (
    step_ptm_prepare_data, step_ptm_summarization,
    step_ptm_group_comparison, step_ptm_qc_metrics,
)

# Plain list compositions
TMT_PROTEIN = [
    step_input_tmt, step_unique_psm, step_remove_razor,
    step_remove_low_quality_default, step_filter_criteria_default,
    step_msstats_protein_abundance, step_msstats_group_comparison, step_qc_metrics,
]
DIA_PROTEIN = [
    step_input_dia, step_unique_psm, step_remove_razor,
    step_remove_low_quality_default, step_filter_criteria_default,
    step_protein_abundance_msqrob2, step_multi_condition_de, step_qc_metrics,
]
PTM_PIPELINE = [
    step_ptm_prepare_data, step_ptm_summarization,
    step_ptm_group_comparison, step_ptm_qc_metrics,
]

PIPELINES = {
    PipelineTool.MSSTATS: PipelineDefinition(PipelineTool.MSSTATS, TMT_PROTEIN),
    PipelineTool.MSQROB2: PipelineDefinition(PipelineTool.MSQROB2, DIA_PROTEIN),
    PipelineTool.PTM: PipelineDefinition(PipelineTool.PTM, PTM_PIPELINE),
}
```

Step numbering is positional — the PipelineDefinition constructor assigns `step.number = index + 1`.

### 6. R Script Update (`backend/scripts/msqrob2_data_process.R`)

Remove the `remove_razor` block and `smallestUniqueGroups()` call (lines ~167-174). Keep contaminant/reverse filtering as safety net.

### 7. Data Processor Updates (`backend/app/services/data_processor.py`)

Add two new methods:
- `step1_combine_replicates_tmt(file_paths, tmt_channel_mapping)` — returns DataFrame
- `step1_combine_replicates_dia(file_paths, metadata_columns)` — returns DataFrame

These contain the core processing logic called by the input step handlers.

### 8. Old Step Handlers — Delete or Repurpose

Delete (5 files):
- `backend/app/services/steps/qc_metrics_msqrob2.py`
- `backend/app/services/steps/unique_psm_msqrob2.py`
- `backend/app/services/steps/unique_psm_msstats.py`
- `backend/app/services/steps/combine_replicates_msqrob2.py`
- `backend/app/services/steps/combine_replicates_msstats.py`

Update `backend/app/services/steps/__init__.py` to export from new locations.

## Tests (write FIRST)

### `Tests/backend/unit/test_pipeline_registry.py` — NEW:
1. `test_pipeline_composition_tmt` — TMT_PROTEIN has 8 steps in correct order
2. `test_pipeline_composition_dia` — DIA_PROTEIN has 8 steps in correct order
3. `test_pipeline_step_numbering` — step.number matches list position (index+1)
4. `test_pipeline_ptm_preserved` — PTM_PIPELINE has 4 steps
5. `test_pipelines_registered` — all 3 pipelines in PIPELINES dict

### `Tests/backend/unit/test_pipeline_chains.py` — update:
6. Add `test_column_contract_tmt` — TMT Step 1+2 output has all required columns (Section 8.1)
7. Add `test_column_contract_dia` — DIA Step 1+2 output has all required columns
8. Update existing chain tests for new step handlers

### `Tests/backend/unit/test_data_processor.py` — update:
9. Test `step1_combine_replicates_tmt()` with TMT fixture + mock channel mapping
10. Test `step1_combine_replicates_dia()` with DIA fixture + mock metadata_columns

## Constraints

- Write tests FIRST, make them fail, then implement
- Use backend venv Python: `backend/.venv/Scripts/python.exe`
- Step handlers have signature: `async def step_xxx(ctx: StepContext) -> None`
- The `PipelineEngine` class is at `backend/app/services/pipeline_engine.py`
- The `PipelineDefinition` and `PipelineStep` dataclasses are in `pipeline_engine.py`
- The `StepContext` dataclass is in `pipeline_engine.py`
- Existing step handlers that are NOT being replaced must keep their current signatures and behavior
- Engine-specific R step handlers (protein_abundance.py, multi_condition_de.py, group_comparison_multi.py) are MOVED to engines/ directory, not rewritten
