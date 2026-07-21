# Pipeline workflows

All three workflows use a persisted six-stage pipeline. Processing is asynchronous; the session records stage progress, timing, errors, and result paths. Retry is a clean replay from stage 1 while retaining uploaded inputs.

## Inputs

| Workflow | Required inputs | Metadata |
|---|---|---|
| TMT protein | One or more TMT PSM exports | Map every detected reporter channel to condition fields and a replicate |
| DIA protein | At least two DIA PSM exports | Assign experiment/condition fields, replicate, and optional batch per file |
| PTM TMT | PTM-enriched peptide PSM export; a matched global-proteome protein PSM export is required for protein and protein-adjusted layers | Map TMT channels to conditions and replicates; select target modification and PTM normalization |

The upload validator is the authority for required vendor columns. Do not remove columns merely to make an import pass without first confirming that they are unrelated; several vendor columns have spaces or punctuation and must be quoted safely by the preprocessing layer.

## Protein pipelines

TMT uses MSstats and DIA uses msqrob2/QFeatures. Both follow this shape:

1. Prepare and filter PSMs.
2. Resolve shared peptides when enabled.
3. Apply per-condition missingness and minimum distinct-PSM eligibility.
4. Calculate protein abundance with the selected R engine.
5. Run configured differential-abundance comparisons.
6. Calculate QC metrics.

The main shared filters are independent:

- `resolve_shared_peptides`: assign a shared PSM to the best-supported protein.
- `max_missing_fraction_per_condition`: allowed missing replicate fraction in every condition; default `0.40`.
- `min_psms_per_protein`: minimum distinct surviving PSMs per protein; default `1`, range 1-10.

Expected replicate counts come from the experiment design, not from the already-filtered data. A 20% missingness threshold plus a two-PSM minimum must not inherently produce zero proteins; zero survivors usually indicates an input, mapping, identifier, or filter implementation problem.

## PTM pipeline

1. Prepare and filter PTM TMT PSMs.
2. Resolve shared peptides.
3. Build localized PTM-site features.
4. Summarize PTM and matched protein abundance with MSstatsPTM.
5. Run PTM group comparisons and protein adjustment when matched protein data are available.
6. Calculate PTM and protein QC artifacts.

PTM results can contain three layers:

- `PTM`: site-level change.
- `Protein`: matched global-proteome protein change.
- `Protein-adjusted PTM`: PTM change minus matched protein change.

The protein and adjusted layers are disabled when no compatible global-proteome input exists. Site details include localization evidence and summarized abundance.

## Visualization and downloads

Protein sessions provide Volcano, QC, GSEA, BioNet, and Compare modules. GSEA, BioNet, and Compare are on-demand analyses, not pipeline stages.

PTM sessions provide PTM/Protein/Adjusted volcano layers, site tables and evidence, QC at PTM and protein levels, and comparison views when multiple comparisons exist.

`Download Results` belongs to the PTM result table and downloads the full immutable PTM result archive. `Export` in the application navigation publishes the entire completed session as a report. These actions are intentionally different.

## Shared reports

Protein reports retain the report-scoped visualization and bounded on-demand analysis capabilities. PTM reports are read-only viewers with Volcano and QC tabs plus PTM result downloads and site detail data. Shared viewers cannot upload files, start or rerun pipelines, change sessions, or manage reports.

## Maintainer contracts

`backend/app/services/pipeline_registry.py` is the authority for pipeline keys and stage order. `PipelineEngine` persists stage completion, timing, memory, failures, and result paths in `pipeline_state.json`; `TaskManager` supplies bounded execution and queue visibility.

Protein stages 1-3 use DuckDB SQL over Parquet. DIA preparation joins files to explicit sample metadata. TMT preparation filters PSMs, safely quotes vendor/channel identifiers, expands reporter channels, and joins the channel design. Shared-peptide resolution and eligibility operate on the authoritative `Unique_PSM` and protein/group identifiers. R owns normalization, optional imputation, summarization, and statistical modeling; it must not repeat DuckDB eligibility filters.

PTM preparation keeps enriched and matched global-proteome inputs distinct, builds localized site features, and produces stable MSstatsPTM artifacts. Site identifiers, localization evidence, abundance, comparison summaries, QC JSON, result tables, and `ptm_results.zip` must remain compatible with both live session and copied shared-report routes.

New configuration must be represented in both `SessionConfig` and `AnalysisConfig`, forwarded by processing orchestration, persisted/restored by the frontend, and covered with a non-default test. Persisted legacy fields may migrate on load, but explicit current fields always take precedence.
