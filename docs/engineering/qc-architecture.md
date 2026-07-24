# QC Architecture

## 1. Architecture Diagram

```
                            Pipeline Outputs
  ┌──────────────────────────────────────────────────────────────────┐
  │  Protein_Abundances.tsv  /  protein_summarized.tsv                │
  │  peptide_processed_long.tsv  /  ptm_feature_level.tsv             │
  │  Differential_Results_*.tsv  /  ptm_site_results.tsv              │
  │  QC_Results.json (PCA)                                            │
  └──────────┬───────────────────────────────────────────────────────┘
             │ materialize_visualization_artifacts()
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                    Parquet Artifacts                              │
  │                                                                   │
  │  protein_abundance_long.parquet   ─── protein abundance data      │
  │  peptide_abundance_long.parquet   ─── peptide/PSM abundance data  │
  │  sample_catalog.parquet           ─── sample metadata             │
  │  comparison_catalog.parquet       ─── comparison definitions      │
  │  differential_results.parquet     ─── DE test results             │
  │  qc_sample_metrics.parquet        ─── per-sample QC metrics       │
  │  qc_group_metrics.parquet         ─── per-group QC summaries      │
  │  qc_comparison_metrics.parquet    ─── per-comparison DE stats     │
  │  qc_pca.parquet                   ─── PCA coordinates             │
  │  qc_psm_completeness.parquet      ─── PSM completeness counts     │
  │  qc_psm_intensity.parquet         ─── PSM intensity stats         │
  └──────────┬───────────────────────────────────────────────────────┘
             │ DuckDB queries (in visualization_repository.py)
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                      API Endpoints                               │
  │                                                                   │
  │  GET /{session}/qc/plots                 ─── legacy QCData        │
  │  GET /{session}/visualization/qc/overview ─── canonical overview  │
  │  GET /{session}/visualization/qc/per-sample ─── per-sample data   │
  │  GET /{session}/visualization/qc/differential ─── DE QC stats    │
  │  GET /{session}/visualization/qc/samples  ─── sample metrics page │
  └──────────┬───────────────────────────────────────────────────────┘
             │ HTTP JSON responses
             ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │        Frontend (React / Next.js)                                 │
  │                                                                   │
  │  QCWorkspace ── layout, summary cards, scope tabs                 │
  │      │                                                            │
  │      └── QCPlots ── 8 plot sections (useMemo per chart)           │
  │             │    ├── PCA (scatter)                                 │
  │             │    ├── P-value Distribution (histogram)              │
  │             │    ├── PSM CV (boxplots)                             │
  │             │    ├── Protein CV (boxplots)                         │
  │             │    ├── PSM Intensity (boxplots per condition/rep)    │
  │             │    ├── Protein Intensity (boxplots per sample)       │
  │             │    ├── Protein Completeness (stacked bar)            │
  │             │    └── PSM Completeness (stacked bar)                │
  │             │                                                      │
  │             └── QCSampleHealthTable ── sample-level metrics        │
  │                                                                   │
  │  PTMQCWorkspace ── wraps QCWorkspace with scope tabs              │
  │      (PTM / Protein layer toggle)                                 │
  └──────────────────────────────────────────────────────────────────┘
```

## 2. Artifact Files Table

All Parquet files live in `{results_dir}/` and are produced by `visualization_artifacts.py`.

| File | Columns | Type | Contents |
|---|---|---|---|
| `protein_abundance_long.parquet` | protein_accession, gene_name, sample_id, condition, replicate, batch, processed_log2_abundance, provenance, observed_feature_count, imputed_feature_count, imputation_fraction, pipeline, result_layer, sample_order, condition_order | protein abundance | Long-format log2 abundances for every protein x sample |
| `peptide_abundance_long.parquet` | protein_accession, gene_name, peptide_id, sample_id, condition, replicate, batch, processed_log2_abundance, provenance, pipeline, result_layer, sample_order, condition_order | peptide/PSM abundance | Long-format log2 abundances for every peptide x sample |
| `sample_catalog.parquet` | sample_id, condition, replicate, batch, sample_order, condition_order | sample metadata | Indexed sample list with condition assignments |
| `comparison_catalog.parquet` | comparison_id, display_label, group1_json, group2_json, group1_label, group2_label, comparison_order, tested_count, significant_count, result_status, group1_sample_count, group2_sample_count | comparison metadata | All pairwise comparisons with DE status |
| `differential_results.parquet` | comparison_id, protein_accession, gene_name, log2_fold_change, p_value, adjusted_p_value, standard_error, statistic, psm_count, result_layer, pipeline | DE results | Differential expression test results per comparison |
| `qc_sample_metrics.parquet` | sample_id, condition, replicate, batch, sample_order, total_feature_count, present_count, missing_count, observed_feature_count, imputed_feature_count, imputation_fraction, median_log2_abundance, abundance_q1, abundance_q3, abundance_min, abundance_max | per-sample QC | Protein-level sample QC metrics |
| `qc_group_metrics.parquet` | group_by, group_value, sample_count, observation_count, q1, median, q3, observed_count, imputed_count, missing_count, protein_cv_count, protein_cv_q1, protein_cv_median, protein_cv_q3, peptide_cv_count, peptide_cv_q1, peptide_cv_median, peptide_cv_q3, lowerfence, upperfence | group QC | Grouped abundance summaries and CV distributions |
| `qc_comparison_metrics.parquet` | comparison_id, tested_count, significant_count, result_status | comparison QC | Summary stats per comparison |
| `qc_pca.parquet` | sample_id, pc1, pc2, condition | PCA | PCA coordinates for all samples |
| `qc_psm_completeness.parquet` | sample_id, condition, result_layer, psm_total_count, psm_present_count, psm_missing_count | PSM completeness | Per-sample PSM detection completeness |
| `qc_psm_intensity.parquet` | result_layer, condition, replicate, sample_count, q1, median, q3 | PSM intensity | Per-(condition, replicate) PSM intensity boxplot stats |

