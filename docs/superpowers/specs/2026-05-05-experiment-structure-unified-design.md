# Unified Experiment Structure Panel

## Summary

Merge the "Experiment Structure" panel (Upload page: file table with
experiment/condition/replicate badges) and the "Condition Metadata" panel
(Comparisons page: custom metadata columns and per-file value editing) into a
single "Experiment Structure" panel on the Upload page. Add CSV import/export
for metadata. Remove the Condition Metadata section from the Comparisons page.
Remove the Sample Metadata grid from ConfigPanel. Add a new read-only Summary
page between Config and Processing to review all choices before analysis starts.

---

## App Flow

```
Upload → Pipeline → Comparisons → Config → Summary → Processing → Results
```

- **Upload**: Unified Experiment Structure panel (full metadata editing)
- **Pipeline**: Unchanged
- **Comparisons**: Comparison Builder + Covariates only (no metadata section)
- **Config**: Analysis parameters only (no metadata grid)
- **Summary**: NEW — read-only review of all choices, "Start Analysis" trigger
- **Processing**: Unchanged

---

## 1. Unified Experiment Structure Panel (ExperimentTable.tsx)

### Table Layout

Columns (left to right):
1. Checkbox (select file)
2. Filename (sortable, shows file size below name)
3. Experiment (sortable, click-to-edit badge, existing EditableBadge)
4. Condition (sortable, click-to-edit badge, existing EditableBadge)
5. Replicate (sortable, numeric display)
6. [custom col 1] (sortable only by filename-indexed values, header: click-to-rename, hover shows X to delete)
7. [custom col 2] ...
8. Actions (X button to remove file)

Custom column cells are text inputs. onChange updates `metadata_columns` in the
analysis store via `setConfig`.

### Column Manager Bar (above table, above filter/search bar)

```
[New column name input] [Add Column] | [Import CSV] [Export CSV] | [Search...] [Exp filter] [Cond filter]
```

- **Add Column**: Adds a new empty column to `metadata_columns` for every file.
  Validates name is unique.
- **Import CSV**: Opens file picker (`.csv`). Parses with FileReader. First
  column must be `filename`. Merges by filename — if a filename matches an
  uploaded file, the row values are merged into `metadata_columns`. New columns
  from the CSV headers are auto-added. Non-matching filenames are ignored.
- **Export CSV**: Builds a CSV from `metadata_columns` + file data
  (filename, experiment, condition, replicate, then all custom columns). Triggers
  a browser download as `experiment_structure.csv`.

### Auto-Population

When `metadata_columns` is empty and files exist, auto-populate on mount:
```ts
{ filename: { experiment: f.experiment, condition: f.condition, replicate: String(f.replicate) } }
```
This replaces the auto-population currently on the Comparisons page mount.

### Syncing

Editing Experiment or Condition via the existing EditableBadge calls
`updateFileMetadata()` (which updates the file object) AND also updates the
corresponding entry in `metadata_columns` so both stay in sync. Custom column
edits go directly to `metadata_columns` via `setConfig`.

---

## 2. Comparisons Page Simplification (comparisons/page.tsx)

Remove (lines 317-408):
- The entire "Condition Metadata" section (SECTION 1)
- The `useEffect` that auto-populates `metadata_columns` on mount
- Metadata editing state: `newColName`, `editingColName`, `editColValue`
- Metadata editing functions: `addColumn`, `startRenameColumn`,
  `finishRenameColumn`, `removeColumn`, `updateCell`

Keep (unchanged):
- Comparison Builder (condition palette, drop zones, add comparison)
- Covariates section (MSstats only)
- Navigation (Back to Pipeline / Continue to Config)

The condition palette cards still derive from `config.metadata_columns` in the
store (populated on the Upload page).

---

## 3. Config Page Changes (config/page.tsx + ConfigPanel.tsx)

### ConfigPanel.tsx

Remove the Sample Metadata grid (lines 292-393 under
`template === "multi_condition_comparison"`).

Keep:
- Analysis configuration (treatment/control, organism, razor, filtering)
- Comparison matrix checkboxes
- MSstats parameters (if MSstats pipeline)
- Configuration summary

### config/page.tsx

- "Start Analysis" button → "Continue to Summary" button
- On click: save config via `sessionsApi.updateConfig`, then navigate to
  `/new/summary?session=${sessionId}`
- Remove the Experiment Summary section (lines 201-224) — superseded by
  the Summary page

---

## 4. New Summary Page (NEW: /new/summary/page.tsx)

A read-only review page before processing. Navigation: Back (to Config) |
Start Analysis (begins processing).

### Sections

| Section | Source | Display |
|---------|--------|---------|
| Pipeline | `selectedPipeline` | Badge (msqrob2 / MSstats) |
| Files | `uploadedFiles` | Count, total size, file list |
| Experiment Structure | `metadata_columns` + `uploadedFiles` | Read-only table: filename, experiment, condition, replicate, custom columns |
| Comparisons | `config.comparisons` | Group A vs Group B formatted list |
| Configuration | `config` | Organism, Remove Razor, Strict Filtering |
| MSstats Params | `config` (conditional) | Only if pipeline is MSstats; summary of MSstats settings |
| Covariates | `config.covariate_columns` | Only if MSstats and covariates selected |

### Navigation

- **Back**: `/new/config?session={sessionId}`
- **Start Analysis**: Final save of config via `sessionsApi.updateConfig`, then
  POST `/api/sessions/{id}/process` via `processingApi.start`, then navigate to
  `/analysis/processing?session_id={sessionId}&pipeline={selectedPipeline}`
  (same logic currently in Config page's `handleStartAnalysis`)

---

## Data Flow

```
Upload Page (ExperimentTable)
  │
  │  metadata_columns written to analysisStore.config
  │
  ├──► Comparisons Page
  │      reads metadata_columns → derives condition palette cards
  │
  ├──► Config Page
  │      (no longer reads metadata_columns)
  │
  └──► Summary Page
         reads metadata_columns + config + uploadedFiles
         (read-only display, no edits)
```

---

## Files Affected

| File | Action |
|------|--------|
| `frontend/src/components/analysis/ExperimentTable.tsx` | Expand: add custom columns, CSV import/export, auto-populate metadata_columns |
| `frontend/src/app/new/comparisons/page.tsx` | Remove: Condition Metadata section, auto-populate logic, metadata editing state/functions |
| `frontend/src/components/analysis/ConfigPanel.tsx` | Remove: Sample Metadata grid (lines 292-393) |
| `frontend/src/app/new/summary/page.tsx` | **NEW**: Read-only summary page |
| `frontend/src/app/new/config/page.tsx` | Update: Continue button now navigates to summary instead of processing |
| `frontend/src/stores/analysis-store.ts` | May need minor adjustments for metadata_columns initialization |
