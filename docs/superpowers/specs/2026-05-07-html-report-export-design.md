# HTML Report Export Design

**Date**: 2026-05-07
**Status**: Draft
**Session**: html report

---

## Goal

Abolish PDF export. Replace with self-contained interactive HTML reports. Users click "Export" in the visualization nav bar, enter a name, and choose:
- **Generate Weblink** — upload to backend, get a shareable URL, stored in global report history
- **Download ZIP** — browser downloads a standalone `index.html + assets/` archive

The exported HTML must replicate the visualization experience **exactly** — indistinguishable from the web app. Every interactive element on the visualization pages must be present and functional:

- **Volcano**: Plotly volcano plot + interactive sortable/filterable/paginated ProteinTable + Export CSV button
- **QC**: All 8 Plotly charts in grid
- **GSEA**: Database selector dropdown + bar chart + heatmap + interactive pathway table with CSV export
- **Compare**: Heatmap with dendrograms + condition metadata labels
- **BioNet**: Cytoscape network with node dragging/zooming + protein search bar + edge type filter checkboxes

No session management, no file upload, no processing — just visualizations.

---

## What Gets Deleted

| File | Reason |
|------|--------|
| `backend/app/services/report_generator.py` | Replaced by frontend-side HTML generation |
| `backend/app/services/pdf_converter.py` | PDF is dead |
| `backend/app/services/plot_generator.py` | Static matplotlib plots, unused by anything else |
| `backend/templates/report_template.html` | Jinja2 report template, no longer needed |
| `backend/app/models/analysis.py` — `ReportRequest`, `ReportStatus` classes | Old report request/response models |
| `frontend/src/components/visualization/PDFExport.tsx` | Replaced by ExportButton + ExportModal |
| `backend/app/api/routes/reports.py` — old `generate_report`, `download_report`, `list_reports`, `delete_report` endpoints | Replaced by new endpoints |

---

## New Architecture

### Frontend

```
ExportButton.tsx (replaces PDFExport in nav bar)
  -> ExportModal.tsx (name input + weblink/zip buttons)
    -> html-report-builder.ts (serialize all viz state -> assemble zip Blob)
      -> visualization-modules.ts registry (getExportState per module)

/app/reports/page.tsx (new Reports page, global history)
```

**ExportButton.tsx**
- Small button in the visualization nav bar (where PDFExport currently lives)
- Opens ExportModal on click

**ExportModal.tsx**
- Modal with: text input for report name (required), "Generate Weblink" button, "Download ZIP" button
- Both buttons disabled until name is entered and no generation in progress
- During generation: spinner + progress text, both buttons disabled
- On success:
  - Weblink: shows success message with copyable URL
  - ZIP: triggers browser download
- On failure: shows error reason inline, user can close or retry

**html-report-builder.ts**
- Pure functions, no React dependency
- `captureAllStates(sessionId)`: iterates visualization state registry, calls each module's `getExportState()`. Blocks on any failure, shows which module failed and why.
- `buildZipBlob(exportData, reportName)`: assembles the zip archive using JSZip (new dependency)
  - `index.html` — standalone HTML template with embedded data in `<script type="application/json">`
  - `assets/data.json` — all figure specs, table row data, metadata
  - `assets/plotly.min.js` — Plotly.js bundle (copied from `/public`)
  - `assets/cytoscape.min.js` — Cytoscape.js bundle (copied from `/public`)
- `downloadZip(zipBlob, reportName)`: triggers browser download

**Visualization State Registry** (`visualization-modules.ts` extension)
```typescript
interface VisualizationModule {
  id: string;
  label: string;
  href: string;
  icon: ComponentType;
  supportedTemplates?: string[];
  getExportState?: (sessionId: string) => Promise<ExportState | null>;
  // null = no data for this session, skip tab
}
```
Each visualization page registers its `getExportState` function on mount via `useEffect`. The function returns either the current figure specs (if already rendered) or fetches data from API and computes default specs. This allows export without visiting every tab first.

