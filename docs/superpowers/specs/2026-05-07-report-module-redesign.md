# Report Module Redesign

## Summary

Replace the dual-viewer (vanilla JS ZIP template + React weblink) with a single
React-based report viewer. Export copies the session directory (minus a few
excluded files) into a standalone report directory. The report is a fully
functional, independent copy — all visualization features work without the
original session.

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

2. **Copy-almost-everything at export** — the session directory is copied to
   the report directory, excluding only files the visualization page never
   reads. Any new file a future feature produces is automatically included.

3. **Shared React components** — the report viewer and visualization page use
   the exact same presentational components. Editing a plot updates both.

4. **Report API mirrors session API** — the report has its own endpoints that
   read from the report directory. Handler logic is extracted into shared
   service functions; route files are thin wrappers.

5. **No rendering code outside React** — there is no Python/Jinja2/vanillaJS
   rendering. Only React components render. The backend only copies files and
   serves them.

## Architecture

```
Export flow:
  User clicks Export → modal asks for name → POST to backend
  Backend copies session directory (minus exclusions) → reports/rpt_abc/
  Backend adds report.json with metadata
  Returns { report_id, weblink: "/reports/rpt_abc" }

Viewer flow:
  User opens /reports/rpt_abc
  Report viewer calls report API endpoints
  Components receive same prop types as visualization page, render identically
  On-demand features (protein info, GSEA re-run, BioNet, compare, marking)
    all work via report-scoped API endpoints reading the report's own files
```

## What Gets Copied at Export

**Strategy: blacklist, not whitelist.** The entire session directory is copied
except for explicitly excluded paths. New files produced by future features are
automatically included.

**Copy everything under `sessions/{sid}/` → `reports/{rid}/` EXCEPT:**

| Excluded path | Reason |
|---------------|--------|
| `uploads/` | Raw PSM CSV files (~100MB+). All data has been processed into `results/`. |
| `pipeline_state.json` | Processing progress tracking. Not used for viewing. |

Everything else comes along: `session.json` (config, markers, filters),
`results/` (all DE files, abundance matrices, QC, GSEA, compare),
`bionet/` (subnetwork, status), `gsea_run_status.json`.

**Why `session.json` is copied as-is:** it contains the session config
(comparisons, conditions, experiment name) that the visualization page needs.
It also contains markers and volcano filters. If a future feature stores new
config in session.json, it's automatically available in the report.

## Report Directory Structure

Effectively a mirror of the session directory with `report.json` added:

```
reports/rpt_abc123/
├── report.json              # {report_id, name, session_id, session_name, created_at}
├── session.json             # copied as-is (config, markers, filters)
├── gsea_run_status.json     # on-demand GSEA tracking
├── results/
│   ├── Diff_Expression_*.tsv        # one per comparison
│   ├── Protein_Abundances.tsv
│   ├── PSM_Abundances.parquet
│   ├── normalization_coefficients.tsv
│   ├── QC_Results.json
│   ├── gsea/{comparison}/           # GSEA results per comparison
│   └── compare/                     # on-demand correlation results
└── bionet/
    ├── bionet_subnetwork.json
    └── bionet_status.json
```

