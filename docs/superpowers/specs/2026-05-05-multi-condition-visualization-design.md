# Multi-Condition Visualization Support — Design Spec

**Date:** 2026-05-05
**Status:** Approved
**Scope:** Adapt visualization layer from pairwise (single comparison) to multi-condition (N comparisons)

## Problem

The data processing pipeline (Step 7) correctly generates per-comparison `Diff_Expression_<label>.tsv` files for N comparisons. However, the visualization layer was built assuming a single pairwise comparison. Key failures:

1. **Volcano page comparison selector is broken** — type mismatch between backend comparison format (`{group1: Record<string,string>, group2: Record<string,string>}`) and frontend expectation (`{treatment: string, control: string}`). Selecting a comparison passes `undefined_vs_undefined` to the API.
2. **GSEA page has no comparison awareness** — always shows pipeline results from the first comparison only, with no way to switch or run GSEA for other comparisons.
3. **Pipeline Steps 8-9 process only the first comparison** — `_resolve_de_output()` picks one DE file instead of iterating all comparisons.
4. **Visualization components hardcode pairwise labels** — axis titles say "Treatment/Control", colors are two-color only, export filenames use treatment_vs_control.

## Architecture Decision

- **QC (Step 8):** Iterate all comparisons during pipeline (cheap — just histogram binning). Store per-comparison p-value distributions in `QC_Results.json`.
- **GSEA (Step 9):** Remove from pipeline entirely. All GSEA is on-demand via `POST /gsea/run` (already exists). This avoids pipeline slowdown from expensive enrichment analysis.
- **Comparison label contract:** Both frontend (`formatGroup`) and backend (`_build_label`) join group values with `+`. File identifier: `{label}_vs_{label}`. Display: `{label} vs {label}`.

## Scope — 13 files changed, 0 new

### Frontend (9 files)

| File | Change |
|------|--------|
| `visualization/page.tsx` | Fix comparison type + label construction |
| `visualization/gsea/page.tsx` | Add comparison selector + Run GSEA button |
| `visualization/qc/page.tsx` | Add comparison selector for p-value section, generalise condition handling |
| `components/visualization/VolcanoPlot.tsx` | Accept `comparisonLabel` prop, fix axis/legend |
| `components/visualization/ProteinTable.tsx` | Use `comparisonLabel` in export filename |
| `components/visualization/QCPlots.tsx` | Dynamic color palette, per-comparison p-value distribution |
| `components/visualization/AbundancePlot.tsx` | Dynamic color palette for N conditions |
| `lib/api.ts` | Fix `getSession()` comparison type |
| `types/api.ts` | Make `treatment`/`control` optional, add `pvalue_distributions` to `QCData` |

### Backend (4 files)

| File | Change |
|------|--------|
| `services/steps/qc_metrics.py` | Iterate all comparisons for p-value distributions |
| `services/steps/gsea_analysis.py` | No change (step removed from pipeline, file kept for reference) |
| `services/pipeline_registry.py` | Remove step 9 (GSEA) from both pipeline templates |
| `services/qc_calculator.py` | Accept multiple DE files for p-value aggregation |
| `api/routes/visualization.py` | Add `?comparison=` to `GET /gsea/{db}` listing |

## Comparison Label Contract

Both sides must produce identical comparison identifiers:

```
Backend _build_label(group):  join values with "+"  → "DrugA" or "Drug+High"
Frontend formatGroup(group):  join values with "+"  → "DrugA" or "Drug+High"

File identifier:  formatGroup(g1) + "_vs_" + formatGroup(g2)    → "DrugA_vs_Control"
Display label:    formatGroup(g1) + " vs "  + formatGroup(g2)    → "DrugA vs Control"
API query param:  encodeURIComponent(file_identifier)            → "DrugA_vs_Control" or "Drug%2BHigh_vs_Control"
```

Multi-key groups (e.g., `{Condition: "DrugA", Dose: "High"}`) produce labels like `DrugA+High_vs_Control`. The `+` must be URL-encoded when passed as a query parameter.

## Section Details

### 1. Volcano Page Fix (`visualization/page.tsx`)

**Root cause:** Line 22 types comparisons as `{ treatment: string; control: string }[]` but the backend returns `{ group1: Record<string,string>; group2: Record<string,string> }[]`. Accessing `.treatment`/`.control` returns `undefined`.

**Fix:**
- Line 22: Change type to `Array<{ group1: Record<string, string>; group2: Record<string, string> }>`
- Line 89: Build value: `formatGroup(first.group1) + "_vs_" + formatGroup(first.group2)`
- Lines 287-301: Display labels using `formatGroup(c.group1) + " vs " + formatGroup(c.group2)`
- `api.ts` line 58: Fix `getSession` return type to use correct comparison shape

### 2. GSEA Page (`visualization/gsea/page.tsx`)

Add comparison selector + explicit "Run GSEA" button:

- **Comparison selector:** Same dropdown/button pattern as volcano page, populated from `session.config.comparisons`
- **Run GSEA area:** Database checkboxes (GO-BP, GO-MF, GO-CC, KEGG, Reactome) with "Select All" toggle. Optional advanced controls: min size, max size, permutations (collapsed by default)
- **State management:** On comparison change, check if results exist (try `GET /gsea/{db}?comparison=...`). If yes, show them. If no, show "No GSEA results for this comparison" with the Run button.
- **API calls:** Pass `comparison` to `getGSEAData`, `getGSEAPlotData`, `getGSEAHeatmapData`
- **On run:** Call `POST /gsea/run` with the selected comparison and databases. Show progress indicator (the endpoint is synchronous and may take time). On completion, re-fetch and display results.

