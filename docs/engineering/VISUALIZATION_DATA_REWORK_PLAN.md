# Visualization data and reprocessing plan

Status: implementation in progress. The canonical visualization-data checkpoint was committed as `52fc42a` on 2026-07-22; final QC scale and verification work continued on 2026-07-23.

This plan aligns abundance plots, QC, GSEA heatmaps, and downstream protein analyses with the normalized and optionally imputed data used by the statistical pipelines. It also defines how completed sessions are reprocessed when their result artifacts predate the new visualization contract.

PTM Compare is explicitly outside this implementation cycle because it requires a separate redesign.

Implemented behavior includes canonical Parquet abundance and differential repositories, comparison-scoped log2 boxplots, queryable QC artifacts, a functional comparison-scoped GSEA heatmap, transactional in-place Reprocess with report refresh, and blockwise DIA/TMT comparison correlation. Runtime compatibility loading for pre-contract abundance, differential-result, and QC artifacts has been removed; those sessions must be reprocessed.

## Goals

- Display processed log2 protein and peptide abundance consistently for TMT, DIA, and PTM results.
- Preserve whether quantitative evidence was observed, imputed, or model-estimated.
- Query individual proteins efficiently without loading complete feature tables into pandas.
- Generate QC from clearly defined observed-input, processed-input, and differential-result layers.
- Make the GSEA leading-edge heatmap functional with comparison-scoped processed abundance.
- Reprocess unsupported completed sessions in place after explicit user confirmation.
- Refresh every report associated with a successfully reprocessed session while preserving its report ID, name, and share token.
- Reuse the current page structure, components, typography, spacing, colors, loading states, and modal patterns.
- Support the primary DIA target of approximately 30,000 samples and 10,000 comparisons without sending unbounded tables or matrices to the browser.

## Scientific ownership and scale

R remains authoritative for normalization, optional imputation, summarization, batch correction, and statistical modeling. Python may validate and reshape R output, but it must not reconstruct or reinterpret those operations.

Canonical abundance values are stored and displayed on the processed log2 scale. The frontend must not apply per-peptide min-max normalization or convert processed values into a different analytical layer.

Peptide-level values can be classified as observed or imputed. A summarized protein value must not be called simply imputed: it may combine observed and imputed features. Protein abundance therefore carries observed feature count, imputed feature count, and imputation fraction.

## Scale target and interaction model

The visualization architecture targets approximately 30,000 DIA samples, 10,000 comparisons, and tens of thousands of quantified proteins or PTM features. Statistical calculations and reported summaries remain exact. Visual level-of-detail affects presentation only and must never change filtering, normalization, imputation, differential modeling, correlations, or reported counts.

Large views follow an overview, filter, and drill-down model:

1. Open a compact experiment-wide overview built from precomputed exact summaries.
2. Search or filter comparisons, conditions, batches, metadata groups, proteins, or samples through server-backed catalogs.
3. Query bounded detail for the current viewport or selected entities.
4. Download complete data when a browser chart or table is not an appropriate representation.

There is no universal 10,000-point cap. Volcano, PCA, and other point-oriented plots use WebGL and must render the full expected 30,000-point scale. The initial performance target is at least 100,000 interactive points on the supported development workstation. Higher-cardinality views use benchmark-driven density or raster overviews with WebGL detail after filtering; any visual aggregation or omission is stated explicitly.

Boxplots display at most 50 groups simultaneously. Additional groups remain scientifically included and are accessible through search, filters, pagination, or group drill-down. Exact server-side box statistics are calculated from all values in each displayed group.

## Versioned visualization contract

Every newly completed pipeline writes a visualization artifact manifest containing:

- schema version;
- pipeline and available result layers;
- normalization and imputation methods;
- abundance scale;
- canonical artifact names;
- generation timestamp.

The visualization manifest API reports whether the result schema is supported and whether reprocessing is required. Sessions without the current artifact contract are not served through legacy abundance or QC readers. Their result shell explains that the results require reprocessing and exposes the Reprocess action.

Published reports remain self-contained snapshots. A report is refreshed only after its source session completes a confirmed reprocess successfully.

The scalable result contract also includes server-queryable catalogs rather than embedding all options in the manifest or initial page response:

- `sample_catalog.parquet`, with sample ID, condition, replicate, batch, and configured metadata;
- `comparison_catalog.parquet`, with stable comparison ID, display label, group definitions, sample counts, result status, tested count, and significant count;
- bucketed and comparison-sorted `differential_results.parquet`, avoiding both 10,000 individual TSV files and one unindexed browser payload.

Catalog endpoints use cursor pagination and server-side search. The frontend does not download 30,000 sample entries or 10,000 comparison entries merely to populate a selector.

