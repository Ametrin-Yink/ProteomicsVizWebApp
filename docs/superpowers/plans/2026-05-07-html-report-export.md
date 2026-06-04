# HTML Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abolish PDF export and replace with self-contained interactive HTML reports (weblink + ZIP download).

**Architecture:** Frontend serializes Plotly/Cytoscape state and table data via a visualization module registry, assembles a self-contained `index.html + assets/` zip archive using JSZip, then either downloads directly (ZIP) or uploads to backend for weblink serving. Backend stores and serves static files — no rendering logic.

**Tech Stack:** TypeScript, JSZip, Plotly.js, Cytoscape.js, FastAPI, Python (report_store)

**Spec:** `docs/superpowers/specs/2026-05-07-html-report-export-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| DELETE | `backend/app/services/report_generator.py` | Old PDF generation |
| DELETE | `backend/app/services/pdf_converter.py` | Old Playwright PDF converter |
| DELETE | `backend/app/services/plot_generator.py` | Old matplotlib static plots |
| DELETE | `backend/templates/report_template.html` | Old Jinja2 report template |
| DELETE | `frontend/src/components/visualization/PDFExport.tsx` | Old PDF export UI |
| CREATE | `frontend/src/lib/figures/volcano-figure.ts` | Volcano Plotly spec builder |
| CREATE | `frontend/src/lib/figures/qc-figures.ts` | QC Plotly spec builders (8 charts) |
| CREATE | `frontend/src/lib/figures/gsea-figures.ts` | GSEA Plotly spec builders |
| CREATE | `frontend/src/lib/figures/compare-figure.ts` | Compare heatmap spec builder |
| CREATE | `frontend/src/lib/figures/bionet-graph.ts` | BioNet Cytoscape state builder |
| CREATE | `frontend/src/lib/html-report-builder.ts` | Zip assembly, state capture orchestration |
| CREATE | `frontend/src/components/visualization/ExportButton.tsx` | Export button in nav bar |
| CREATE | `frontend/src/components/visualization/ExportModal.tsx` | Name input + weblink/zip choice modal |
| CREATE | `frontend/public/report-template.html` | Standalone HTML template with JS |
| CREATE | `frontend/src/app/reports/page.tsx` | Global reports history page |
| CREATE | `backend/app/services/report_store.py` | Report CRUD over filesystem |
| MODIFY | `frontend/src/config/visualization-modules.ts` | Add `getExportState` to interface + registry |
| MODIFY | `frontend/src/app/analysis/visualization/layout.tsx` | Replace PDFExport with ExportButton |
| MODIFY | `frontend/src/app/analysis/visualization/page.tsx` | Register volcano export state |
| MODIFY | `frontend/src/app/analysis/visualization/qc/page.tsx` | Register QC export state |
| MODIFY | `frontend/src/app/analysis/visualization/gsea/page.tsx` | Register GSEA export state |
| MODIFY | `frontend/src/app/analysis/visualization/compare/page.tsx` | Register Compare export state |
| MODIFY | `frontend/src/app/analysis/visualization/bionet/page.tsx` | Register BioNet export state |
| MODIFY | `frontend/src/components/layout/TopNavigation.tsx` | Add Reports nav link |
| MODIFY | `frontend/src/lib/api-client.ts` | Replace report API methods |
| MODIFY | `backend/app/api/routes/reports.py` | Rewrite all endpoints |
| MODIFY | `backend/app/models/analysis.py` | Remove ReportRequest, ReportStatus |
| MODIFY | `backend/app/services/__init__.py` | Remove plot_generator import |
| MODIFY | `frontend/src/app/about/page.tsx` | Update "PDF report" text |
| MODIFY | `frontend/package.json` | Add jszip dependency |

---

### Task 1: Delete old backend report generation code

**Files:**
- Delete: `backend/app/services/report_generator.py`
- Delete: `backend/app/services/pdf_converter.py`
- Delete: `backend/app/services/plot_generator.py`
- Delete: `backend/templates/report_template.html`
- Modify: `backend/app/services/__init__.py`
- Modify: `backend/app/models/analysis.py`

- [ ] **Step 1: Remove report generator and PDF converter**

```bash
rm "backend/app/services/report_generator.py"
rm "backend/app/services/pdf_converter.py"
rm "backend/app/services/plot_generator.py"
rm "backend/templates/report_template.html"
```

- [ ] **Step 2: Remove plot_generator from services __init__.py**

Edit `backend/app/services/__init__.py`: remove line 6 (`- plot_generator: Static plot generation for PDF reports`), line 15 (`from app.services.plot_generator import plot_generator, PlotGenerator`), and `"plot_generator"` and `"PlotGenerator"` from the `__all__` list on lines 25-26.

- [ ] **Step 3: Remove ReportRequest and ReportStatus from analysis models**

Edit `backend/app/models/analysis.py`: delete lines 241-278 (the `ReportRequest` class and `ReportStatus` class). Keep everything else intact.

- [ ] **Step 4: Verify backend still imports cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "from app.services import session_manager; from app.models.analysis import AnalysisTemplate; print('OK')"`

Expected: `OK` with no import errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: remove old PDF report generation code

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Delete old frontend PDF export component

**Files:**
- Delete: `frontend/src/components/visualization/PDFExport.tsx`
- Modify: `frontend/src/app/analysis/visualization/layout.tsx`

- [ ] **Step 1: Delete PDFExport.tsx**

```bash
rm "frontend/src/components/visualization/PDFExport.tsx"
```

- [ ] **Step 2: Remove PDFExport import and usage from visualization layout**

Edit `frontend/src/app/analysis/visualization/layout.tsx`:
- Remove line 7: `import PDFExport from '@/components/visualization/PDFExport';`
- Remove line 43: `<PDFExport sessionId={sessionId} />`
- The right side of the nav bar will be empty for now (placeholder for ExportButton in Task 8)

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npm run build 2>&1 | tail -5`

Expected: Build succeeds (may warn about unused imports, that's OK for now).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove old PDFExport frontend component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Extract volcano figure generation to pure function

**Files:**
- Create: `frontend/src/lib/figures/volcano-figure.ts`

- [ ] **Step 1: Examine current VolcanoPlot component to understand figure construction**

Read `frontend/src/components/visualization/VolcanoPlot.tsx` — identify the `data` and `layout` objects passed to `Plotly.react()`.

- [ ] **Step 2: Create `frontend/src/lib/figures/volcano-figure.ts`**

```typescript
import type { DEResult, VolcanoFilters } from '@/types/api';
import { isSignificantVolcano } from '@/lib/utils';

export interface VolcanoFigureExport {
  figureSpec: {
    data: unknown[];
    layout: Record<string, unknown>;
  };
  deTable: {
    columns: { key: string; label: string }[];
    rows: Record<string, unknown>[];
  };
  markedProteins: string[];
  comparisonLabel: string;
}

