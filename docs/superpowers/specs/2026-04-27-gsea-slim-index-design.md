# GSEA Slim Index + On-Demand Computation

## Problem

- `GSEA_Results.json` is 2.7GB because it pre-calculates running ES curves, rank positions, and heatmaps for all 1,801 pathways
- PSM_Count column appears in heatmaps (bug in `_generate_heatmap_data` id_cols exclusion)
- FDR threshold of 0.05 was too strict for GSEA (changed to 0.25, but pre-calculated "significant" flag is baked into JSON)
- All 3 issues share the same root cause: data is pre-calculated and serialized during processing

## Design

### 1. Slim JSON Index

During processing (Step 9), save only lightweight pathway metadata:

```json
{
  "go_bp": {
    "database": "go_bp",
    "total_pathways": 1801,
    "significant_pathways": 42,
    "overrepresented": 30,
    "underrepresented": 12,
    "results": [
      {
        "term": "muscle contraction",
        "name": "muscle contraction",
        "es": 0.65,
        "nes": 2.002,
        "pval": 0.0,
        "fdr": 0.308,
        "lead_genes": ["gene1", "gene2", ...],
        "matched_genes": 15
      }
    ]
  }
}
```

Expected size: 5-15MB (was 2.7GB). No `running_es_curve`, `rank_metric_positions`, or `heatmap_data`.

### 2. New API Endpoints

**`GET /gsea/{database}`** — unchanged, loads slim JSON, applies pagination/sort/search

**`GET /gsea/{database}/{term}/plot`** — NEW
- Reads gseapy `.rnk` file (ranked gene list)
- Computes running ES curve from the ranked list + lead_genes
- Returns: `{ term, es, nes, running_es_curve: [{rank, es}], rank_metric_positions: [[gene, pos, metric]] }`

**`GET /gsea/{database}/{term}/heatmap`** — NEW
- Loads `Protein_Abundances.tsv` from session (already cached separately)
- Filters to lead genes, computes z-scores
- Returns: `{ genes, samples, z_scores }`
- Excludes metadata columns: `PSM_Count`, `psm_count`, `Gene_Name`, etc.

### 3. Frontend Changes

- `BioinformaticsPage` — unchanged for table loading
- `GSEAPlot` — when pathway selected, fetches `/plot` and `/heatmap` endpoints in parallel, then renders

### 4. Backward Compatibility

- Old `GSEA_Results.json` files with embedded curves/heatmaps still work (fields are optional in model)
- New sessions use slim index + on-demand endpoints

## Files Changed

| File | Change |
|------|--------|
| `backend/app/models/data.py` | Remove `running_es_curve`, `rank_metric_positions`, `heatmap_data` from GSEAResult (make optional) |
| `backend/app/services/gsea_service.py` | Remove curve/heatmap generation from `run_gsea_analysis`; add `_compute_running_es_curve` and `_compute_heatmap` methods for on-demand use |
| `backend/app/api/routes/visualization.py` | Add `/gsea/{database}/{term}/plot` and `/gsea/{database}/{term}/heatmap` endpoints; simplify GSEA cache loading |
| `frontend/src/components/visualization/GSEAPlot.tsx` | Fetch plot/heatmap data on-demand when pathway selected |
| `frontend/src/types/api.ts` | Add new types for plot/heatmap responses |

## Success Criteria

- GSEA_Results.json < 50MB
- PSM_Count not in heatmaps
- FDR 0.25 threshold correctly applied
- Table loads in < 1s (was instant with cache, still instant)
- Plot + heatmap load within 1s of pathway selection