**Reports Page** (`/reports`)
- Fetches from `GET /api/reports`
- Table columns: Name, Session, Created, Actions (Open Weblink | Download ZIP | Delete)
- Delete has confirmation dialog

**TopNavigation.tsx** — add `{ href: '/reports', label: 'Reports' }` between Home and About

### Backend

```
POST   /api/sessions/{id}/export/weblink   (upload zip + metadata)
GET    /api/reports                         (list all reports)
GET    /api/reports/{report_id}             (serve index.html)
GET    /api/reports/{report_id}/assets/{path} (serve assets)
GET    /api/reports/{report_id}/download    (return export.zip)
DELETE /api/reports/{report_id}             (delete report)
```

**report_store.py**
- CRUD operations over `backend/reports/{report_id}/`
- `report.json`: `{ report_id, name, session_id, session_name, created_at }`
- `export.zip`: original archive (for download endpoint)
- `index.html`, `assets/`: extracted from zip (for weblink serving)
- Accepts uploaded zip, validates it contains `index.html`, extracts to report directory

**Route handlers** (new `reports.py` routes, replacing old ones)
- `POST /export/weblink`: receives multipart (zip file + name), calls report_store.create(), returns report metadata with weblink URL. Removed old report generation logic.
- `GET /reports`: scans all report directories, returns list sorted by created_at desc
- `GET /reports/{id}`: serves `index.html` via FileResponse
- `GET /reports/{id}/assets/{path}`: serves asset files via FileResponse
- `GET /reports/{id}/download`: returns `export.zip` via FileResponse
- `DELETE /reports/{id}`: deletes report directory

### Standalone HTML Template

A single static HTML file (with `<script id="report-data" type="application/json">` approach) that:

1. **Top tab bar** — replicates the web app's tab style. Dynamically generated from `data.tabs` array (only shows tabs that have data).
2. **Tab content areas** — one div per tab, CSS toggled by tab click. All charts pre-initialized but hidden tabs have `display: none`.
3. **Volcano tab** — Plotly volcano plot + interactive protein table with:
   - Sort by column click (ascending/descending)
   - Text search/filter across all columns
   - Pagination (N rows per page)
   - "Export CSV" button that reads the current filtered/sorted view and triggers a browser CSV download
4. **QC tab** — 8 Plotly charts in a grid layout (PCA, p-value dist, PSM CV, protein CV, PSM intensity, protein intensity, completeness, PSM completeness)
5. **GSEA tab** — database dropdown (GO, KEGG, Reactome, etc.), bar chart, heatmap, and interactive pathway table with sorting + CSV export. All data loaded inline; dropdown toggles which database's charts/table are visible.
6. **Compare tab** — Plotly heatmap with dendrograms, condition labels displayed
7. **BioNet tab** — Interactive Cytoscape network with search bar (filter nodes by label text) and edge type filter (checkboxes to toggle edge visibility). Draggable, zoomable, selectable.
8. **Styling** — minimal CSS (system fonts, clean colors, responsive). No Tailwind dependency — just enough CSS for a professional look. Matches the web app's visual language (same background/surface/primary colors).

### data.json Structure

```json
{
  "report": {
    "name": "My Report",
    "session_name": "Experiment A",
    "created_at": "2026-05-07T14:30:00Z"
  },
  "tabs": [
    { "id": "volcano", "label": "Volcano Plot" },
    { "id": "qc", "label": "QC Plots" },
    { "id": "gsea", "label": "GSEA Analysis" },
    { "id": "compare", "label": "Compare" },
    { "id": "bionet", "label": "BioNet" }
  ],
  "volcano": {
    "figureSpec": { "data": [...], "layout": {...} },
    "deTable": {
      "columns": ["Accession", "Description", "logFC", "pValue", "adjPValue", ...],
      "rows": [{ "accession": "...", "logFC": 1.2, ... }, ...]
    },
    "markedProteins": ["P12345"],
    "comparisonLabel": "Treatment vs Control"
  },
  "qc": {
    "plots": {
      "pca": { "data": [...], "layout": {...} },
      "pvalue": { "data": [...], "layout": {...} },
      ...
    }
  },
  "gsea": {
    "databases": ["GO", "KEGG", "Reactome"],
    "results": {
      "GO": {
        "barChart": {...},
        "heatmap": {...},
        "pathwayTable": { "columns": [...], "rows": [...] }
      },
      ...
    }
  },
  "compare": {
    "comparisonLabel": "Condition A vs B",
    "heatmapSpec": { "data": [...], "layout": {...} }
  },
  "bionet": {
    "cytoscapeElements": { "nodes": [...], "edges": [...] },
    "edgeTypes": ["phosphorylation", "binding", ...]
  }
}
```