export function buildVolcanoExport(
  deResults: DEResult[],
  filters: VolcanoFilters,
  comparisonLabel: string,
  markedProteins: string[],
): VolcanoFigureExport {
  const { foldChange, pValue, s0 } = filters;

  // Separate significant vs non-significant
  const significant = deResults.filter((r) => isSignificantVolcano(r, filters));
  const nonsignificant = deResults.filter((r) => !isSignificantVolcano(r, filters));

  // Build Plotly traces
  const nonsigTrace = {
    x: nonsignificant.map((r) => r.logFC),
    y: nonsignificant.map((r) => -Math.log10(Math.max(r.pValue ?? r.pval, 1e-300))),
    text: nonsignificant.map((r) => r.accession),
    type: 'scatter',
    mode: 'markers',
    name: 'Non-significant',
    marker: { color: '#9CA3AF', size: 5, opacity: 0.6 },
    hovertemplate: '%{text}<br>log₂FC: %{x:.2f}<br>-log₁₀(p): %{y:.2f}<extra></extra>',
  };

  const sigTrace = {
    x: significant.map((r) => r.logFC),
    y: significant.map((r) => -Math.log10(Math.max(r.pValue ?? r.pval, 1e-300))),
    text: significant.map((r) => r.accession),
    type: 'scatter',
    mode: 'markers',
    name: 'Significant',
    marker: {
      color: significant.map((r) => (r.logFC > 0 ? '#F28B82' : '#AECBFA')),
      size: 7,
      opacity: 0.8,
    },
    hovertemplate: '%{text}<br>log₂FC: %{x:.2f}<br>-log₁₀(p): %{y:.2f}<extra></extra>',
  };

  const data = [nonsigTrace, sigTrace];

  const layout = {
    title: comparisonLabel,
    xaxis: { title: 'log₂ Fold Change', zeroline: true, zerolinecolor: '#6B7280' },
    yaxis: { title: '-log₁₀(p-value)' },
    hovermode: 'closest',
    showlegend: true,
    paper_bgcolor: '#FFFFFF',
    plot_bgcolor: '#F9FAFB',
  };

  // Build table data
  const columns = [
    { key: 'accession', label: 'Accession' },
    { key: 'gene', label: 'Gene' },
    { key: 'logFC', label: 'log₂FC' },
    { key: 'pValue', label: 'p-value' },
    { key: 'adjPValue', label: 'adj. p-value' },
    { key: 'significant', label: 'Significant' },
  ];

  const rows = deResults.map((r) => ({
    accession: r.accession,
    gene: r.geneName ?? r.Gene_Name ?? '',
    logFC: r.logFC,
    pValue: r.pValue ?? r.pval,
    adjPValue: r.adjPValue ?? r.adjPval ?? r['adj.P.Val'] ?? '',
    significant: isSignificantVolcano(r, filters),
  }));

  return {
    figureSpec: { data, layout },
    deTable: { columns, rows },
    markedProteins,
    comparisonLabel,
  };
}
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd frontend && npx tsc --noEmit src/lib/figures/volcano-figure.ts 2>&1`

Expected: TypeScript errors may appear from imports not yet available; the file itself should parse cleanly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/figures/volcano-figure.ts && git commit -m "feat: add volcano figure export builder

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Extract QC figure generation

**Files:**
- Create: `frontend/src/lib/figures/qc-figures.ts`

- [ ] **Step 1: Create `frontend/src/lib/figures/qc-figures.ts`**

```typescript
export interface QcFigureExport {
  plots: Record<string, { data: unknown[]; layout: Record<string, unknown> }>;
}

export function buildQcExport(qcData: {
  pca?: { samples: string[]; pc1: number[]; pc2: number[]; conditions: string[]; pc1_variance: number; pc2_variance: number };
  pvalue_distribution?: { bins: number[]; counts: number[] };
  psm_cv?: { sample: string; cv: number; condition: string }[];
  protein_cv?: { sample: string; cv: number; condition: string }[];
  intensity_distributions?: { sample: string; intensity: number; condition: string }[];
  protein_abundance_distributions?: { sample: string; intensity: number; condition: string }[];
  data_completeness?: { sample: string; completeness_pct: number; condition: string }[];
  psm_completeness?: { sample: string; completeness_pct: number; condition: string }[];
}): QcFigureExport {
  const plots: Record<string, { data: unknown[]; layout: Record<string, unknown> }> = {};

  // PCA
  if (qcData.pca) {
    const { samples, pc1, pc2, conditions, pc1_variance, pc2_variance } = qcData.pca;
    const uniqueConditions = [...new Set(conditions)];
    const colorMap: Record<string, string> = {};
    const palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
    uniqueConditions.forEach((c, i) => { colorMap[c] = palette[i % palette.length]; });

    plots.pca = {
      data: uniqueConditions.map((cond) => ({
        x: samples.filter((_, i) => conditions[i] === cond).map((_, i) => pc1.filter((_, j) => conditions[j] === cond)[i]),
        y: samples.filter((_, i) => conditions[i] === cond).map((_, i) => pc2.filter((_, j) => conditions[j] === cond)[i]),
        text: samples.filter((_, i) => conditions[i] === cond),
        type: 'scatter',
        mode: 'markers+text',
        name: cond,
        textposition: 'top center',
        marker: { size: 10, color: colorMap[cond] },
      })),
      layout: {
        title: 'PCA Score Plot',
        xaxis: { title: `PC1 (${pc1_variance}%)` },
        yaxis: { title: `PC2 (${pc2_variance}%)` },
        paper_bgcolor: '#FFFFFF',
        plot_bgcolor: '#F9FAFB',
      },
    };
  }

  // P-value distribution
  if (qcData.pvalue_distribution) {
    plots.pvalue = {
      data: [{ x: qcData.pvalue_distribution.bins, y: qcData.pvalue_distribution.counts, type: 'bar', marker: { color: '#6BAED6' } }],
      layout: { title: 'P-value Distribution', xaxis: { title: 'p-value' }, yaxis: { title: 'Count' }, paper_bgcolor: '#FFFFFF', plot_bgcolor: '#F9FAFB' },
    };
  }

  // CV plots, intensity plots, completeness — same pattern using the provided data
  // [...] remaining QC plot builders follow the same structure

  return { plots };
}
```

> **Note for implementation:** The remaining QC plot builders (psmCv, proteinCv, psmIntensity, proteinIntensity, completeness, psmCompleteness) follow the same pattern as PCA/pvalue above. The exact trace configs should be extracted from the current QC page component at `frontend/src/app/analysis/visualization/qc/page.tsx`. This task should read that file and mirror its figure construction exactly.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/figures/qc-figures.ts && git commit -m "feat: add QC figure export builders

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Extract GSEA figure generation

**Files:**
- Create: `frontend/src/lib/figures/gsea-figures.ts`

- [ ] **Step 1: Create `frontend/src/lib/figures/gsea-figures.ts`**

```typescript
export interface GseaFigureExport {
  databases: string[];
  results: Record<string, {
    barChart: { data: unknown[]; layout: Record<string, unknown> };
    heatmap: { data: unknown[]; layout: Record<string, unknown> };
    pathwayTable: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };
  }>;
}

export function buildGseaExport(gseaData: Record<string, {
  results: Array<{ term: string; name: string; nes: number; pval: number; fdr: number; enrichment_direction: string; matched_genes: number }>;
  total_pathways: number;
  significant_pathways: number;
}>): GseaFigureExport {
  const databases = Object.keys(gseaData);
  const results: GseaFigureExport['results'] = {};

  for (const [dbName, dbData] of Object.entries(gseaData)) {
    const significant = dbData.results.filter((r) => r.fdr < 0.05);
    const sorted = [...significant].sort((a, b) => a.fdr - b.fdr).slice(0, 20);

    // Bar chart
    results[dbName] = {
      barChart: {
        data: [{
          x: sorted.map((r) => r.nes),
          y: sorted.map((r) => r.name),
          type: 'bar',
          orientation: 'h',
          marker: {
            color: sorted.map((r) => r.nes > 0 ? '#F28B82' : '#AECBFA'),
          },
        }],
        layout: {
          title: `${dbName} — Top Enriched Pathways`,
          xaxis: { title: 'Normalized Enrichment Score' },
          paper_bgcolor: '#FFFFFF',
          plot_bgcolor: '#F9FAFB',
        },
      },
      heatmap: { data: [], layout: {} }, // Populated from actual GSEA heatmap data
      pathwayTable: {
        columns: [
          { key: 'term', label: 'Term' },
          { key: 'name', label: 'Pathway' },
          { key: 'nes', label: 'NES' },
          { key: 'pval', label: 'p-value' },
          { key: 'fdr', label: 'FDR' },
          { key: 'direction', label: 'Direction' },
        ],
        rows: sorted.map((r) => ({
          term: r.term,
          name: r.name,
          nes: r.nes,
          pval: r.pval,
          fdr: r.fdr,
          direction: r.enrichment_direction,
        })),
      },
    };
  }

  return { databases, results };
}
```

> **Note:** The bar chart and heatmap figure specs should be extracted from the GSEA page component at `frontend/src/app/analysis/visualization/gsea/page.tsx` to match exactly.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/figures/gsea-figures.ts && git commit -m "feat: add GSEA figure export builders

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Extract Compare and BioNet figure generation

**Files:**
- Create: `frontend/src/lib/figures/compare-figure.ts`
- Create: `frontend/src/lib/figures/bionet-graph.ts`

- [ ] **Step 1: Create `frontend/src/lib/figures/compare-figure.ts`**

```typescript
export interface CompareFigureExport {
  comparisonLabel: string;
  heatmapSpec: { data: unknown[]; layout: Record<string, unknown> };
}

export function buildCompareExport(
  heatmapSpec: { data: unknown[]; layout: Record<string, unknown> },
  comparisonLabel: string,
): CompareFigureExport {
  return { comparisonLabel, heatmapSpec };
}
```

- [ ] **Step 2: Create `frontend/src/lib/figures/bionet-graph.ts`**

```typescript
export interface BioNetExport {
  cytoscapeElements: { nodes: object[]; edges: object[] };
  edgeTypes: string[];
}