## 3. API Endpoints Table

All endpoints require `{session_id}` and serve JSON via `create_response()`.

| URL | Method | Response Shape | Pipeline | Description |
|---|---|---|---|---|
| `/{session_id}/qc/plots` | GET | `QCData` | msstats, ptm | Legacy compact QC summary (uses `load_qc_summary`) |
| `/{session_id}/visualization/qc/overview` | GET | `QCOverviewData` | msstats, ptm | Paginated group summaries with PCA, CV metrics, normalization info |
| `/{session_id}/visualization/qc/per-sample` | GET | `QCPerSampleData` | msstats, ptm | Per-sample protein/PSM intensity distributions and completeness |
| `/{session_id}/visualization/qc/differential` | GET | `QCDifferentialData` | msstats, ptm | P-value distribution and DE summary for one comparison |
| `/{session_id}/visualization/qc/samples` | GET | `CursorPage<QCSampleMetric>` | msstats, ptm | Paginated per-sample QC metrics |
| `/{session_id}/ptm/qc/plots` | GET | `QCData` | ptm only | PTM pipeline QC plots (includes protein_layer if available) |

Query Parameters:

- **overview**: `group_by` (condition|batch), `search`, `cursor`, `limit`
- **per-sample**: `result_layer` (protein|ptm|adjusted_ptm)
- **differential**: `comparison` (required, format `{group1}_vs_{group2}`)
- **samples**: `search`, `cursor`, `limit`

## 4. Frontend Component Tree

```
QC page (/analysis/visualization/qc)
  └── QCWorkspace                    ← Layout, summary cards, scope/group-by controls
       │  - Fetches overview + perSample + differential via useQcData()
       │  - Renders summary statistics cards
       │  - Condition/batch group-by toggle
       │  - Comparison selector dropdown
       │
       ├── [scopeTabs]              ← VisualizationScopeTabs (PTM only: "PTM" | "Protein")
       │
       └── QCPlots                  ← All 8 plot sections
            │  - Receives data, overview, perSampleData, differential
            │  - Each plot section uses useMemo for derived DataCompleteness,
            │    IntensityDistributions, PSMCV, PCAData
            │
            ├── PCA (scatter)
            │    useMemo: extract PCAData → transformPCARowBased()
            │
            ├── P-value Distribution (histogram)
            │    useMemo: select from pvalue_distributions or pvalue_distribution
            │
            ├── PSM CV (boxplot)
            │    useMemo: PSMCV from groups' peptide_cv quartiles
            │
            ├── Protein CV (boxplot)
            │    useMemo: PSMCV from groups' protein_cv quartiles
            │
            ├── PSM Intensity (boxplot)
            │    useMemo: nest psm_intensity by condition → replicate
            │
            ├── Protein Intensity (boxplot)
            │    useMemo: key protein_intensity by sample_id
            │
            ├── Protein Completeness (stacked bar)
            │    useMemo: DataCompleteness from protein_completeness
            │
            └── PSM Completeness (stacked bar)
                 useMemo: DataCompleteness from psm_completeness

  └── QCSampleHealthTable           ← Sample-level metrics table & page controls

PTMQCWorkspace (PTM pipeline)
  └── wraps QCWorkspace
       - Fetches PTM qc/plots endpoint
       - Adds PTM/Protein scope toggle
       - Passes appropriate data based on scope selection
```

### Data Flow Summary

1. **QC page** calls `useQcData(sessionId)` which fetches all canonical endpoints
2. **QCWorkspace** receives `QCData`, `QCOverviewData`, `QCPerSampleData`, `QCDifferentialData`
3. **QCPlots** receives all four and derives plot data via `useMemo` per chart
4. **`buildQcExport()`** (in `qc-figures.ts`) converts canonical data to Plotly figure specs for HTML report export, using `canonicalToQCData()` internally

