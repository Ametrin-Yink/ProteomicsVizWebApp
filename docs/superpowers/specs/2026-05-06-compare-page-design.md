# Compare Page — Design Spec

**Date:** 2026-05-06
**Status:** draft
**Scope:** New visualization page for protein and comparison correlation analysis

## Context

Users need to understand protein behavior across multiple comparisons simultaneously, and compare how comparisons relate to each other. Currently the app shows one comparison at a time (volcano plot) or one comparison's pathway enrichment (GSEA). There is no cross-comparison view.

## Feature Summary

A new "Compare" tab in the visualization section with two panels:

1. **Protein Correlation Analysis** — protein-centric: how a protein behaves across all comparisons, and which proteins are most correlated with it
2. **Comparison Correlation Analysis** — comparison-centric: how comparisons relate to each other, which proteins they share, and which comparisons are most correlated

All computation is on-demand (polling pattern, same as GSEA).

---

## Architecture

### Backend

**New route module:** `backend/app/api/routes/compare.py`

**New service:** `backend/app/services/compare_service.py`

**Endpoints** — all under `/api/sessions/{session_id}/compare/`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/protein-correlation` | POST | Trigger protein correlation compute |
| `/protein-correlation/status` | GET | Poll compute status |
| `/comparison-correlation` | POST | Trigger comparison correlation compute |
| `/comparison-correlation/status` | GET | Poll compute status |
| `/venn` | POST | Compute Venn diagram data for 2-3 comparisons |

**Python dependencies:** scipy (correlation), scikit-learn (PCA), umap-learn (UMAP) — all in requirements.txt

**Results stored at:** `backend/sessions/{session_id}/results/compare/`

### Frontend

**New page:** `frontend/src/app/analysis/visualization/compare/page.tsx`

**New components:**
- `ComparePage` — main page with tabs, controls, compute trigger
- `ProteinCorrelationPanel` — protein-centric tab
- `ComparisonCorrelationPanel` — comparison-centric tab
- `FoldChangeBarChart` — dual-axis bar (log2FC) + dot (-log10 p-value)
- `CorrelationBarChart` — top/bottom 10 horizontal bar chart
- `ClusterMap` — generic PCA/UMAP/tSNE scatter plot (used for both proteins and comparisons)
- `ComparisonHeatmap` — hierarchical clustered heatmap with dendrograms
- `ComparisonSimilarityMatrix` — full N×N comparison correlation heatmap
- `VennDiagram` — 2-3 comparison overlap visualization
- `CorrelationScatter` — pairwise fold change scatter plot (click-through from correlation bars)

**Modified files:**
- `frontend/src/config/visualization-modules.ts` — add Compare module entry
- `frontend/src/lib/api.ts` — add compare API functions
- `frontend/src/app/analysis/visualization/page.tsx` — add "Mark All Significant" button
- `frontend/src/stores/analysis-store.ts` — make marks per-comparison
- `backend/app/api/routes/visualization.py` — update markers to per-comparison storage
- `backend/app/main.py` — mount compare routes

**Reused components:** `SearchableSelect`, `Plot` (Plotly via dynamic import)

---

## Feature Details

### 1. Marked Proteins — Per-Comparison

**Change:** Currently `session.markers` is a flat `string[]`. Change to:
```json
{
  "INCB224525_24h_vs_DMSO_24h": ["P00367", "P49448"],
  "INCB231845_4h_vs_DMSO_24h": ["P00367"]
}
```

**Mark All Significant button:** Added to volcano page header. When clicked, marks all proteins with `significant === true` in the currently selected comparison.

### 2. Protein Correlation Panel

**Controls (top row):**
- `SearchableSelect` — protein selector (gene name + accession, searchable)
- Correlation method dropdown: Pearson | Spearman
- "Run Analysis" button

**Charts (2×2 grid):**
```
┌─────────────────────────┐ ┌─────────────────────────┐
│ Fold Change Bar Chart    │ │ Cluster Map              │
│ - Bar: log2FC per comp   │ │ - PCA/UMAP/tSNE selector │
│ - Dot: -log10(p) overlay │ │ - Color-by comparison dd │
│ - Dual y-axis            │ │ - Selected protein large │
├─────────────────────────┤ ├─────────────────────────┤
│ Top/Bottom 10 Bar Chart  │ │ Correlation Scatter      │
│ - Horizontal bars        │ │ - On click from bar chart│
│ - Gene name labels       │ │ - X=selected, Y=corr     │
│ - Sorted by correlation  │ │ - One dot per comparison │
└─────────────────────────┘ └─────────────────────────┘
```

**Compute inputs:** protein_id, correlation_method, cluster_method, color_comparison

**Compute outputs:**
- `selected_protein_fc`: `{ comparison, logFC, pval, adjPval }[]`
- `correlated_proteins`: `{ accession, gene_name, correlation }[]` (sorted, top 10 + bottom 10 returned)
- `cluster_coords`: `{ accession, gene_name, x, y, cluster_id }` (all proteins, 2D coordinates)
- `cluster_var_explained`: `number` (for PCA)

### 3. Comparison Correlation Panel

**Controls (top row):**
- `SearchableSelect` — primary comparison selector
- Multi-select — add up to 9 more comparisons
- Correlation method dropdown: Pearson | Spearman
- "Run Analysis" button

**Layout (stacked):**
```
┌──────────────────────────────────────────────────────┐
│ Comparison Similarity Matrix (N×N heatmap)             │
│ - All comparisons, hierarchical clustered              │
│ - Colored by correlation coefficient                   │
├──────────────────────────────────────────────────────┤
│ [Venn Diagram]                                         │
│ - Select 2-3 comparisons                              │
│ - Show overlap of significant proteins                 │
│ - Bar chart of set sizes + overlap regions             │
├──────────────────────────────────────────────────────┤
│ Detailed Heatmap                                       │
│ - Selected comparisons (primary + up to 9 more)        │
│ - Proteins: marked in at least one selected comparison │
│ - Colored by fold change, hierarchical clustered       │
├──────────────────────────────────────────────────────┤
│ Top/Bottom 10 Comparison Correlations (bar chart)      │
│ - Horizontal bars, comparison names as labels          │
│ - Sorted by correlation to primary comparison          │
├──────────────────────────────────────────────────────┤
│ Comparison Cluster Map                                 │
│ - PCA/UMAP/tSNE selector                              │
│ - Comparisons as dots, selected comparison larger      │
└──────────────────────────────────────────────────────┘
```

**Compute inputs:** primary_comparison, selected_comparisons[], marked_proteins[], correlation_method, cluster_method

**Venn inputs:** comparisons (2 or 3), significance thresholds (pvalue_threshold, logfc_threshold)

**Compute outputs:**
- `similarity_matrix`: `{ comparisons[], matrix[][] }` (N×N correlation matrix)
- `heatmap_data`: `{ proteins[], comparisons[], fold_changes[][] }` (for detailed heatmap)
- `comparison_correlations`: `{ comparison, correlation }[]` (sorted)
- `cluster_coords`: `{ comparison, x, y }` (2D coordinates)
- `venn_data`: `{ sets: { comparison: string[] }, overlaps: { region: string[], count: number }[] }`

---

## Data Flow

```
User clicks "Run Analysis"
  → POST /compare/protein-correlation (or /comparison-correlation)
  → Backend spawns async compute task
  → Returns { status: "running" }
  → Frontend polls GET /status every 2s
  → On "completed": fetch computed data from compare service
  → Render charts
