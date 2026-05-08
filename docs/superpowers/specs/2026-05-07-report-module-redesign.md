# Report Module Redesign

## Summary

Replace the dual-viewer (vanilla JS ZIP template + React weblink) with a single
React-based report viewer. Export copies session result files into a standalone
report directory. The report is a fully functional, independent copy — all
visualization features work without the original session.

## Current Problems

1. **Dual codebase drift**: `report-template.html` (vanilla JS) and
   `[reportId]/page.tsx` (React) are separate implementations of the same tabs.
   The template misses features (GSEA, similarity matrix, BioNet styling) and
   will never match the web app without constant manual sync.

2. **ZIP is a dead end**: A self-contained offline ZIP can't support on-demand
   features (protein info panel, GSEA re-run, protein re-marking) because those
   need the session's result files on disk.

3. **Fragile export flow**: Client-side captures all tab state via multiple API
   calls, assembles a ZIP in the browser, uploads to backend. Multiple points of
   failure.

## Key Design Decisions

1. **Weblink only, no ZIP** — a ZIP can't replicate the on-demand experience.
   The weblink IS the report.

2. **Full file copy at export** — every file the visualization tabs read from
   disk is copied into the report directory. The report is fully independent.
   Deleting the original session has zero impact.

3. **Shared React components** — the report viewer and visualization page use
   the exact same presentational components. Editing a plot updates both.

4. **Report API mirrors session API** — the report has its own endpoints that
   read from the report directory. The report viewer fetches data on load
   exactly like the visualization page (no pre-built snapshot JSON needed).

5. **Single codebase for rendering** — there is no Python/Jinja2/vanillaJS
   rendering code. Only the React components render. The backend only copies
   files and serves them.

## Architecture

```
Export flow:
  User clicks Export → modal asks for name → POST to backend
  Backend copies relevant session files → reports/rpt_abc/
  Backend writes report.json with metadata + config
  Returns { report_id, weblink: "/reports/rpt_abc" }

Viewer flow:
  User opens /reports/rpt_abc
  Report viewer calls report API endpoints (same pattern as visualization page)
  Components receive same prop types, render identically
  On-demand features (protein info, GSEA re-run, BioNet, compare, marking)
    all work via report-scoped API endpoints
```

## What Gets Copied at Export

Every file the visualization endpoints read from disk, verbatim:

```
From session/{sid}/                    → To reports/{rid}/
──────────────────────────────────────────────────────────
results/Diff_Expression_*.tsv          → results/  (all comparisons)
results/Protein_Abundances.tsv         → results/
results/PSM_Abundances.parquet          → results/  (or .tsv fallback)
results/normalization_coefficients.tsv  → results/
results/QC_Results.json                → results/
results/gsea/                          → results/gsea/  (entire tree)
results/compare/                       → results/compare/  (entire tree)
bionet/bionet_subnetwork.json          → bionet/
bionet/bionet_status.json              → bionet/
gsea_run_status.json                   → (root)
```

**Config extracted from `session.json` and stored in `report.json`:**
- `comparisons` (list of group1/group2 pairs)
- `conditions` (list of condition names)
- `experiment_name`
- `treatment` / `control`

**Not copied (not used by any visualization endpoint):**
- `session.json` (config extracted, rest is session-manager metadata)
- `pipeline_state.json` (processing progress, not needed for viewing)
- `uploads/*.csv` (raw PSM files, already processed into results/)
- `results/MSqRob2_Processed.rds` / `MSstats_Processed.rds` (R checkpoints)
- `bionet/nodes.csv` / `bionet/edges.csv` (intermediate, regenerated on re-run)

## Report Directory Structure