### 3. QC Page (`visualization/qc/page.tsx`)

- Remove hardcoded `treatment`/`control` fetch from session config
- Use the full conditions list extracted from the session's file metadata
- **P-value distribution section:** Add comparison selector above this section only. Fetch QC data with `?comparison=` parameter. PCA, CV, intensity, and completeness sections are unaffected (condition-level data).
- Pass condition list (not just treatment/control) to `QCPlots` component

### 4. Visualization Component Fixes

**VolcanoPlot.tsx:**
- New required prop: `comparisonLabel: string` (e.g., "DrugA vs Control")
- X-axis title: `` `log2(${comparisonLabel})` `` instead of `'log(Treatment/Control)'`
- Legend: `` `Upregulated (${group1} > ${group2})` `` and `` `Downregulated (${group2} > ${group1})` ``
- Split `comparisonLabel` on " vs " to extract group1/group2 names for legend, or accept separate `group1Label`/`group2Label` props

**ProteinTable.tsx:**
- Accept `comparisonLabel` prop (optional, falls back to "Treatment_vs_Control")
- CSV export filename: `${experiment}_${comparisonLabel}.csv`

**QCPlots.tsx + AbundancePlot.tsx:**
- Replace hardcoded two-color map with a dynamic palette
- Use a consistent 10-color palette (Tableau-10). Assign colors to conditions in first-appearance order.
- `getConditionColor(condition, conditionList)` — deterministic mapping from condition name to palette index

### 5. Backend — QC Step 8

**`qc_calculator.py`:**
- Change `_calculate_pvalue_distribution` to accept a list of DE file paths
- Compute one `PValueDistribution` per file, keyed by comparison label
- Extract comparison label from filename: strip `Diff_Expression_` prefix and `.tsv` suffix
- Store as `pvalue_distributions: Record<string, PValueDistribution>` in output JSON

**`qc_metrics.py`:**
- Replace `_resolve_de_output(ctx)` with glob: `ctx.results_dir.glob("Diff_Expression_*.tsv")`
- Pass all files to `qc_calculator`

**`visualization.py` (QC endpoint):**
- Add optional `comparison: str = Query("")` parameter to `GET /qc/plots`
- When provided, filter `pvalue_distributions` to the requested comparison
- When empty, return all distributions (for the frontend to select from)

### 6. Backend — GSEA Pipeline Removal

**`pipeline_registry.py`:**
- Remove `step_gsea_analysis` from `MULTI_CONDITION` template (step 9 becomes absent)
- Remove from `MSSTATS` template as well
- Pipeline now has 8 steps instead of 9

**`visualization.py` (GSEA listing endpoint):**
- Add `comparison: str = Query("")` parameter to `GET /gsea/{db}`
- When provided, load from `results/gsea/{comparison}/GSEA_Results.json`
- When empty, load from `results/GSEA_Results.json` (legacy/pipeline) for backward compatibility

### 7. Types Cleanup

**`types/api.ts`:**
- `SessionConfig.treatment`: `string` → `string | undefined`
- `SessionConfig.control`: `string` → `string | undefined`
- `QCData`: Add `pvalue_distributions?: Record<string, PValueDistribution>`

**`types/index.ts`:**
- Mirror same optional changes

## Data Flow

```
Pipeline Run:
  Step 7 → N × Diff_Expression_<label>.tsv
  Step 8 → QC_Results.json (pvalue_distributions keyed by comparison label)
  (Step 9 removed — GSEA not in pipeline)

User clicks comparison on Volcano page:
  GET /results?comparison=DrugA_vs_Control
  → loads Diff_Expression_DrugA_vs_Control.tsv
  → VolcanoPlot with comparisonLabel="DrugA vs Control"

User clicks comparison on QC page:
  GET /qc/plots?comparison=DrugA_vs_Control
  → returns QC data with pvalue_distribution for that comparison

User clicks "Run GSEA" on GSEA page:
  POST /gsea/run { comparison: "DrugA_vs_Control", databases: ["go_bp", "kegg"] }
  → runs gseapy, writes results/gsea/DrugA_vs_Control/GSEA_Results.json
  → User clicks a database tab:
    GET /gsea/go_bp?comparison=DrugA_vs_Control
    → loads per-comparison GSEA results
```

## Out of Scope

- PDF reports — will be replaced by HTML reports in a future task
- Protein abundance endpoint label generalization — defer
- Legacy `ConfigPanel.tsx` pairwise UI — being replaced by new wizard flow, no changes
- Step 9 `gsea_analysis.py` deletion — keep file for reference, just remove from registry

## Verification

- Comparison selector on volcano page renders buttons for all comparisons, clicking switches data
- VolcanoPlot axis and legend show actual comparison group names (not "Treatment/Control")
- GSEA page shows comparison selector, "Run GSEA" button triggers on-demand computation
- QC p-value distribution changes with comparison selection
- Colors in QCPlots and AbundancePlot handle 3+ conditions correctly
- Backend tests pass: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v`
- Frontend E2E tests pass: `cd Tests && npx playwright test`