```

Same polling pattern as GSEA (`getGSEAStatus` → status file → fetch results).

---

## Marking Migration

**Backend:** `updateSessionVisualizationState` currently accepts `markers: string[]`. Update to accept `markers: Record<string, string[]>`.

**Frontend:** `markedProteins` in volcano page changes from `Set<string>` to `Record<string, Set<string>>` keyed by comparison. Session storage endpoint updated accordingly.

**Compatibility:** On load, if old-format flat array detected, migrate to new format with current comparison as key.

---

## Edge Cases

- **Single comparison:** Protein correlation bars show one bar only; comparison correlation panel disabled with message "Need at least 2 comparisons"
- **No marked proteins:** Heatmap falls back to top 100 most significant proteins (by best adj_pval across selected comparisons, filtered by volcano thresholds)
- **Missing DE file:** Skip comparison in correlation matrix, show warning
- **Venn with <2 comparisons:** Disabled, minimum 2 required
- **All proteins marked in heatmap > 500:** Truncate to top 500 by best adj_pval to keep heatmap readable

## Verification

1. **Unit tests:** `Tests/backend/unit/test_compare_service.py` — correlation calculations, matrix assembly
2. **Integration tests:** `Tests/backend/integration/test_compare_api.py` — endpoints, polling flow, error states
3. **E2E:** `Tests/e2e/compare.spec.ts` — full flow: navigate, select protein, run analysis, verify charts render
4. **Manual:** Start backend + frontend, process a multi-condition session, navigate to Compare tab, run both panels
5. **Edge cases:** Single comparison (no correlation possible → show message), no marked proteins, missing DE files