```
reports/rpt_abc123/
├── report.json              # metadata + session config
│   ├── report_id, name, session_id, session_name, created_at
│   ├── experiment_name, conditions, comparisons, treatment, control
│   └── state: { markers: {comparison: [accessions]}, volcano_filters: {...} }
├── gsea_run_status.json     # on-demand GSEA tracking
├── results/
│   ├── Diff_Expression_INCB224525_24h_vs_DMSO_24h.tsv
│   ├── Diff_Expression_INCB224525_4h_vs_DMSO_24h.tsv
│   ├── ... (all comparison DE files)
│   ├── Protein_Abundances.tsv
│   ├── PSM_Abundances.parquet
│   ├── normalization_coefficients.tsv
│   ├── QC_Results.json
│   ├── gsea/                        # pre-computed GSEA + re-run output
│   │   └── {comparison}/
│   │       ├── GSEA_Results.json
│   │       ├── go_bp/  (gseapy output files)
│   │       ├── go_cc/
│   │       ├── go_mf/
│   │       ├── kegg/
│   │       └── reactome/
│   └── compare/                     # on-demand comparison correlation
│       ├── protein-correlation_status.json
│       ├── protein-correlation_result.json
│       ├── comparison-correlation_status.json
│       └── comparison-correlation_result.json
└── bionet/
    ├── bionet_subnetwork.json
    └── bionet_status.json
```

## API Contract

### Export Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/sessions/{sid}/reports/generate | Copy files, write report.json, return {report_id, weblink} |

Request body: `{ "name": "My Report" }`

### Report Viewing Endpoints (mirror session visualization endpoints)

All read from `reports/{rid}/` instead of `sessions/{sid}/`.