## Canonical abundance artifacts

Each pipeline produces two immutable long-form Parquet artifacts:

- `protein_abundance_long.parquet`
- `peptide_abundance_long.parquet`

Common fields include:

- protein accession;
- gene name where available;
- peptide identifier for peptide rows;
- sample ID;
- condition;
- replicate;
- processed log2 abundance;
- observed/imputed/model provenance;
- pipeline and result layer where needed.

Protein rows additionally include observed feature count, imputed feature count, and imputation fraction.

The authoritative sources are:

- DIA: the selected normalized or imputed QFeatures assays;
- TMT: MSstats `FeatureLevelData` and `ProteinLevelData`;
- PTM: MSstatsPTM feature-level and protein-level processed output.

R exports the selected processed assays. Python validates their required fields and materializes canonical Parquet. Cross-language contract tests must protect field meanings, numeric scale, missing-value encoding, and imputation provenance.

## Abundance repository and API

A shared backend repository queries the canonical Parquet artifacts through DuckDB. Queries are predicate-scoped by protein accession, selected comparison conditions, and result layer. Sample ordering comes from explicit condition and replicate metadata rather than alphabetical inference.

DuckDB work runs outside the async event loop. Dynamic identifiers use the established quoting helpers. A persistent DuckDB database is not introduced; immutable Parquet remains the portable session and report artifact.

The API returns processed log2 abundance, sample metadata, imputation provenance, and quantitative-method metadata. A selected comparison must include only its complete condition groups—for example, four DMSO and three drug samples return seven samples.

Abundance endpoints are summary-first. They return exact per-condition quartiles, fences, observation counts, imputed counts, and imputation fractions, plus point data when the selected comparison remains within the interactive point budget. A separate cursor-paginated detail endpoint exposes individual protein/sample or peptide/sample observations. A browser request must not receive millions of peptide/sample rows merely to draw a boxplot.

## Abundance presentation

Both abundance charts use Plotly boxplots and the existing visualization design language.

### Protein abundance

- One box per condition.
- Individual sample points are overlaid.
- Imputed or model-estimated contributions use distinct hollow markers and tooltips.
- The y-axis is labeled `Normalized log2 abundance`.
- Condition colors match the shared pipeline palette.

### Peptide abundance

- One box per condition, not one box per peptide.
- Each plotted value is a processed peptide/sample observation for the selected protein.
- Hover data identifies the peptide, sample, log2 abundance, and observed/imputed status.
- Hundreds of peptides contribute to the condition distribution without creating hundreds of x-axis categories.
- No frontend `0-1` normalization is applied.

The panel states the normalization method, imputation method or status, abundance scale, and evidence provenance.

## QC generation

QC remains a compact pipeline-generated JSON artifact. Canonical Parquet is read during QC generation; browser-facing requests do not scan full abundance matrices.

At large DIA scale, QC finalization additionally writes queryable derived artifacts:

- `qc_sample_metrics.parquet`, one row per sample;
- `qc_group_metrics.parquet`, exact precomputed summaries by condition, batch, and supported metadata grouping;
- `qc_comparison_metrics.parquet`, one row per comparison with p-value bins and tested/significant/failed counts;
- `qc_pca.parquet`, one coordinate row per sample with grouping metadata.

DuckDB produces these artifacts through streaming or bounded-memory queries. QC generation must not pivot 30,000 samples into an unbounded pandas-wide matrix solely for presentation.

QC is divided into three scientific scopes.

### Observed-input QC

- detected PSM, peptide, site, and protein counts as applicable;
- observed-data completeness;
- pre-model intensity distributions;
- filtering totals and losses.

### Processed/model-input QC

- PCA from the exact processed protein or site matrix;
- normalized abundance distributions;
- protein/site and peptide/PSM CV distributions;
- observed, imputed, and missing counts per sample;
- imputation percentage per sample and condition.

### Differential-result QC

- p-value distribution for the selected comparison;
- number of tested entities;
- number of significant entities;
- failed or non-estimable model fits.

Observed, imputed, and missing counts must reconcile for every sample. CV calculations retain the documented log-normal conversion from replicate log2 standard deviation.

## QC presentation

The page is organized using the current cards, plot containers, selectors, typography, spacing, and responsive layout:

1. Analysis Summary
2. Sample Relationships
3. Abundance Distributions
4. Missingness and Imputation
5. Reproducibility
6. Differential Results

PCA, CV, intensity, and completeness remain experiment-wide because they assess overall sample quality. Differential-result QC is comparison-specific. A comparison dropdown is placed in the Differential Results section header and updates the entire section. Scope labels make this distinction explicit.