### State Capture Strategy

**Figures**: Refactor generation logic out of visualization components into shared pure functions:

```
lib/figures/volcano-figure.ts    buildVolcanoFigure(deData, filters) => PlotlySpec
lib/figures/qc-figures.ts        buildPCAFigure(qcData) => PlotlySpec, etc.
lib/figures/gsea-figures.ts      buildGSEABarChart(gseaResult) => PlotlySpec
lib/figures/compare-figure.ts    buildCompareHeatmap(data) => PlotlySpec
lib/figures/bionet-graph.ts      buildBioNetGraph(elements, edgeTypes) => CytoState
```

Components call these functions to render. The export builder also calls them to get specs for tabs not yet visited. This is zero-duplication — the figure functions are the single source of truth.

**Tables**: Full row data for the protein table (volcano) and pathway tables (GSEA) is captured from the API responses the components already fetch. The standalone HTML implements its own sort/filter/paginate/CSV logic in vanilla JS — no React dependency.

Components that have been visited also expose their live state (with user interactions like zoom state, table sort order) through the registry. The export builder prefers live state when available, falls back to computed default.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Serialization fails for a module | Block export, show "Failed to capture [Module]: [reason]" in modal |
| ZIP assembly fails | Show error with suggestion to try weblink |
| Weblink upload fails (network) | Show error with retry button |
| Server returns error on upload | Display server error message inline |
| ZIP very large (500MB+) | Weblink upload may be slow; show progress bar |
| Session not completed | Export button hidden/disabled |
| Report directory doesn't exist | Return empty list from GET /api/reports |
| Report not found on delete | Return 404 |
| Report not found on serve | Return 404 |

---

## Migration Steps

1. Delete old code: `report_generator.py`, `pdf_converter.py`, `plot_generator.py`, `report_template.html`, `PDFExport.tsx`, old report models, old report endpoints
2. Extract figure-generation functions from visualization components into `lib/figures/`
3. Add `getExportState` to each visualization module in `visualization-modules.ts`
4. Build `html-report-builder.ts` with zip assembly
5. Build `ExportModal.tsx` and `ExportButton.tsx`
6. Build standalone HTML template with full table interactivity
7. Build `report_store.py` and new backend routes
8. Build `/reports` page and add to TopNavigation
9. Add `plotly.min.js`, `cytoscape.min.js` to `frontend/public/` for bundling
10. Add JSZip dependency to frontend
11. Remove old PDF-related dependencies if no longer needed (playwright, jinja2 if unused)
12. Write tests (backend unit/integration, frontend E2E)
13. Update `about/page.tsx` text that mentions "PDF report"

---

## Risks

| Risk | Mitigation |
|------|------------|
| ZIP file size | User accepts large packages for "exact same" experience. Weblink uploads show progress; zip downloads are client-side and instant after assembly. |
| Plotly spec serialization misses annotations | Test every chart type; fallback to `Plotly.toImage()` if spec capture fails for a specific chart |
| Standalone HTML needs web fonts | Use system font stack; no external font CDN |
| Old PDF report links break | Acceptable — user explicitly wants abolition |
| Future modules not registered | Module author adds `getExportState` — documented in visualization-modules.ts |
| Weblink lifetime unbounded | Initial: no auto-deletion. Reports page allows manual deletion. Add TTL later if disk becomes an issue. |
| Table JS in standalone HTML | Vanilla JS sort/filter/paginate — keep it minimal, no framework. Test against real DE tables (up to 10k rows). |