## 5. How to Add a New QC Plot Type

### Step 1: Define the data shape in the API

Add the new field to the appropriate TypeScript interface in `frontend/src/types/api.ts`:

```typescript
export interface QCData {
  // ... existing fields
  my_new_metric?: MyNewMetric;
}
```

If the data comes from a new Parquet artifact, add the file constant in `backend/app/services/visualization_artifacts.py`:

```python
MY_NEW_ARTIFACT = "my_new_metric.parquet"
```

### Step 2: Materialize the artifact

Add a DuckDB `COPY` query in `_materialize_qc_artifacts()` that writes the Parquet file:

```python
connection.execute(f"""
    COPY (
        SELECT ...
        FROM read_parquet({protein})
        GROUP BY ...
    ) TO {_sql_literal(results_dir / MY_NEW_ARTIFACT)}
    (FORMAT PARQUET, COMPRESSION ZSTD)
""")
```

Add it to the `artifacts` dict in the manifest and register it for `load_visualization_artifact_manifest()` if required.

### Step 3: Add a repository method

In `backend/app/services/visualization_repository.py`, add a method that queries the new Parquet artifact and returns the typed data.

### Step 4: Add an API endpoint

In `backend/app/api/routes/visualization_manifest.py`, add:

```python
@router.get("/{session_id}/visualization/qc/my-metric")
async def get_my_metric(...):
    repository = _repository_or_conflict(session_id)
    data = await asyncio.to_thread(repository.get_my_metric, ...)
    return create_response(data)
```

### Step 5: Add the frontend API client method

In `frontend/src/lib/api-client.ts`, add:

```typescript
getMyMetric: (apiPrefix: string, signal?: AbortSignal): Promise<MyNewMetric> => {
  return fetchApi<MyNewMetric>(`${apiPrefix}/visualization/qc/my-metric`, { signal });
},
```

### Step 6: Add the conversion in `canonicalToQCData()`

In `frontend/src/lib/figures/qc-figures.ts`, extend `canonicalToQCData()` to convert the canonical data to the legacy `QCData` field.

### Step 7: Add the plot builder

Add a new trace builder function:

```typescript
function myNewMetricTracesAndLayout(
  metric: MyNewMetric,
  conditionColors: Record<string, string>,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  // Build Plotly traces and layout
}
```

### Step 8: Wire into `buildQcExport()`

In the `buildQcExport()` function, add the new chart:

```typescript
let myNewChart: QcFigureEntry | null = null;
if (data.my_new_metric) {
  myNewChart = myNewMetricTracesAndLayout(data.my_new_metric, conditionColors);
}

return {
  plots: {
    // ... existing plots
    myNewChart,
  },
};
```

### Step 9: Add the plot to QCPlots component

Add a new section in `frontend/src/components/visualization/QCPlots.tsx` using the same pattern as the existing charts (useMemo + LazyPlot).

### Step 10: Update the test

Add test cases in `frontend/src/lib/figures/qc-figures.test.ts` covering the conversion and the plot builder.

## 6. PTM Scope Layering

The PTM pipeline produces three data layers stored in the `result_layer` column across Parquet artifacts:

| `result_layer` | Description | Source File |
|---|---|---|
| `protein` | Global proteome abundance (background) | `protein_feature_level.tsv` or `ptm_site_summarized.tsv` |
| `ptm` | PTM-enriched site abundance | `ptm_feature_level.tsv` or `ptm_site_summarized.tsv` |
| `adjusted_ptm` | PTM abundance adjusted for protein-level changes | `adjusted_ptm_results.tsv` |

### How result_layer flows through the system

1. **Materialization**: Each row in `protein_abundance_long.parquet` and `peptide_abundance_long.parquet` carries a `result_layer` tag. Non-PTM pipelines use `'protein'` for all rows.

2. **QC aggregation**: The `_materialize_qc_artifacts()` function filters by `WHERE result_layer = 'protein'` for the main QC metrics. PTM-specific QC is generated separately via `PTMQCWorkspace`.

3. **API filtering**: The `per-sample` endpoint accepts a `result_layer` query parameter (`?result_layer=ptm`) to return data for a specific layer.

4. **Frontend scope tabs**: `PTMQCWorkspace` renders `VisualizationScopeTabs` that toggle between `'ptm'` and `'protein'` scopes. When the user switches scope, the component fetches the appropriate QC data and passes it to `QCWorkspace`.

5. **DE results**: `differential_results.parquet` stores `result_layer` per row, enabling simultaneous storage of protein, PTM, and adjusted PTM DE results. The comparison catalog reports only protein-layer counts.

6. **Export**: The HTML report export (`buildQcExport`) always uses `result_layer = 'protein'` for non-PTM pipelines. PTM exports are handled separately by the PTM-specific module.