Observed/imputed/missing stacked bars replace ambiguous present/missing displays where provenance is available. Normalization and imputation badges use existing badge styles. PTM and Protein scope tabs retain equivalent metric definitions and the shared condition-color mapping.

The experiment-wide QC overview defaults to grouping by condition. A `Group by` selector can use batch or another configured metadata column. A chart renders no more than 50 groups at once; searchable pagination and drill-down expose the remaining groups.

PCA uses precomputed coordinates and WebGL for the expected 30,000 samples. Density or raster presentation is reserved for datasets that exceed the measured WebGL budget, with selected and flagged samples overlaid as interactive points. A virtualized sample-health table provides all per-sample metrics without creating one DOM row per sample.

CV and intensity views do not create 30,000 box traces. The overview shows exact distributions grouped by condition, batch, or selected metadata. Selecting a group opens exact group statistics, a point view within the interactive budget, and a cursor-paginated sample table. Labels state whether a distribution represents samples within a group, features within a sample, or feature CVs within a condition.

The comparison dropdown in Differential Results is an asynchronous catalog search rather than an in-memory list of all 10,000 comparisons.

## Transactional in-place reprocessing

Every completed private session displays Reprocess beside Export. Unsupported sessions also show an explanatory result-page notice that directs the user to this action.

Reprocess uses the current session ID, uploads, metadata, comparisons, and persisted configuration. Existing configuration migrations may translate documented legacy fields, but the operation must not silently invent values for required settings. An unresolvable configuration produces a specific validation error before processing begins.

The user must confirm a destructive-action modal. The modal explains that a successful run permanently replaces the session's analysis results, QC, abundance artifacts, saved GSEA/BioNet outputs, and associated report contents. The primary action is labeled `Reprocess and Replace Results`.

Reprocessing is transactional:

1. Validate the completed session, saved configuration, uploads, queue availability, and absence of conflicting active work.
2. Run the current pipeline into a session-scoped staging result directory without using old checkpoints.
3. Leave the current result directory and published reports intact while processing.
4. If processing fails or is cancelled, discard staged output and preserve the previous results and reports.
5. If processing succeeds, validate the new artifact contract and atomically replace the current result directory.
6. Invalidate all session visualization caches and reset saved on-demand result state.
7. Regenerate every report whose metadata references the session.

Report refresh is also staged and atomic. Each refreshed report preserves its report ID, name, creation time, and share token, and records a `refreshed_at` timestamp. Existing share URLs therefore display the new results after refresh. A report remains on its previous valid snapshot if its replacement cannot be generated; the reprocess status reports the refresh failure rather than publishing a partial directory.

At large DIA scale, reprocessing performs a free-space preflight before starting because the valid old results and staged replacement coexist until commit. Report snapshots reuse immutable result artifacts through validated hard links when session and report storage share a filesystem, with independent copying as the safe fallback. Shared-report APIs remain cursor-paginated and tile- or query-scoped; they never return all samples, comparisons, or correlation cells in one response.

The confirmation explicitly warns that people using existing report links will see changed content after successful refresh.

## GSEA heatmap

The existing disconnected leading-edge heatmap path is completed rather than replaced with a new design.

For the selected pathway, the backend:

1. obtains leading-edge genes from the GSEA result;
2. queries canonical processed protein log2 abundance for the active comparison;
3. maps genes to accessions deterministically;
4. orders samples by comparison condition and replicate;
5. calculates row-wise z-scores for heatmap color while retaining processed log2 values for hover data.

The expected DIA comparison contains two conditions and fewer than 20 samples in total. The heatmap therefore renders every sample in the active comparison as an individual column; it does not aggregate conditions or silently sample columns. The sample catalog supplies condition and replicate ordering. Missing mappings produce a styled explanatory empty state instead of misaligned rows. Interactive and exported GSEA heatmaps use the same matrix.

GSEA remains an on-demand analysis for one selected comparison. The pipeline does not precompute GSEA for all 10,000 comparisons.

## Large DIA comparison correlation

The purpose of DIA Compare is to study correlation structure across the complete large comparison collection. The current implementation computes Euclidean RMSD while presenting the feature as correlation and sends a full JSON matrix to the browser; that contract does not satisfy the large-DIA goal.

The redesigned DIA module builds a protein-by-comparison log2-fold-change matrix from canonical differential results and computes the complete comparison-by-comparison correlation structure in bounded blocks. For 10,000 comparisons this is 100 million correlation cells, so the full matrix is stored as a versioned binary or Parquet-derived artifact and is never serialized as one JSON response.

The correlation result includes:

- all comparison IDs and catalog metadata;
- the complete symmetric correlation matrix in a compact numeric representation;
- the number of shared valid proteins supporting each correlation or a compatible support summary;
- a deterministic comparison ordering or clustering artifact;
- two-dimensional overview coordinates for all comparisons;
- nearest and least-correlated comparison indexes for interactive lookup.

The browser presents the full scientific result through multiple resolutions:

- a tiled correlation heatmap whose overview includes all comparisons;
- zoom and pan that request only tiles intersecting the current viewport;
- labels and exact cell values when the viewport reaches a readable resolution;
- a WebGL embedding of all comparison points, colored by searchable metadata;
- reference-comparison search with nearest, least-correlated, and support-count results;
- a detail heatmap for the comparisons currently visible or explicitly selected.

There is no fixed scientific comparison-subset limit. The previously proposed limit of 50 referred only to a labeled detail heatmap, not to correlation computation. It is removed as a global limit. Viewport tile size and label density are presentation details determined by screen resolution and performance testing, while every comparison remains represented in the overview and queryable by exact ID.

Full correlation computation is a bounded queued task with progress, cancellation, deterministic cache keys, and resumable block artifacts. Repeated identical requests reuse the persisted result. Shared-report endpoints expose bounded tiles and lookups rather than the full matrix payload.

The complete matrix uses Pearson correlation of protein log2 fold-change vectors. Spearman correlation is available on demand for a selected or reference comparison rather than being precomputed as a second complete matrix.

Missing protein results use pairwise-complete observations. Each correlation records and displays its shared-protein support count. Correlations supported by fewer than 100 shared proteins are suppressed as insufficient rather than imputed or presented as reliable values.

## GSEA and BioNet input consolidation

After abundance, QC, and the heatmap are stable, GSEA ranking and BioNet filtering move to a shared differential-result repository backed by canonical Parquet. BioNet may write a bounded temporary TSV only at its R subprocess boundary. Unused GSEA abundance-loading paths are removed once the functional heatmap uses the abundance repository.

PTM Compare is not changed in this work.

## Implementation sequence

1. Add artifact schema/versioning, catalogs, and processed R exports.
2. Materialize and validate canonical abundance and differential-result Parquet.
3. Add the shared abundance repository, cursor-paginated catalogs, and comparison-scoped APIs.
4. Replace protein and peptide abundance presentation.
5. Add large-scale QC derived artifacts and reorganize the QC page.
6. Add unsupported-session handling and transactional Reprocess/report refresh.
7. Connect and verify the comparison-scoped GSEA heatmap.
8. Consolidate GSEA and BioNet differential-result access.
9. Replace DIA comparison RMSD/JSON processing with blockwise correlation artifacts and multi-resolution APIs.
10. Replace the DIA comparison UI with tiled correlation, embedding, search, and viewport detail views.

Each step must remain independently reviewable and preserve unrelated behavior.

## Verification

Required evidence includes:

- controlled known-answer DIA and TMT fixtures;
- PTM processed-artifact regression fixtures;
- R-to-Python schema and numeric-scale tests;
- exact observed/imputed reconciliation tests;
- comparison-scoped sample-count API tests;
- transactional reprocess success, failure, cancellation, and cache-invalidation tests;
- report-refresh tests proving atomicity and stable share tokens;
- shared-report isolation and capability tests;
- frontend tests for boxplots, colors, scope labels, dropdown behavior, confirmation consequences, and GSEA heatmaps;
- browser screenshots for every affected TMT, DIA, and PTM page at supported viewports;
- the standard Ruff, OpenAPI, pytest, frontend lint, typecheck, test, and production-build gates.

Performance verification must demonstrate that a single-protein abundance request uses a predicate-scoped Parquet query rather than reading a complete feature table.

Large-scale performance fixtures must also verify:

- cursor-paginated search over 30,000 samples and 10,000 comparisons;
- exact QC summaries without rendering more than 50 boxplot groups;
- full WebGL rendering at the 30,000-point target and at least a 100,000-point benchmark fixture;
- GSEA heatmaps containing every sample from a comparison with fewer than 20 samples;
- blockwise correlation execution without holding duplicate 10,000-by-10,000 Python matrices in memory;
- bounded correlation-tile and exact-cell API payloads;
- shared reports never returning all samples, comparisons, or matrix cells in one response.

## Approved DIA correlation contract

- The complete comparison matrix uses Pearson correlation of protein log2 fold changes.
- Missing protein results use pairwise-complete observations.
- Every correlation carries a shared-protein support count.
- Correlations with fewer than 100 shared proteins are suppressed as insufficient.
- Spearman correlation is computed on demand for selected or reference-comparison exploration and is not materialized as a second complete 10,000-by-10,000 matrix.