| Method | Path | Mirrors | Reads from report |
|--------|------|---------|-------------------|
| GET | /api/reports | (list, exists) | report.json files |
| GET | /api/reports/{rid} | — | report.json |
| GET | /api/reports/{rid}/results | GET /{sid}/results | results/Diff_Expression_*.tsv |
| GET | /api/reports/{rid}/qc/plots | GET /{sid}/qc/plots | results/QC_Results.json |
| GET | /api/reports/{rid}/gsea/status | GET /{sid}/gsea/status | gsea_run_status.json |
| POST | /api/reports/{rid}/gsea/run | POST /{sid}/gsea/run | results/Diff_Expression_*.tsv, results/Protein_Abundances.tsv |
| GET | /api/reports/{rid}/gsea/{db} | GET /{sid}/gsea/{db} | results/gsea/{comparison}/GSEA_Results.json |
| GET | /api/reports/{rid}/gsea/{db}/plot | GET /{sid}/gsea/{db}/plot | results/gsea/{comparison}/*.rnk, ~/.cache/gseapy/*.gmt |
| GET | /api/reports/{rid}/gsea/{db}/heatmap | GET /{sid}/gsea/{db}/heatmap | results/Protein_Abundances.tsv |
| POST | /api/reports/{rid}/bionet/run | POST /{sid}/bionet/run | results/Diff_Expression_*.tsv |
| GET | /api/reports/{rid}/bionet/status | GET /{sid}/bionet/status | bionet/bionet_status.json |
| GET | /api/reports/{rid}/bionet/subnetwork | GET /{sid}/bionet/subnetwork | bionet/bionet_subnetwork.json |
| GET | /api/reports/{rid}/protein/{pid}/abundance | GET /{sid}/protein/{pid}/abundance | results/Protein_Abundances.tsv |
| GET | /api/reports/{rid}/protein/{pid}/peptide | GET /{sid}/protein/{pid}/peptide | results/PSM_Abundances.parquet, results/normalization_coefficients.tsv |
| POST | /api/reports/{rid}/compare/protein-correlation | POST /{sid}/compare/protein-correlation | results/Diff_Expression_*.tsv |
| GET | /api/reports/{rid}/compare/protein-correlation/status | — | results/compare/protein-correlation_status.json |
| GET | /api/reports/{rid}/compare/protein-correlation | — | results/compare/protein-correlation_result.json |
| POST | /api/reports/{rid}/compare/comparison-correlation | POST /{sid}/compare/comparison-correlation | results/Diff_Expression_*.tsv |
| GET | /api/reports/{rid}/compare/comparison-correlation/status | — | results/compare/comparison-correlation_status.json |
| GET | /api/reports/{rid}/compare/comparison-correlation | — | results/compare/comparison-correlation_result.json |
| POST | /api/reports/{rid}/compare/venn | POST /{sid}/compare/venn | results/Diff_Expression_*.tsv |
| GET | /api/reports/{rid}/compare/proteins | GET /{sid}/compare/proteins | results/Diff_Expression_*.tsv |
| PATCH | /api/reports/{rid}/visualization-state | PATCH /{sid}/visualization-state | report.json (markers + volcano_filters fields) |
| DELETE | /api/reports/{rid} | (exists) | entire report directory |

### Backend Implementation Strategy

Extract handler logic into shared service functions that take a `data_dir: Path`
parameter. Both session and report route handlers call the same functions with
different base directories.

```
# Before (session routes only):
@router.get("/{session_id}/results")
async def get_results(session_id: str):
    results_dir = sessions_dir / session_id / "results"
    return load_de_results(results_dir, comparison)

# After (shared logic):
# app/services/visualization_service.py
def load_de_results(data_dir: Path, comparison: str | None): ...

# app/api/routes/visualization.py (session routes)
@router.get("/{session_id}/results")
async def get_results(session_id: str):
    return load_de_results(sessions_dir / session_id / "results", ...)

# app/api/routes/reports.py (report routes)
@router.get("/{report_id}/results")
async def get_report_results(report_id: str):
    return load_de_results(reports_dir / report_id / "results", ...)
```

This avoids duplicating any visualization logic. Both route files are thin
wrappers around shared service functions.

### Removed Endpoints

| Method | Path | Reason |
|--------|------|--------|
| POST | /api/sessions/{sid}/export/weblink | Replaced by POST /reports/generate (no ZIP) |
| GET | /api/reports/{rid}/assets/{path} | No more extracted ZIP assets |
| GET | /api/reports/{rid}/download | No more ZIP download |

## Frontend Changes

### Shared Components (already exist, no changes)
- `VolcanoPlot`, `ProteinInfo`, `ProteinTable`, `FilterPanel`
- `QCPlots`, `GSEADashboard`, `GSEAPlot`, `PathwayTable`
- `BioNetNetwork`, `AbundancePlot`

### API Client

Add a `dataSource` concept to the frontend API client. Every function that calls
a session endpoint gets a parallel report variant:

```typescript
// Current: session-scoped
getDEResults(sessionId, opts) → GET /api/sessions/{id}/results
// New: works for both
getDEResults(sourceId, opts) where sourceId can be session or report
```

Or: the report viewer constructs API URLs with `/api/reports/{rid}/` prefix
and uses the same fetch/transform logic. The API client is thin enough that
a parallel set of functions is acceptable.

### Report Viewer Page ([reportId]/page.tsx)

Structure mirrors the visualization page (`analysis/visualization/page.tsx`)
exactly, with these differences:
- Gets `reportId` from URL params instead of `sessionId`
- Fetches metadata from `GET /api/reports/{rid}` for header info + config
- Calls report-scoped API endpoints instead of session-scoped
- No session sidebar or session manager
- Report header (name, date, original session) instead of session nav

### ExportModal

Simplified to a name input + single POST:
1. User enters report name
2. POST to `/api/sessions/{sid}/reports/generate` with `{name}`
3. Backend copies files, returns `{report_id, weblink}`
4. Show the weblink URL with copy button

### To Delete
- `frontend/public/report-template.html` — vanilla JS template
- `frontend/src/lib/html-report-builder.ts` — ZIP assembly, `captureAllStates`, `downloadZip`

## Edge Cases

- **Session deleted after export**: No impact. Report has its own copy of all
  result files. All report endpoints read from the report directory.
- **GSEA not run before export**: Export copies the `results/gsea/` directory
  (may be empty or have partial results). User can run GSEA from the report
  using `POST /api/reports/{rid}/gsea/run`.
- **BioNet not run before export**: Same pattern — copy whatever exists, user
  can trigger from the report.
- **Compare correlation not run before export**: Same — on-demand from report.
- **Session still processing**: Export rejected if session state != "completed".
- **Large sessions**: Report directory mirrors session results (~10-50MB).
  Cleanup on delete recovers space.
- **MSstats vs msqrob2 pipeline**: Both produce the same result file names.
  `normalization_coefficients.tsv` is only produced by msqrob2; peptide endpoint
  handles its absence gracefully (zero normalization factors).
- **GMT cache files**: GSEA plot endpoint reads `~/.cache/gseapy/*.gmt`. These
  are system-wide, not session-scoped, and remain available after session deletion.