Note: `results/MSqRob2_Processed.rds` and `bionet/nodes.csv` are also copied
(since they're not in the exclusion list). They're harmless — unused by any
endpoint but small enough not to matter.

## API Contract

### Export Endpoint

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/sessions/{sid}/reports/generate | Copy files, write report.json, return {report_id, weblink} |

Request body: `{ "name": "My Report" }`

### Report Viewing Endpoints

All read from `reports/{rid}/` instead of `sessions/{sid}/`.

| Method | Path | Mirrors session endpoint |
|--------|------|--------------------------|
| GET | /api/reports | (exists) |
| GET | /api/reports/{rid} | — (returns report.json + session.json) |
| GET | /api/reports/{rid}/results | GET /{sid}/results |
| GET | /api/reports/{rid}/qc/plots | GET /{sid}/qc/plots |
| GET | /api/reports/{rid}/gsea/status | GET /{sid}/gsea/status |
| POST | /api/reports/{rid}/gsea/run | POST /{sid}/gsea/run |
| GET | /api/reports/{rid}/gsea/{db} | GET /{sid}/gsea/{db} |
| GET | /api/reports/{rid}/gsea/{db}/plot | GET /{sid}/gsea/{db}/plot |
| GET | /api/reports/{rid}/gsea/{db}/heatmap | GET /{sid}/gsea/{db}/heatmap |
| POST | /api/reports/{rid}/bionet/run | POST /{sid}/bionet/run |
| GET | /api/reports/{rid}/bionet/status | GET /{sid}/bionet/status |
| GET | /api/reports/{rid}/bionet/subnetwork | GET /{sid}/bionet/subnetwork |
| GET | /api/reports/{rid}/protein/{pid}/abundance | GET /{sid}/protein/{pid}/abundance |
| GET | /api/reports/{rid}/protein/{pid}/peptide | GET /{sid}/protein/{pid}/peptide |
| POST | /api/reports/{rid}/compare/protein-correlation | POST /{sid}/compare/protein-correlation |
| GET | /api/reports/{rid}/compare/protein-correlation/status | GET /{sid}/compare/protein-correlation/status |
| GET | /api/reports/{rid}/compare/protein-correlation | GET /{sid}/compare/protein-correlation |
| POST | /api/reports/{rid}/compare/comparison-correlation | POST /{sid}/compare/comparison-correlation |
| GET | /api/reports/{rid}/compare/comparison-correlation/status | GET /{sid}/compare/comparison-correlation/status |
| GET | /api/reports/{rid}/compare/comparison-correlation | GET /{sid}/compare/comparison-correlation |
| POST | /api/reports/{rid}/compare/venn | POST /{sid}/compare/venn |
| GET | /api/reports/{rid}/compare/proteins | GET /{sid}/compare/proteins |
| PATCH | /api/reports/{rid}/visualization-state | PATCH /{sid}/visualization-state |
| DELETE | /api/reports/{rid} | (exists) |

### Backend Implementation

Handler logic is extracted into shared service functions that take a
`data_dir: Path` parameter. Both session and report route handlers call the
same functions with different base directories.

```
# Shared service (app/services/visualization_service.py):
def load_de_results(data_dir: Path, comparison: str | None) -> dict: ...

# Session route (app/api/routes/visualization.py):
@router.get("/{session_id}/results")
async def get_results(session_id: str):
    return load_de_results(sessions_dir / session_id / "results", comparison)

# Report route (app/api/routes/reports.py):
@router.get("/{report_id}/results")
async def get_report_results(report_id: str):
    return load_de_results(reports_dir / report_id / "results", comparison)
```

Each report route is exactly one function call. Zero logic duplication.

### Adding a New Visualization Feature

When a future visualization tab needs a new endpoint and a new result file,
here is everything required to support it in reports:

1. **Result file**: Nothing. It's automatically copied (blacklist exclusion).
2. **Config in session.json**: Nothing. session.json is copied as-is.
3. **Backend endpoint**: Add a thin report route (one line) that calls the
   same shared service function the session route calls.
4. **Frontend**: The report viewer page calls the new report endpoint by
   constructing the URL with the report ID — same pattern as every other call.

No manual lists to update. No risk of silent breakage.

### Removed Endpoints

| Method | Path | Reason |
|--------|------|--------|
| POST | /api/sessions/{sid}/export/weblink | Replaced by POST /reports/generate (no ZIP) |
| GET | /api/reports/{rid}/assets/{path} | No more extracted ZIP assets |
| GET | /api/reports/{rid}/download | No more ZIP download |

## Frontend Changes

### Component API Strategy

Several shared components (`ProteinInfo`, `GSEAPlot`, `ComparisonCorrelationPanel`,
`ProteinCorrelationPanel`) currently take `sessionId` as a prop and hardcode
session-scoped API calls internally. For the report viewer, these must call
report-scoped endpoints instead.

**Solution: React Context for API prefix.** A single context provides the API
base path. The visualization page sets it to `/api/sessions/{sid}`; the report
viewer sets it to `/api/reports/{rid}`. Components read from context instead
of accepting `sessionId`.

```
ApiProvider              ← new context component
├── Visualization page   ← <ApiProvider value="/api/sessions/{sid}">
│   └── ProteinInfo      ← reads apiPrefix from context
│   └── GSEAPlot         ← reads apiPrefix from context
│   └── ComparePanels    ← reads apiPrefix from context
│
├── Report viewer page   ← <ApiProvider value="/api/reports/{rid}">
│   └── ProteinInfo      ← same component, calls report endpoints now
│   └── GSEAPlot         ← same component, calls report endpoints now
│   └── ComparePanels    ← same component, calls report endpoints now
```

The affected components are refactored once to use the context. After that,
adding a new visualization feature that makes API calls just uses the context
— it automatically works for both session and report.

### Presentational Components (already pure, no changes)

- `VolcanoPlot`, `ProteinTable`, `FilterPanel`
- `QCPlots`, `GSEADashboard`, `PathwayTable`
- `BioNetNetwork`, `AbundancePlot`

### Report Viewer Page ([reportId]/page.tsx)

Complete rewrite. The current page has its own inline component implementations
(VolcanoTab, QCTab, GSEATab, etc.) that render from pre-computed Plotly figure
specs. Replaced by a thin shell that:
- Gets `reportId` from URL params
- Fetches metadata from `GET /api/reports/{rid}` (report.json + session.json)
- Wraps content in `<ApiProvider value="/api/reports/{rid}">`
- Renders tabs using the same components as the visualization page
- No session sidebar or session manager
- Report header (name, date, original session name) instead of session nav

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

- **Session deleted after export**: No impact. Report has its own copy of all files.
- **GSEA/BioNet/Compare not run before export**: Their output directories are
  copied (may be empty or partial). User can trigger them from the report.
- **Session still processing**: Export rejected if session state != "completed".
- **Large sessions**: Report directory size is similar to session results
  (~10-50MB typical, since raw uploads are excluded). Deletion recovers space.
- **MSstats vs msqrob2 pipeline**: Both produce the same result file names.
  `normalization_coefficients.tsv` is only produced by msqrob2; peptide endpoint
  handles its absence gracefully.
- **GMT cache files**: `~/.cache/gseapy/*.gmt` are system-wide, not session-scoped.
  Available after session deletion.
