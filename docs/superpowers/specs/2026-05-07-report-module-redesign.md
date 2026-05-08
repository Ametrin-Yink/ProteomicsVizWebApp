# Report Module Redesign

## Summary

Replace the dual-viewer (vanilla JS ZIP template + React weblink) with a single
React-based report viewer. Export copies session results into a standalone report
directory. The report is a fully functional copy — all visualization features work
independently of the original session.

## Current Problems

1. **Dual codebase drift**: `report-template.html` (vanilla JS) and
   `[reportId]/page.tsx` (React) are separate implementations of the same tabs.
   The template misses features (GSEA, similarity matrix, BioNet styling) and
   will never match the web app without constant manual sync.

2. **ZIP is a dead end**: A self-contained offline ZIP can't support on-demand
   features (protein info panel, GSEA re-run, protein re-marking) because those
   need the session's source data.

3. **Fragile export flow**: Client-side captures all tab state via multiple API
   calls, assembles a ZIP in the browser, uploads to backend. Multiple points of
   failure.

## Key Design Decisions

1. **Weblink only, no ZIP** — a ZIP can't replicate the on-demand experience.
   The weblink IS the report.

2. **Server-side capture** — backend reads session results from disk (single
   operation, no network round-trips) and copies them into the report directory.

3. **Full data copy at export** — all files needed by visualization tabs are
   copied. The report is fully independent. Deleting the original session has
   zero impact.

4. **Shared React components** — the report viewer and visualization page use
   the exact same components. Editing a plot updates both.

## Architecture

```
Export flow:
  User clicks Export → modal asks for name → POST to backend
  Backend copies session/results/ → reports/rpt_abc/results/
  Backend builds data.json snapshot, writes report.json
  Returns {report_id, weblink: "/reports/rpt_abc"}

Viewer flow:
  User opens /reports/rpt_abc
  Report viewer loads data.json for instant first paint
  All on-demand features work via /api/reports/{rid}/... endpoints
  State (markers, filters) persisted to report's state.json
```

## Report Directory Structure

```
reports/rpt_abc123/
├── report.json          # {report_id, name, session_id, session_name, created_at}
├── data.json            # snapshot for first paint (all tab data)
├── state.json           # report-scoped mutable state (markers, filters)
└── results/             # copied from session/results/ at export time
    ├── de_results.json
    ├── qc_metrics.json
    ├── gsea/            # pre-computed GSEA results per database
    ├── protein_abundance/
    ├── comparison_correlation.json
    └── bionet_subnetwork.json
```

## API Contract

### New / Modified Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/sessions/{sid}/reports/generate | Copy session results → report, build snapshot, return weblink |
| GET | /api/reports | List all reports (exists) |
| GET | /api/reports/{rid} | Serve data.json (changed: was index.html) |
| GET | /api/reports/{rid}/protein/{pid}/abundance | Protein abundance from report's copy |
| GET | /api/reports/{rid}/protein/{pid}/peptide | Peptide data from report's copy |
| PUT | /api/reports/{rid}/state | Save markers/filters to state.json |
| POST | /api/reports/{rid}/gsea/{db} | Run GSEA against report's data |
| GET | /api/reports/{rid}/gsea/{db} | GSEA results from report's copy |
| DELETE | /api/reports/{rid} | Delete report and all files (exists) |

### Removed Endpoints

| Method | Path | Reason |
|--------|------|--------|
| POST | /api/sessions/{sid}/export/weblink | Replaced by /reports/generate (no ZIP upload) |
| GET | /api/reports/{rid}/assets/{path} | No more extracted ZIP assets |
| GET | /api/reports/{rid}/download | No more ZIP download |

## Component Plan

### Already Shared (no changes needed)
- VolcanoPlot, ProteinInfo, ProteinTable, FilterPanel
- QCPlots, GSEADashboard, GSEAPlot, PathwayTable
- BioNetNetwork, AbundancePlot

### To Extract / Create
- Tab container components (VolcanoTab, QCTab, GSEATab, CompareTab, BioNetTab)
  encapsulate state management so both pages just render `<VolcanoTab sessionId={id} />`

### To Rewrite
- `[reportId]/page.tsx` — thin shell: header + tab bar + tab routing, ~150 lines
- `ExportModal.tsx` — name input + single POST, no client-side capture logic

### To Delete
- `report-template.html` — the vanilla JS template
- `html-report-builder.ts` — ZIP assembly, captureAllStates, downloadZip

## Backend Changes

- New: `app/services/report_generator.py` — copy session results, build snapshot
- Rewrite: `app/services/report_store.py` — remove ZIP extraction, add state management
- Rewrite: `app/api/routes/reports.py` — new endpoints, remove old ones

## Edge Cases

- **Session deleted after export**: No impact. Report has its own copy of all data.
- **GSEA not run before export**: Export still copies whatever GSEA results exist.
  User can run GSEA from the report using the report's GSEA endpoint.
- **Large sessions**: Report directory mirrors session results size (~10-50MB typical).
  Cleanup on report deletion recovers the space.
- **Session still processing**: Export is rejected if session.state != "completed".