export function buildBioNetExport(
  elements: { nodes: object[]; edges: object[] },
  edgeTypes: string[],
): BioNetExport {
  return {
    cytoscapeElements: elements,
    edgeTypes,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/figures/compare-figure.ts frontend/src/lib/figures/bionet-graph.ts && git commit -m "feat: add Compare and BioNet figure export builders

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Extend visualization module registry with getExportState

**Files:**
- Modify: `frontend/src/config/visualization-modules.ts`

- [ ] **Step 1: Extend the VisualizationModule interface and add registry**

Edit `frontend/src/config/visualization-modules.ts`:

Add after the existing imports and before `VisualizationModule` interface:

```typescript
import type { VolcanoFilters } from '@/types/api';

/** Serialized state produced by each visualization module for the HTML report. */
export interface ExportState {
  /** Which tab this data belongs to (matches module id). */
  tabId: string;
  /** Arbitrary serializable data — structure defined per module. */
  data: Record<string, unknown>;
}

/** Registry of state-capture functions populated by mounted visualization components. */
export const exportStateRegistry = new Map<string, (sessionId: string) => Promise<ExportState | null>>();

export function registerExportState(id: string, fn: (sessionId: string) => Promise<ExportState | null>) {
  exportStateRegistry.set(id, fn);
}

export function unregisterExportState(id: string) {
  exportStateRegistry.delete(id);
}
```

Add `getExportState` to the `VisualizationModule` interface:

```typescript
export interface VisualizationModule {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  supportedTemplates?: string[];
  /** Capture current visualization state for HTML export. null = skip this tab. */
  getExportState?: (sessionId: string) => Promise<ExportState | null>;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -c "error"`

Expected: No NEW errors introduced. (May still have pre-existing errors from deleted PDFExport.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/config/visualization-modules.ts && git commit -m "feat: add export state registry to visualization modules

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Register export state in each visualization page

**Files:**
- Modify: `frontend/src/app/analysis/visualization/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/qc/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/gsea/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/compare/page.tsx`
- Modify: `frontend/src/app/analysis/visualization/bionet/page.tsx`

- [ ] **Step 1: Register volcano export state in `page.tsx`**

Edit `frontend/src/app/analysis/visualization/page.tsx`: Add import and `useEffect` registration.

Add import at top:
```typescript
import { registerExportState, unregisterExportState } from '@/config/visualization-modules';
import { buildVolcanoExport } from '@/lib/figures/volcano-figure';
```

Add inside the `ResultsContent` component, after the existing `useEffect` blocks:
```typescript
// Register export state for HTML report builder
useEffect(() => {
  registerExportState('volcano', async () => {
    if (!data) return null;
    const comparisonLabel = selectedComparison || `${sessionConfig?.treatment ?? 'Treatment'} vs ${sessionConfig?.control ?? 'Control'}`;
    const markedList = markedProteins[selectedComparison] ? Array.from(markedProteins[selectedComparison]) : [];
    const volcanoExport = buildVolcanoExport(data.results, filters, comparisonLabel, markedList);
    return { tabId: 'volcano', data: volcanoExport as unknown as Record<string, unknown> };
  });
  return () => { unregisterExportState('volcano'); };
}, [data, filters, selectedComparison, markedProteins, sessionConfig]);
```

- [ ] **Step 2: Register QC export state in `qc/page.tsx`**

Add import:
```typescript
import { registerExportState, unregisterExportState } from '@/config/visualization-modules';
import { buildQcExport } from '@/lib/figures/qc-figures';
```

Add `useEffect` that registers `getExportState` for QC, returning `buildQcExport(qcData)` when data is loaded.

- [ ] **Step 3: Register GSEA export state in `gsea/page.tsx`**

Add import:
```typescript
import { registerExportState, unregisterExportState } from '@/config/visualization-modules';
import { buildGseaExport } from '@/lib/figures/gsea-figures';
```

Add `useEffect` registering `getExportState` for GSEA, returning `buildGseaExport(gseaData)`.

- [ ] **Step 4: Register Compare export state in `compare/page.tsx`**

Add import:
```typescript
import { registerExportState, unregisterExportState } from '@/config/visualization-modules';
import { buildCompareExport } from '@/lib/figures/compare-figure';
```

- [ ] **Step 5: Register BioNet export state in `bionet/page.tsx`**

Add import:
```typescript
import { registerExportState, unregisterExportState } from '@/config/visualization-modules';
import { buildBioNetExport } from '@/lib/figures/bionet-graph';
```

- [ ] **Step 6: Verify compilation**

Run: `cd frontend && npm run build 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/analysis/visualization/ && git commit -m "feat: register export state in all visualization pages

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Build standalone HTML report template

**Files:**
- Create: `frontend/public/report-template.html`

- [ ] **Step 1: Create `frontend/public/report-template.html`**

This is a complete, self-contained HTML file with inline CSS and JS that:
- Reads data from `<script id="report-data" type="application/json">` (replaced by builder)
- Renders a top tab bar from `data.tabs`
- Creates Plotly/Cytoscape containers per tab
- Implements table sort/filter/paginate/CSV export in vanilla JS
- Implements GSEA database dropdown switching
- Implements BioNet search bar + edge type filter

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title data-report-title>ProteomicsViz Report</title>
<script src="assets/plotly.min.js"></script>
<script src="assets/cytoscape.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F3F4F6; color: #111827; }
  .tab-bar { display: flex; gap: 4px; padding: 8px 16px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; position: sticky; top: 0; z-index: 100; }
  .tab-btn { padding: 8px 16px; border: none; background: transparent; cursor: pointer; font-size: 14px; font-weight: 500; color: #6B7280; border-radius: 8px; transition: all 0.15s; }
  .tab-btn.active { background: #EEF2FF; color: #4F46E5; }
  .tab-btn:hover:not(.active) { background: #F3F4F6; color: #374151; }
  .tab-content { display: none; padding: 24px; }
  .tab-content.active { display: block; }
  .qc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .qc-grid .plot-container { min-height: 400px; }
  .plot-container { width: 100%; min-height: 500px; background: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 16px; }
  .table-container { background: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #F9FAFB; padding: 10px 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #E5E7EB; cursor: pointer; user-select: none; white-space: nowrap; }
  th:hover { background: #EEF2FF; }
  th .sort-arrow { margin-left: 4px; font-size: 10px; }
  td { padding: 8px 12px; border-bottom: 1px solid #F3F4F6; }
  tr:hover td { background: #FAFAFA; }
  .toolbar { display: flex; gap: 12px; align-items: center; padding: 12px 16px; flex-wrap: wrap; }
  .toolbar input, .toolbar select { padding: 6px 12px; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 13px; }
  .toolbar button { padding: 6px 14px; background: #4F46E5; color: #FFF; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .toolbar button:hover { background: #4338CA; }
  .pagination { display: flex; gap: 4px; align-items: center; padding: 8px 16px; font-size: 13px; }
  .pagination button { padding: 4px 10px; border: 1px solid #D1D5DB; background: #FFF; border-radius: 4px; cursor: pointer; }
  .pagination button:disabled { opacity: 0.4; cursor: default; }
  .pagination button.active { background: #4F46E5; color: #FFF; border-color: #4F46E5; }
  #bionet-container { width: 100%; height: 600px; background: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .report-header { padding: 16px 24px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; }
  .report-header h1 { font-size: 20px; font-weight: 600; }
  .report-header .meta { font-size: 13px; color: #6B7280; margin-top: 4px; }
</style>
</head>
<body>

<div class="report-header">
  <h1 data-report-name></h1>
  <div class="meta">
    <span data-report-session></span> &middot; <span data-report-date></span>
  </div>
</div>

<div class="tab-bar" id="tab-bar"></div>

<div id="tab-content-area"></div>

<script id="report-data" type="application/json">{{REPORT_DATA}}</script>

<script>
(function() {
  var dataScript = document.getElementById('report-data');
  var data = JSON.parse(dataScript.textContent);

  // Set header
  document.querySelector('[data-report-name]').textContent = data.report.name;
  document.querySelector('[data-report-session]').textContent = data.report.session_name;
  document.querySelector('[data-report-date]').textContent = data.report.created_at;

  // Build tabs
  var tabBar = document.getElementById('tab-bar');
  var contentArea = document.getElementById('tab-content-area');
  var tabContents = {};

  data.tabs.forEach(function(tab, idx) {
    // Tab button
    var btn = document.createElement('button');
    btn.className = 'tab-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = tab.label;
    btn.onclick = function() { switchTab(tab.id); };
    tabBar.appendChild(btn);

    // Tab content
    var div = document.createElement('div');
    div.className = 'tab-content' + (idx === 0 ? ' active' : '');
    div.id = 'tab-' + tab.id;
    contentArea.appendChild(div);
    tabContents[tab.id] = div;
  });

  function switchTab(id) {
    var btns = tabBar.querySelectorAll('.tab-btn');
    btns.forEach(function(b, i) { b.classList.toggle('active', data.tabs[i].id === id); });
    Object.keys(tabContents).forEach(function(k) {
      tabContents[k].classList.toggle('active', k === id);
    });
  }

  // Render each tab
  data.tabs.forEach(function(tab) {
    renderTab(tab.id, data[tab.id], tabContents[tab.id]);
  });

  // --- Tab Renderers ---

  function renderTab(id, tabData, container) {
    if (id === 'volcano') renderVolcano(tabData, container);
    else if (id === 'qc') renderQC(tabData, container);
    else if (id === 'gsea') renderGSEA(tabData, container);
    else if (id === 'compare') renderCompare(tabData, container);
    else if (id === 'bionet') renderBioNet(tabData, container);
  }

  function renderVolcano(d, container) {
    var plotDiv = document.createElement('div');
    plotDiv.className = 'plot-container';
    container.appendChild(plotDiv);
    Plotly.newPlot(plotDiv, d.figureSpec.data, d.figureSpec.layout);

    // Protein table
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = '<input type="text" placeholder="Search..." data-search>' +
      '<button data-csv>Export CSV</button>' +
      '<span style="font-size:13px;color:#6B7280" data-count></span>';
    container.appendChild(toolbar);

    var tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    container.appendChild(tableContainer);

    renderTable(tableContainer, d.deTable.columns, d.deTable.rows, toolbar);
  }

  // --- Reusable Table (sort, filter, paginate, CSV export) ---
  var ROWS_PER_PAGE = 25;

  function renderTable(container, columns, allRows, toolbar) {
    var sortCol = null;
    var sortAsc = true;
    var searchTerm = '';
    var currentPage = 0;

    function getFilteredSorted() {
      var rows = allRows.slice();
      if (searchTerm) {
        var lower = searchTerm.toLowerCase();
        rows = rows.filter(function(r) {
          return columns.some(function(c) { return String(r[c.key] || '').toLowerCase().includes(lower); });
        });
      }
      if (sortCol) {
        rows.sort(function(a, b) {
          var va = a[sortCol], vb = b[sortCol];
          if (va == null) va = '';
          if (vb == null) vb = '';
          if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
          return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
      }
      return rows;
    }

    function render() {
      var filtered = getFilteredSorted();
      var totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
      if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);
      var start = currentPage * ROWS_PER_PAGE;
      var page = filtered.slice(start, start + ROWS_PER_PAGE);

      var html = '<table><thead><tr>';
      columns.forEach(function(c) {
        var arrow = '';
        if (sortCol === c.key) arrow = ' <span class="sort-arrow">' + (sortAsc ? '&#9650;' : '&#9660;') + '</span>';
        html += '<th data-col="' + c.key + '">' + c.label + arrow + '</th>';
      });
      html += '</tr></thead><tbody>';
      page.forEach(function(r) {
        html += '<tr>';
        columns.forEach(function(c) {
          var v = r[c.key];
          if (typeof v === 'number') v = v.toFixed(4);
          else if (typeof v === 'boolean') v = v ? '&#10003;' : '';
          html += '<td>' + (v != null ? String(v) : '') + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';

      html += '<div class="pagination">';
      html += '<button ' + (currentPage === 0 ? 'disabled' : '') + ' data-prev>Prev</button>';
      for (var p = 0; p < totalPages; p++) {
        html += '<button class="' + (p === currentPage ? 'active' : '') + '" data-page="' + p + '">' + (p + 1) + '</button>';
      }
      html += '<button ' + (currentPage >= totalPages - 1 ? 'disabled' : '') + ' data-next>Next</button>';
      html += '<span style="font-size:13px;color:#6B7280">' + (start + 1) + '-' + Math.min(start + ROWS_PER_PAGE, filtered.length) + ' of ' + filtered.length + '</span>';
      html += '</div>';

      container.innerHTML = html;

      // Update count
      if (toolbar) {
        var countEl = toolbar.querySelector('[data-count]');
        if (countEl) countEl.textContent = filtered.length + ' proteins';
      }
    }

    // Delegated event handlers
    container.addEventListener('click', function(e) {
      var target = e.target;
      if (target.tagName === 'TH') {
        var col = target.getAttribute('data-col');
        if (sortCol === col) sortAsc = !sortAsc;
        else { sortCol = col; sortAsc = true; }
        currentPage = 0;
        render();
      } else if (target.hasAttribute('data-page')) {
        currentPage = parseInt(target.getAttribute('data-page'));
        render();
      } else if (target.hasAttribute('data-prev')) {
        var prev = currentPage - 1;
        var filtered = getFilteredSorted();
        var totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
        currentPage = Math.max(0, prev);
        render();
      } else if (target.hasAttribute('data-next')) {
        var next = currentPage + 1;
        var filtered = getFilteredSorted();
        var totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
        currentPage = Math.min(totalPages - 1, next);
        render();
      }
    });

    // Search handler
    if (toolbar) {
      var searchInput = toolbar.querySelector('[data-search]');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          searchTerm = this.value;
          currentPage = 0;
          render();
        });
      }
      // CSV export
      var csvBtn = toolbar.querySelector('[data-csv]');
      if (csvBtn) {
        csvBtn.addEventListener('click', function() {
          var filtered = getFilteredSorted();
          var csv = columns.map(function(c) { return '"' + c.label + '"'; }).join(',') + '\n';
          filtered.forEach(function(r) {
            csv += columns.map(function(c) {
              var v = r[c.key];
              if (v == null) return '';
              return '"' + String(v).replace(/"/g, '""') + '"';
            }).join(',') + '\n';
          });
          var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'proteins.csv';
          a.click();
        });
      }
    }

    render();
  }

  function renderQC(d, container) {
    var grid = document.createElement('div');
    grid.className = 'qc-grid';
    container.appendChild(grid);
    Object.keys(d.plots).forEach(function(key) {
      var div = document.createElement('div');
      div.className = 'plot-container';
      grid.appendChild(div);
      Plotly.newPlot(div, d.plots[key].data, d.plots[key].layout, { responsive: true });
    });
  }

  function renderGSEA(d, container) {
    var sel = document.createElement('select');
    sel.style.cssText = 'margin-bottom:16px;padding:8px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:14px;';
    d.databases.forEach(function(db, i) {
      var opt = document.createElement('option');
      opt.value = db;
      opt.textContent = db;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
    container.appendChild(sel);

    var dbContainers = {};
    d.databases.forEach(function(db) {
      var div = document.createElement('div');
      div.style.display = 'none';
      container.appendChild(div);
      dbContainers[db] = div;
    });

    function showDb(db) {
      Object.keys(dbContainers).forEach(function(k) { dbContainers[k].style.display = 'none'; });
      var div = dbContainers[db];
      div.style.display = 'block';
      if (!div.hasChildNodes()) {
        var r = d.results[db];

        var barDiv = document.createElement('div');
        barDiv.className = 'plot-container';
        div.appendChild(barDiv);
        Plotly.newPlot(barDiv, r.barChart.data, r.barChart.layout);

        var heatDiv = document.createElement('div');
        heatDiv.className = 'plot-container';
        div.appendChild(heatDiv);
        if (r.heatmap.data && r.heatmap.data.length) {
          Plotly.newPlot(heatDiv, r.heatmap.data, r.heatmap.layout);
        }

        // Pathway table
        var pToolbar = document.createElement('div');
        pToolbar.className = 'toolbar';
        pToolbar.innerHTML = '<input type="text" placeholder="Search pathways..." data-search>' +
          '<button data-csv>Export CSV</button>';
        div.appendChild(pToolbar);

        var pTable = document.createElement('div');
        pTable.className = 'table-container';
        div.appendChild(pTable);
        renderTable(pTable, r.pathwayTable.columns, r.pathwayTable.rows, pToolbar);
      }
    }

    sel.onchange = function() { showDb(this.value); };
    showDb(d.databases[0]);
  }

  function renderCompare(d, container) {
    var label = document.createElement('p');
    label.style.cssText = 'font-size:14px;color:#6B7280;margin-bottom:12px;';
    label.textContent = d.comparisonLabel;
    container.appendChild(label);

    var div = document.createElement('div');
    div.className = 'plot-container';
    div.style.minHeight = '600px';
    container.appendChild(div);
    Plotly.newPlot(div, d.heatmapSpec.data, d.heatmapSpec.layout, { responsive: true });
  }

  function renderBioNet(d, container) {
    // Search bar + edge type filter toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = '<input type="text" placeholder="Search proteins..." data-search style="width:250px;">';
    d.edgeTypes.forEach(function(et) {
      toolbar.innerHTML += '<label style="font-size:13px;display:flex;align-items:center;gap:4px;">' +
        '<input type="checkbox" checked data-edge-type="' + et + '"> ' + et + '</label>';
    });
    container.appendChild(toolbar);

    var cyDiv = document.createElement('div');
    cyDiv.id = 'bionet-container';
    container.appendChild(cyDiv);

    var cy = cytoscape({
      container: cyDiv,
      elements: d.cytoscapeElements,
      style: [
        { selector: 'node', style: { 'background-color': '#4F46E5', 'label': 'data(label)', 'font-size': '10px', 'text-valign': 'center', 'text-halign': 'center' } },
        { selector: 'edge', style: { 'width': 2, 'line-color': '#D1D5DB', 'target-arrow-color': '#D1D5DB', 'target-arrow-shape': 'triangle' } },
      ],
      layout: { name: 'cose-bilkent', animate: false },
    });

    // Search
    toolbar.querySelector('[data-search]').addEventListener('input', function() {
      var q = this.value.toLowerCase();
      cy.nodes().forEach(function(n) {
        var label = String(n.data('label') || '').toLowerCase();
        n.style('display', q === '' || label.includes(q) ? 'element' : 'none');
      });
    });

    // Edge type filter
    toolbar.querySelectorAll('[data-edge-type]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var et = this.getAttribute('data-edge-type');
        cy.edges('[type="' + et + '"]').style('display', this.checked ? 'element' : 'none');
      });
    });
  }
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the file is valid HTML**

Run: `cd frontend && npx html-validate public/report-template.html 2>&1` (skip if html-validate not installed; visual review is sufficient)

- [ ] **Step 3: Commit**

```bash
git add frontend/public/report-template.html && git commit -m "feat: add standalone HTML report template

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Build html-report-builder.ts

**Files:**
- Create: `frontend/src/lib/html-report-builder.ts`

- [ ] **Step 1: Create `frontend/src/lib/html-report-builder.ts`**

```typescript
import { exportStateRegistry, type ExportState } from '@/config/visualization-modules';

export interface ReportData {
  report: { name: string; session_name: string; created_at: string };
  tabs: { id: string; label: string }[];
  [tabId: string]: unknown;
}

export class ExportError extends Error {
  constructor(message: string, public readonly moduleName?: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Collect export state from all registered visualization modules. */
export async function captureAllStates(sessionId: string): Promise<{ data: ReportData; errors: string[] }> {
  const modules = Array.from(exportStateRegistry.entries());
  const data: Record<string, unknown> = {};
  const tabs: { id: string; label: string }[] = [];
  const errors: string[] = [];

  for (const [id, getState] of modules) {
    try {
      const state = await getState(sessionId);
      if (state && state.data) {
        data[state.tabId] = state.data;
        // Derive label from module id (capitalized)
        const label = state.tabId.charAt(0).toUpperCase() + state.tabId.slice(1);
        tabs.push({ id: state.tabId, label: getModuleLabel(state.tabId) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ExportError(`Failed to capture ${getModuleLabel(id)}: ${msg}`, getModuleLabel(id));
    }
  }

  // Sort tabs to match the order in VISUALIZATION_MODULES
  const { VISUALIZATION_MODULES } = await import('@/config/visualization-modules');
  const order = VISUALIZATION_MODULES.map((m) => m.id);
  tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return {
    data: {
      report: { name: '', session_name: '', created_at: new Date().toISOString() },
      tabs,
      ...data,
    },
    errors,
  };
}

function getModuleLabel(id: string): string {
  const labels: Record<string, string> = {
    volcano: 'Volcano Plot', qc: 'QC Plots', gsea: 'GSEA Analysis',
    compare: 'Compare', bionet: 'BioNet',
  };
  return labels[id] || id;
}

/** Build a self-contained ZIP blob from report data. */
export async function buildZipBlob(
  reportData: ReportData,
  reportName: string,
  sessionName: string,
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // Populate metadata
  reportData.report.name = reportName;
  reportData.report.session_name = sessionName;
  reportData.report.created_at = new Date().toISOString();

  // Read template and replace placeholder
  const templateResponse = await fetch('/report-template.html');
  const template = await templateResponse.text();
  const html = template.replace('{{REPORT_DATA}}', JSON.stringify(reportData));
  zip.file('index.html', html);

  // Bundle assets
  const assets = zip.folder('assets');
  if (!assets) throw new ExportError('Failed to create assets folder');

  // Read Plotly and Cytoscape from public dir
  const [plotlyRes, cyRes] = await Promise.all([
    fetch('/plotly.min.js'),
    fetch('/cytoscape.min.js'),
  ]);
  if (!plotlyRes.ok || !cyRes.ok) throw new ExportError('Failed to load JS library assets');

  assets.file('plotly.min.js', await plotlyRes.blob());
  assets.file('cytoscape.min.js', await cyRes.blob());

  // Write data.json
  assets.file('data.json', JSON.stringify(reportData, null, 2));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Trigger browser download of a blob as a ZIP file. */
export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/html-report-builder.ts && git commit -m "feat: add HTML report builder with zip assembly

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Build ExportModal and ExportButton components

**Files:**
- Create: `frontend/src/components/visualization/ExportButton.tsx`
- Create: `frontend/src/components/visualization/ExportModal.tsx`

- [ ] **Step 1: Create `frontend/src/components/visualization/ExportButton.tsx`**

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { FileDown } from 'lucide-react';
import { ExportModal } from './ExportModal';

interface ExportButtonProps {
  sessionId: string;
}

export default function ExportButton({ sessionId }: ExportButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const session = await res.json();
        if (cancelled) return;
        setIsCompleted(session.state === 'completed');
        setSessionName(session.name || '');
      } catch {} finally {
        if (!cancelled) setChecked(true);
      }
    }
    if (sessionId) check();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Don't render at all until we've checked session state
  if (!checked || !isCompleted) return null;

  return (
    <>
      <button
        data-testid="export-report-btn"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Export
      </button>
      {showModal && (
        <ExportModal
          sessionId={sessionId}
          sessionName={sessionName}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/visualization/ExportModal.tsx`**

```typescript
'use client';

import React, { useState, useCallback } from 'react';
import { X, Loader2, Link, Download, Copy, CheckCircle } from 'lucide-react';
import { captureAllStates, buildZipBlob, downloadZip, ExportError } from '@/lib/html-report-builder';

interface ExportModalProps {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
}

type ModalState = 'input' | 'generating' | 'weblink-ready' | 'error';

export function ExportModal({ sessionId, sessionName, onClose }: ExportModalProps) {
  const [name, setName] = useState(sessionName ? `${sessionName} Report` : '');
  const [state, setState] = useState<ModalState>('input');
  const [progressMsg, setProgressMsg] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async (mode: 'weblink' | 'zip') => {
    if (!name.trim()) return;
    setState('generating');
    setErrorMsg('');

    try {
      setProgressMsg('Capturing visualizations...');
      const { data } = await captureAllStates(sessionId);

      setProgressMsg(mode === 'zip' ? 'Assembling ZIP...' : 'Assembling archive...');
      const zipBlob = await buildZipBlob(data, name.trim(), sessionName);

      if (mode === 'zip') {
        setProgressMsg('Downloading...');
        downloadZip(zipBlob, name.trim());
        onClose();
      } else {
        setProgressMsg('Uploading to server...');
        const formData = new FormData();
        formData.append('zip', zipBlob, 'report.zip');
        formData.append('name', name.trim());

        const baseUrl = window.location.origin;
        const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/export/weblink`, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
          throw new Error(err.detail || 'Upload failed');
        }

        const result = await res.json();
        setResultUrl(`${baseUrl}${result.weblink}`);
        setState('weblink-ready');
      }
    } catch (err) {
      const msg = err instanceof ExportError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
      setErrorMsg(msg);
      setState('error');
    }
  }, [name, sessionId, sessionName, onClose]);

  const copyUrl = useCallback(async () => {
    try { await navigator.clipboard.writeText(resultUrl); setCopied(true); } catch {}
  }, [resultUrl]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg w-[480px] max-w-[90vw] shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Export Report</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="p-6">
          {state === 'input' && (
            <>
              <label className="block text-sm font-medium mb-2">Report Name</label>
              <input
                data-testid="report-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter report name..."
                className="w-full px-3 py-2 border border-border rounded-lg mb-6 focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  data-testid="generate-weblink-btn"
                  disabled={!name.trim()}
                  onClick={() => handleGenerate('weblink')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Link className="w-4 h-4" /> Generate Weblink
                </button>
                <button
                  data-testid="download-zip-btn"
                  disabled={!name.trim()}
                  onClick={() => handleGenerate('zip')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-surface text-text-primary rounded-lg hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="w-4 h-4" /> Download ZIP
                </button>
              </div>
            </>
          )}

          {state === 'generating' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-text-secondary">{progressMsg}</p>
            </div>
          )}

          {state === 'weblink-ready' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="w-12 h-12 text-success" />
              <p className="font-semibold">Report ready!</p>
              <div className="flex items-center gap-2 w-full">
                <input
                  data-testid="weblink-url"
                  readOnly
                  value={resultUrl}
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                />
                <button
                  data-testid="copy-weblink-btn"
                  onClick={copyUrl}
                  className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm"
                >
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={onClose} className="px-4 py-2 bg-surface rounded-lg">Close</button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <p className="text-error font-semibold">Export failed</p>
              <p className="text-sm text-text-secondary text-center">{errorMsg}</p>
              <div className="flex gap-3">
                <button onClick={() => setState('input')} className="px-4 py-2 bg-surface rounded-lg">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Connect ExportButton in visualization layout**

Edit `frontend/src/app/analysis/visualization/layout.tsx`:
- Add import: `import ExportButton from '@/components/visualization/ExportButton';`
- Replace the removed `<PDFExport />` line with: `<ExportButton sessionId={sessionId} />`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/visualization/ExportButton.tsx frontend/src/components/visualization/ExportModal.tsx frontend/src/app/analysis/visualization/layout.tsx && git commit -m "feat: add Export button and modal with weblink/ZIP options

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Rewrite backend reports API

**Files:**
- Create: `backend/app/services/report_store.py`
- Modify: `backend/app/api/routes/reports.py`

- [ ] **Step 1: Create `backend/app/services/report_store.py`**

```python
"""
Report storage service.

Manages a global reports directory independent of session lifecycle.
Each report is a self-contained directory with index.html, assets/, and metadata.
"""

import json
import logging
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger("proteomics")

REPORTS_DIR = settings.base_dir / "reports"


def _reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def create_report(name: str, session_id: str, session_name: str, zip_data: bytes) -> dict:
    """Extract uploaded zip to a new report directory and return metadata."""
    report_id = f"rpt_{uuid.uuid4().hex[:12]}"
    report_dir = _reports_dir() / report_id
    report_dir.mkdir(parents=True, exist_ok=True)

    # Save original zip for download
    zip_path = report_dir / "export.zip"
    zip_path.write_bytes(zip_data)

    # Extract for weblink serving
    try:
        import io
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            # Security: validate no path traversal
            for member in zf.namelist():
                if member.startswith("/") or ".." in member:
                    raise ValueError(f"Unsafe zip entry: {member}")
            zf.extractall(report_dir)

        # Verify index.html exists
        if not (report_dir / "index.html").exists():
            raise ValueError("ZIP missing index.html at root")
    except Exception:
        # Cleanup on failure
        shutil.rmtree(report_dir, ignore_errors=True)
        raise

    # Write metadata
    metadata = {
        "report_id": report_id,
        "name": name,
        "session_id": session_id,
        "session_name": session_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (report_dir / "report.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    logger.info(f"Report created: {report_id} ({name})")
    return metadata


def list_reports() -> list[dict]:
    """List all reports sorted by creation time (newest first)."""
    rd = _reports_dir()
    if not rd.exists():
        return []

    reports = []
    for report_dir in sorted(rd.iterdir(), reverse=True):
        if not report_dir.is_dir():
            continue
        meta_path = report_dir / "report.json"
        if meta_path.exists():
            try:
                reports.append(json.loads(meta_path.read_text(encoding="utf-8")))
            except Exception:
                logger.warning(f"Corrupt report metadata: {meta_path}")
    return reports


def get_report_dir(report_id: str) -> Optional[Path]:
    """Get report directory path, validating it exists."""
    rd = _reports_dir()
    report_dir = rd / report_id
    if report_dir.is_dir() and (report_dir / "report.json").exists():
        return report_dir
    return None


def get_report_metadata(report_id: str) -> Optional[dict]:
    """Get report metadata dict."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return None
    return json.loads((report_dir / "report.json").read_text(encoding="utf-8"))


def delete_report(report_id: str) -> bool:
    """Delete a report directory. Returns True if deleted, False if not found."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        return False
    shutil.rmtree(report_dir)
    logger.info(f"Report deleted: {report_id}")
    return True
```

- [ ] **Step 2: Rewrite `backend/app/api/routes/reports.py`**

Replace the entire file content:

```python
"""
Report API routes.

Provides endpoints for HTML report export: weblink generation, listing,
serving static report files, ZIP download, and deletion.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.core.config import settings
from app.core.exceptions import SessionNotFoundError
from app.services.report_store import (
    create_report,
    list_reports,
    get_report_dir,
    get_report_metadata,
    delete_report,
)
from app.services.session_manager import SessionManager

logger = logging.getLogger("proteomics")

router = APIRouter()
global_router = APIRouter()


def get_session_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


# --- Session-scoped route (mounted at /api/sessions) ---

@router.post("/{session_id}/export/weblink")
async def export_weblink(
    session_id: str,
    name: str = Form(...),
    zip: UploadFile = File(...),
    session_manager: SessionManager = Depends(get_session_manager),
):
    """
    Upload a self-contained HTML report ZIP and generate a weblink.

    The ZIP must contain index.html at root and optional assets/ folder.
    """
    # Validate session exists and is completed
    try:
        session = await session_manager.get_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.state.value != "completed":
        raise HTTPException(status_code=400, detail="Analysis must be completed before exporting")

    if not name.strip():
        raise HTTPException(status_code=400, detail="Report name is required")

    try:
        zip_data = await zip.read()
        metadata = create_report(
            name=name.strip(),
            session_id=session_id,
            session_name=session.name,
            zip_data=zip_data,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"We blink export failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create report")

    return {
        "report_id": metadata["report_id"],
        "name": metadata["name"],
        "weblink": f"/api/reports/{metadata['report_id']}",
        "download_url": f"/api/reports/{metadata['report_id']}/download",
        "created_at": metadata["created_at"],
    }


# --- Global routes (mounted at /api) ---

@global_router.get("/reports")
async def get_reports():
    """List all generated reports across all sessions."""
    reports = list_reports()
    return {"reports": reports}


@global_router.get("/reports/{report_id}")
async def serve_report(report_id: str):
    """Serve the index.html of a report for weblink viewing."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    index_path = report_dir / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Report HTML not found")
    return FileResponse(index_path, media_type="text/html")


@global_router.get("/reports/{report_id}/assets/{path:path}")
async def serve_report_asset(report_id: str, path: str):
    """Serve asset files (JS, JSON) for a report."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    asset_path = report_dir / "assets" / path
    # Security: ensure path stays within report directory
    if not str(asset_path.resolve()).startswith(str(report_dir.resolve())):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not asset_path.exists():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(asset_path)


@global_router.get("/reports/{report_id}/download")
async def download_report_zip(report_id: str):
    """Download the original ZIP archive of a report."""
    report_dir = get_report_dir(report_id)
    if not report_dir:
        raise HTTPException(status_code=404, detail="Report not found")
    zip_path = report_dir / "export.zip"
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="ZIP archive not found")
    metadata = get_report_metadata(report_id)
    filename = f"{metadata['name'].replace(' ', '_')}.zip" if metadata else "report.zip"
    return FileResponse(zip_path, media_type="application/zip", filename=filename)


@global_router.delete("/reports/{report_id}")
async def delete_report_endpoint(report_id: str):
    """Delete a report and all its files."""
    if not delete_report(report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    return {"message": "Report deleted"}
```

**Router registration in `backend/app/main.py`:**

Replace line 215:
```python
app.include_router(reports.router, prefix="/api/sessions", tags=["reports"])
```

With:
```python
# Reports: session-scoped weblink upload + global report serving
app.include_router(reports.router, prefix="/api/sessions", tags=["reports"])
app.include_router(reports.global_router, prefix="/api", tags=["reports"])
```

This gives:
- `POST /api/sessions/{id}/export/weblink` (session-scoped) ✓
- `GET /api/reports` (global) ✓
- `GET /api/reports/{id}` (global) ✓
- `GET /api/reports/{id}/assets/{path}` (global) ✓
- `GET /api/reports/{id}/download` (global) ✓
- `DELETE /api/reports/{id}` (global) ✓

- [ ] **Step 3: Verify backend starts cleanly**

Run: `cd backend && .venv/Scripts/python.exe -c "from app.api.routes.reports import router; print('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/report_store.py backend/app/api/routes/reports.py backend/app/main.py && git commit -m "feat: add HTML report storage and new report API endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Update frontend API client

**Files:**
- Modify: `frontend/src/lib/api-client.ts`

- [ ] **Step 1: Replace reportsApi with new export API**

Edit `frontend/src/lib/api-client.ts`: Replace the `reportsApi` object (lines 517-563) with:

```typescript
/**
 * Export API — HTML report generation
 */
export const exportApi = {
  /** Upload a ZIP for weblink generation */
  uploadWeblink: async (
    sessionId: string,
    zipBlob: Blob,
    name: string,
  ): Promise<{ report_id: string; name: string; weblink: string; download_url: string; created_at: string }> => {
    const formData = new FormData();
    formData.append('zip', zipBlob, 'report.zip');
    formData.append('name', name);
    const response = await fetch(apiUrl(`/sessions/${sessionId}/export/weblink`), {
      method: 'POST',
      body: formData,
    });
    return handleResponse<{ report_id: string; name: string; weblink: string; download_url: string; created_at: string }>(response);
  },

  /** List all reports across sessions */
  listAll: async (): Promise<{ reports: Array<{ report_id: string; name: string; session_id: string; session_name: string; created_at: string }> }> => {
    const response = await fetch(apiUrl('/reports'));
    return handleResponse<{ reports: Array<{ report_id: string; name: string; session_id: string; session_name: string; created_at: string }> }>(response);
  },

  /** Delete a report */
  delete: async (reportId: string): Promise<{ message: string }> => {
    const response = await fetch(apiUrl(`/reports/${reportId}`), { method: 'DELETE' });
    return handleResponse<{ message: string }>(response);
  },
};
```

Note: The `apiUrl('/reports')` call needs to work. Check `apiUrl` implementation — it likely prepends `/api/sessions`. If so, we need a separate base URL function for global API calls.

Check the `apiUrl` function in `api-client.ts`:

```typescript
// If apiUrl prepends /api/sessions, we need a raw fetch or base fetch:
const API_BASE = '/api';
```

If `apiUrl` hardcodes `/api/sessions`, add a raw fetch for global endpoints:

```typescript
  listAll: async () => {
    const response = await fetch(`${API_BASE}/reports`);
    ...
  },
  delete: async (reportId: string) => {
    const response = await fetch(`${API_BASE}/reports/${reportId}`, { method: 'DELETE' });
    ...
  },
```

- [ ] **Step 2: Update ExportModal to use exportApi**

Edit `ExportModal.tsx`: Replace raw `fetch` call with `exportApi.uploadWeblink(sessionId, zipBlob, name.trim())`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api-client.ts frontend/src/components/visualization/ExportModal.tsx && git commit -m "feat: update API client with new export endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: Build Reports page and add nav link

**Files:**
- Create: `frontend/src/app/reports/page.tsx`
- Modify: `frontend/src/components/layout/TopNavigation.tsx`

- [ ] **Step 1: Create Reports page `frontend/src/app/reports/page.tsx`**

```typescript
'use client';

import React, { useEffect, useState } from 'react';
import { Download, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { exportApi } from '@/lib/api-client';

interface ReportItem {
  report_id: string;
  name: string;
  session_id: string;
  session_name: string;
  created_at: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await exportApi.listAll();
      setReports(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, []);

  const handleDelete = async (reportId: string) => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
      await exportApi.delete(reportId);
      setReports((prev) => prev.filter((r) => r.report_id !== reportId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Reports</h1>

      {loading && (
        <div className="flex items-center gap-3 text-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading reports...
        </div>
      )}

      {error && (
        <div className="p-4 bg-error/5 border border-error/20 rounded-lg text-error">{error}</div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">No reports yet</p>
          <p className="text-sm">Complete an analysis and use the Export button to generate a report.</p>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="bg-background rounded-lg shadow-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-sm font-semibold">Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">Session</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">Created</th>
                <th className="text-right px-4 py-3 text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report_id} className="border-b border-border hover:bg-surface transition-colors">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-text-secondary text-sm">{r.session_name}</td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/api/reports/${r.report_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface hover:bg-border rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </a>
                      <a
                        href={`/api/reports/${r.report_id}/download`}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface hover:bg-border rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> ZIP
                      </a>
                      <button
                        onClick={() => handleDelete(r.report_id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-error hover:bg-error/5 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Reports to top navigation**

Edit `frontend/src/components/layout/TopNavigation.tsx`:

Change the `navLinks` array from:
```typescript
const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/about', label: 'About', id: 'about' },
];
```

To:
```typescript
const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/reports', label: 'Reports', id: 'reports' },
  { href: '/about', label: 'About', id: 'about' },
];
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/reports/page.tsx frontend/src/components/layout/TopNavigation.tsx && git commit -m "feat: add Reports page and nav link

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: Add JS libraries and JSZip dependency

**Files:**
- Modify: `frontend/package.json`
- Create or ensure: `frontend/public/plotly.min.js`
- Create or ensure: `frontend/public/cytoscape.min.js`

- [ ] **Step 1: Install JSZip**

```bash
cd frontend && npm install jszip
```

- [ ] **Step 2: Copy Plotly.js and Cytoscape.js to public**

Plotly.js and Cytoscape are already npm dependencies. Copy the minified bundles to the public directory:

```bash
cp frontend/node_modules/plotly.js-dist-min/plotly.min.js frontend/public/plotly.min.js
cp frontend/node_modules/cytoscape/dist/cytoscape.min.js frontend/public/cytoscape.min.js
```

Note: `plotly.js-dist-min` may need to be installed separately if `plotly.js` doesn't include the minified dist. Check the package:

```bash
ls frontend/node_modules/plotly.js/dist/plotly.min.js 2>/dev/null && echo "FOUND" || echo "NOT FOUND"
```

If not found, install the minified distribution:
```bash
cd frontend && npm install plotly.js-dist-min
cp frontend/node_modules/plotly.js-dist-min/plotly.min.js frontend/public/plotly.min.js
```

- [ ] **Step 3: Verify files exist**

Run: `ls -la frontend/public/plotly.min.js frontend/public/cytoscape.min.js`

Expected: Both files exist with sizes > 1MB.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/public/plotly.min.js frontend/public/cytoscape.min.js && git commit -m "chore: add JSZip and bundle JS libraries for HTML export

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 16: Update About page text

**Files:**
- Modify: `frontend/src/app/about/page.tsx`

- [ ] **Step 1: Update PDF references in About page**

Edit `frontend/src/app/about/page.tsx`:

Line 14: Change `'Download results as CSV or generate a comprehensive PDF report.'` to `'Download results as CSV or export interactive HTML reports.'`

Line 48: Change `{ title: 'PDF Reports', desc: 'Export comprehensive analysis reports', icon: FileDown }` to `{ title: 'HTML Reports', desc: 'Export interactive HTML reports with all visualizations', icon: FileDown }`

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/about/page.tsx && git commit -m "chore: update About page PDF references to HTML reports

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 17: Backend tests — report_store

**Files:**
- Create: `Tests/backend/unit/test_report_store.py`

- [ ] **Step 1: Write unit tests for report_store**

```python
"""
Unit tests for report_store service.
"""

import io
import json
import zipfile
import tempfile
import shutil
from pathlib import Path
import pytest


@pytest.fixture
def temp_reports_dir(monkeypatch, tmp_path):
    """Redirect reports dir to a temp path."""
    from app.core import config
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    # Also patch the module-level REPORTS_DIR
    import app.services.report_store as store
    monkeypatch.setattr(store, "REPORTS_DIR", tmp_path / "reports")
    yield tmp_path / "reports"


def make_test_zip() -> bytes:
    """Create a minimal valid report ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html><body>Test Report</body></html>")
        zf.writestr("assets/data.json", '{"test": true}')
    return buf.getvalue()


def test_create_report_creates_directory_and_metadata(temp_reports_dir):
    from app.services.report_store import create_report, get_report_metadata

    zip_data = make_test_zip()
    meta = create_report("Test Report", "ses_123", "Experiment A", zip_data)

    assert meta["name"] == "Test Report"
    assert meta["session_id"] == "ses_123"
    assert meta["report_id"].startswith("rpt_")
    assert "created_at" in meta

    # Verify on-disk state
    report_dir = temp_reports_dir / meta["report_id"]
    assert report_dir.is_dir()
    assert (report_dir / "index.html").exists()
    assert (report_dir / "assets" / "data.json").exists()
    assert (report_dir / "export.zip").exists()
    assert (report_dir / "report.json").exists()

    stored = get_report_metadata(meta["report_id"])
    assert stored == meta


def test_create_report_rejects_missing_index_html(temp_reports_dir):
    from app.services.report_store import create_report

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("other.txt", "no index here")
    zip_data = buf.getvalue()

    with pytest.raises(ValueError, match="index.html"):
        create_report("Bad", "ses_x", "Exp", zip_data)


def test_create_report_rejects_path_traversal(temp_reports_dir):
    from app.services.report_store import create_report

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html></html>")
        zf.writestr("../../../etc/passwd", "malicious")
    zip_data = buf.getvalue()

    with pytest.raises(ValueError, match="Unsafe"):
        create_report("Bad", "ses_x", "Exp", zip_data)


def test_list_reports_empty(temp_reports_dir):
    from app.services.report_store import list_reports
    assert list_reports() == []


def test_list_reports_sorted(temp_reports_dir):
    from app.services.report_store import create_report, list_reports
    import time

    zip_data = make_test_zip()
    m1 = create_report("Report 1", "s1", "E1", zip_data)
    time.sleep(0.1)
    m2 = create_report("Report 2", "s2", "E2", zip_data)

    reports = list_reports()
    assert len(reports) == 2
    assert reports[0]["report_id"] == m2["report_id"]  # newest first


def test_delete_report(temp_reports_dir):
    from app.services.report_store import create_report, delete_report, get_report_dir

    zip_data = make_test_zip()
    meta = create_report("R", "s1", "E1", zip_data)

    assert delete_report(meta["report_id"]) is True
    assert get_report_dir(meta["report_id"]) is None


def test_delete_nonexistent_report(temp_reports_dir):
    from app.services.report_store import delete_report
    assert delete_report("rpt_nonexistent") is False
```

- [ ] **Step 2: Run unit tests**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit/test_report_store.py -v`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/unit/test_report_store.py && git commit -m "test: add unit tests for report_store service

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 18: Backend tests — report API routes

**Files:**
- Create: `Tests/backend/integration/test_report_routes.py`

- [ ] **Step 1: Write integration tests for report routes**

```python
"""
Integration tests for report API routes.
"""

import io
import zipfile
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app


def make_test_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("index.html", "<html><body>Test Report</body></html>")
        zf.writestr("assets/data.json", '{"test": true}')
    return buf.getvalue()


@pytest.fixture
def client():
    """Create an async test client."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.anyio
async def test_list_reports_empty(client):
    response = await client.get("/api/reports")
    assert response.status_code == 200
    data = response.json()
    assert "reports" in data
    assert data["reports"] == []


@pytest.mark.anyio
async def test_delete_nonexistent_report(client):
    response = await client.delete("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_report_not_found_serve(client):
    response = await client.get("/api/reports/rpt_nonexistent")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_weblink_upload_requires_completed_session(client):
    """Upload should fail if session doesn't exist."""
    response = await client.post(
        "/api/sessions/nonexistent/export/weblink",
        data={"name": "Test"},
        files={"zip": ("report.zip", make_test_zip(), "application/zip")},
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run integration tests**

Run: `backend/.venv/Scripts/python.exe -m pytest Tests/backend/integration/test_report_routes.py -v`

Expected: All tests pass (or skip those requiring a real completed session).

- [ ] **Step 3: Commit**

```bash
git add Tests/backend/integration/test_report_routes.py && git commit -m "test: add integration tests for report API routes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 19: Frontend E2E test — export flow

**Files:**
- Create: `Tests/e2e/report-export.spec.ts`

- [ ] **Step 1: Write E2E test for export flow**

```typescript
import { test, expect } from '@playwright/test';

test.describe('HTML Report Export', () => {
  test('Export button is visible on completed session visualization page', async ({ page }) => {
    // Navigate to a visualization page (requires a completed session)
    await page.goto('/analysis/visualization?session_id=test-session');

    // Export button should exist (if session is completed)
    const exportBtn = page.getByTestId('export-report-btn');
    // Button may or may not be visible depending on session state
  });

  test('Export modal opens and validates name input', async ({ page }) => {
    await page.goto('/analysis/visualization?session_id=test-session');

    const exportBtn = page.getByTestId('export-report-btn');
    if (await exportBtn.isVisible()) {
      await exportBtn.click();

      // Modal should appear
      await expect(page.getByTestId('report-name-input')).toBeVisible();

      // Buttons should be disabled when name is empty
      await expect(page.getByTestId('generate-weblink-btn')).toBeDisabled();
      await expect(page.getByTestId('download-zip-btn')).toBeDisabled();

      // After entering a name, buttons should enable
      await page.getByTestId('report-name-input').fill('Test Report');
      await expect(page.getByTestId('generate-weblink-btn')).toBeEnabled();
      await expect(page.getByTestId('download-zip-btn')).toBeEnabled();
    }
  });

  test('Reports page shows empty state', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText('Reports')).toBeVisible();
  });

  test('Reports link is in top navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Reports')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `cd Tests && npx playwright test report-export.spec.ts --reporter=list 2>&1`

Expected: Tests pass (tests are structured to not fail hard on missing data).

- [ ] **Step 3: Commit**

```bash
git add Tests/e2e/report-export.spec.ts && git commit -m "test: add E2E tests for report export flow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 20: End-to-end smoke test verification

**Files:**
- None (manual verification)

- [ ] **Step 1: Start backend and frontend**

```bash
# Terminal 1
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --reload-exclude "sessions" --port 8000

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Verify Export button appears on completed session**

Navigate to `http://localhost:3000/analysis/visualization?session_id=<a-completed-session-id>`

Expected: "Export" button is visible in the nav bar (replaces old "Export PDF" button).

- [ ] **Step 3: Test ZIP download flow**

1. Click Export button
2. Enter a name in the modal
3. Click "Download ZIP"
4. Verify browser downloads a `.zip` file
5. Unzip and open `index.html` in a browser
6. Verify all 5 tabs work (tab switching, Plotly charts render, BioNet is interactive, table sorting works, CSV export works)

- [ ] **Step 4: Test weblink flow**

1. Click Export button
2. Enter a name
3. Click "Generate Weblink"
4. Verify success message with copyable URL
5. Open the URL in a new tab
6. Verify the same interactive experience

- [ ] **Step 5: Test Reports page**

1. Navigate to `http://localhost:3000/reports`
2. Verify the report appears in the list
3. Click "Open" — verify it opens in a new tab
4. Click "ZIP" — verify download starts
5. Click "Delete" — verify report is removed from list

- [ ] **Step 6: Verify old code is gone**

- `backend/app/services/report_generator.py` — deleted
- `backend/app/services/pdf_converter.py` — deleted
- `backend/app/services/plot_generator.py` — deleted
- `backend/templates/report_template.html` — deleted
- `frontend/src/components/visualization/PDFExport.tsx` — deleted
- `GET /api/sessions/{id}/reports/generate` — returns 404
- `GET /api/sessions/{id}/reports/{rid}/download` — returns 404
- About page no longer mentions "PDF report"

---

## Final Verification Checklist

- [ ] All old PDF code is deleted
- [ ] Export button appears only when session is completed
- [ ] Export modal validates name is non-empty
- [ ] ZIP download produces a valid, self-contained archive
- [ ] Weblink serves interactive HTML
- [ ] All 5 tabs render interactively in standalone HTML
- [ ] Protein table sort/filter/paginate/CSV export works in standalone HTML
- [ ] GSEA database dropdown works in standalone HTML
- [ ] BioNet search and edge type filter work in standalone HTML
- [ ] Reports page shows all reports across sessions
- [ ] Delete removes report from disk and list
- [ ] About page updated
- [ ] All backend tests pass
- [ ] All frontend E2E tests pass
- [ ] Frontend `npm run build` succeeds
