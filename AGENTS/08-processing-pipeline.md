# 08 - Processing Pipeline

The plugin-based engine in `pipeline_engine.py` runs step handlers registered in
`pipeline_registry.py`. DIA/msqrob2 and TMT/MSstats use the same six-stage shape:

1. Prepare and filter PSMs.
2. Resolve shared peptides, when enabled.
3. Filter per-condition coverage and protein eligibility.
4. Calculate protein abundance with the selected R engine.
5. Run differential expression with the selected R engine.
6. Calculate QC metrics in Python.

GSEA, BioNet, and Compare are on-demand analyses triggered from visualization or
comparison routes; they are not pipeline stages.

## Shared DuckDB preprocessing

Stages 1-3 use DuckDB SQL over Parquet. `ctx.df = None` after preparation signals
the disk-based path; pandas is not used in preprocessing.

- Stage 1 creates `Unique_PSM` and removes contaminant/reverse hits,
  `Quan Info=No Value`, and abundance values below 1. TMT also requires
  `Average Reporter SN >= 5` and `Normalized CHIMERYS Coefficient >= 0.8`
  before UNPIVOT, so rejected PSMs never expand into reporter-channel rows.
- Stage 2 assigns each shared `Unique_PSM` to the candidate protein with the
  greatest distinct-PSM support. Original accession order breaks ties. When the
  option is disabled, the original protein group is preserved without copying.
- Stage 3 requires every PSM to pass the configured missing-value fraction in
  every designed condition, then requires the configured number of distinct
  surviving PSMs per protein. Expected replicate counts come from experiment
  design metadata, not the already-filtered Parquet file.

The canonical methods are:

- `step1_2_duckdb_dia()` - join DIA files to sample metadata and write Parquet.
- `step1_2_duckdb_tmt()` - filter raw PSMs, expand channels, map the TMT design,
  and write long-format Parquet.
- `step2_resolve_shared_peptides_duckdb()` - resolve shared protein assignments.
- `step3_filter_by_criteria_duckdb()` - apply coverage and protein eligibility.

## R engine ownership

DuckDB owns contaminant/reverse filtering, shared-peptide assignment,
missingness, and minimum-PSM protein eligibility. The R stages must not repeat
those filters.

- `msstats_data_process.R` retains MSstats conversion, feature selection,
  normalization, imputation, and summarization. It preserves the authoritative
  protein/group identifier, sets `useUniquePeptide=FALSE`, and disables the
  converter's hidden few-measurement removal.
- `msqrob2_data_process.R` retains QFeatures normalization, optional imputation,
  and aggregation. It no longer applies razor, contaminant/reverse,
  observation-count, or minimum-peptide filters.
- Both R engines report `PSM_Count` as distinct `Unique_PSM` support for the
  exact authoritative protein/group identifier.
- Group-comparison stages support batched execution for large comparison sets.

## Configuration

Shared filtering uses three independent fields in both `SessionConfig` and
`AnalysisConfig`:

- `resolve_shared_peptides` (boolean)
- `max_missing_fraction_per_condition` (0 through 1; default 0.40)
- `min_psms_per_protein` (1 through 10; default 1)

Persisted legacy fields are migrated on load: `remove_razor` maps to shared
resolution, `strict_filtering=true` maps to 0.20 missingness and at least two
PSMs per protein, and `min_peptides_per_protein` maps to the new PSM minimum.
Explicit new fields always take precedence.

Session configuration flows from the API model through
`_build_analysis_config()` to the pipeline context. Any new field must exist in
both API and analysis models and must be covered by the configuration-forwarding
contract test.

## Architecture and state

- `PipelineDefinition` is the ordered list of `PipelineStep` objects for a
  `PipelineTool`.
- `StepContext` carries file paths, configuration, results, and stage outputs.
- `PipelineEngine.run()` handles cancellation, saves state after every stage,
  and records timing and memory in `pipeline_state.json`.
- `task_manager.py` isolates long computations in task-specific thread pools and
  queues sessions when pipeline workers are occupied.

Pipeline state is stored at `sessions/{session_id}/pipeline_state.json` with the
current stage, completed stages, failure information, output paths, timings, and
memory measurements.

Retry performs a clean replay from stage 1. It revalidates configuration and
inputs and clears prior stage/result state while preserving uploaded inputs and
existing result artifacts. True mid-pipeline context reconstruction is not
supported.
