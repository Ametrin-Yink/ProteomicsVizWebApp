# GSEA Slim Index + On-Demand Computation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2.7GB pre-calculated GSEA results JSON with a slim index (~5-15MB), and compute running ES curves and heatmaps on-demand when a pathway is selected.

**Architecture:** During processing, save only pathway metadata (NES, FDR, pval, term, lead_genes) to JSON. Add two new API endpoints (`/plot` and `/heatmap`) that compute visualization data from raw gseapy files (`*.rnk`, `*.edb`) and `Protein_Abundances.tsv` on demand.

**Tech Stack:** FastAPI, Python (pandas, numpy), gseapy, Next.js 16, React 19, TypeScript, Plotly.js

---

### Task 1: Remove curve/heatmap from processing pipeline

**Files:**
- Modify: `backend/app/services/gsea_service.py:264-402` (`_run_single_gsea` method)

- [ ] **Step 1: Modify `_run_single_gsea` to skip curve/heatmap generation**

Remove the on-the-fly curve and heatmap generation inside the per-pathway loop. The slim `GSEAResult` will only contain: term, name, es, nes, pval, fdr, lead_genes, matched_genes.

Change the loop starting at line 327:

```python
            for _, row in results_df.iterrows():
                # Handle different column name formats
                term = str(row.get('Term', row.get('term', '')))
                nes = float(row.get('NES', row.get('nes', 0)))
                pval = float(row.get('NOM p-val', row.get('pval', 1)))
                fdr = float(row.get('FDR q-val', row.get('fdr', 1)))
                es = float(row.get('ES', row.get('es', 0)))

                # Get lead genes if available
                lead_genes = []
                if 'Lead_genes' in row:
                    lead_genes_str = str(row['Lead_genes'])
                    lead_genes = [g.strip() for g in lead_genes_str.split(';') if g.strip()]

                # Count matched genes
                matched_genes = int(row.get('Tag %', '0').split('/')[0]) if 'Tag %' in row else 0

                result = GSEAResult(
                    term=term,
                    name=term,
                    es=es,
                    nes=nes,
                    pval=pval,
                    fdr=fdr,
                    lead_genes=lead_genes,
                    matched_genes=matched_genes,
                    # running_es_curve, rank_metric_positions, heatmap_data are all None (default)
                )

                gsea_results.append(result)

                if result.significant:
                    significant += 1
                    if nes > 0:
                        overrepresented += 1
                    else:
                        underrepresented += 1
```

Key changes: remove lines 346-359 (running_es_curve, rank_metric_positions, heatmap_data generation). The `GSEAResult` constructor no longer passes those 3 fields — they default to `None` since they are `Optional` in the model.

- [ ] **Step 2: Keep the `_generate_running_es_curve` and `_generate_heatmap_data` methods**

These methods stay in the file — they will be called by the new on-demand endpoints (Tasks 2-3). Do NOT delete them.

- [ ] **Step 3: Verify the model still accepts `None` for the optional fields**

`backend/app/models/data.py` lines 158-170 already define these as `Optional` with `default=None`, so no change needed.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/gsea_service.py
git commit -m "refactor: remove pre-calculated curves/heatmaps from GSEA processing pipeline"
```

---

### Task 2: Add on-demand plot data endpoint

**Files:**
- Modify: `backend/app/api/routes/visualization.py`
- The `_generate_running_es_curve` method already exists in `gsea_service.py`

- [ ] **Step 1: Add imports at the top of `visualization.py`**

After the existing imports (around line 20), add:

```python
from app.services.gsea_service import GSEAService
```

Note: `gsea_service` is already a global singleton at the bottom of `gsea_service.py`.

- [ ] **Step 2: Add the `/plot` endpoint after the existing GSEA endpoint (line 456)**

```python
@router.get("/{session_id}/gsea/{database}/{term}/plot")
async def get_gsea_plot_data(
    session_id: str,
    database: str,
    term: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA plot data (running ES curve + rank metric positions) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Load slim GSEA results to get lead_genes and pathway metadata
    gsea_data = load_gsea_results(results_dir, database, session_id)
    results = gsea_data.get("results", [])

    # Find the specific pathway
    pathway = None
    for r in results:
        if r.get("term") == term:
            pathway = r
            break

    if pathway is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pathway '{term}' not found in {database}"
        )

    # Compute running ES curve on-demand from gseapy output files
    gsea_dir = results_dir / "gsea" / database

    rnk_file = gsea_dir / "gseapy.gene_set.0.rnk"
    if not rnk_file.exists():
        # Try alternate naming: gseapy uses the gene set name in the .rnk filename
        try:
            rnk_file = next(gsea_dir.glob("*.rnk"))
        except StopIteration:
            return create_response({
                "term": term,
                "es": pathway.get("es", 0),
                "nes": pathway.get("nes", 0),
                "running_es_curve": [],
                "rank_metric_positions": [],
            })

    try:
        rnk_df = await asyncio.to_thread(pd.read_csv, rnk_file, sep='\t', header=None)
        ranked_genes = rnk_df.iloc[:, 0].tolist()
        ranked_metrics = rnk_df.iloc[:, 1].tolist()
    except Exception as e:
        logger.warning(f"Could not read .rnk file: {e}")
        return create_response({
            "term": term,
            "es": pathway.get("es", 0),
            "nes": pathway.get("nes", 0),
            "running_es_curve": [],
            "rank_metric_positions": [],
        })

    lead_genes = pathway.get("lead_genes", [])
    nes = pathway.get("nes", 0)

    # Use existing method to compute curve
    running_es_curve = GSEAService()._generate_running_es_curve(
        ranked_genes, lead_genes, nes, ranked_metrics
    )

    # Compute rank metric positions
    lead_genes_set = set(lead_genes)
    rank_metric_positions = [
        [gene, i, float(metric)]
        for i, (gene, metric) in enumerate(zip(ranked_genes, ranked_metrics))
        if gene in lead_genes_set
    ]

    return create_response({
        "term": term,
        "es": pathway.get("es", 0),
        "nes": pathway.get("nes", 0),
        "running_es_curve": running_es_curve,
        "rank_metric_positions": rank_metric_positions,
    })
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add on-demand GSEA plot data endpoint"
```

---

### Task 3: Add on-demand heatmap endpoint

**Files:**
- Modify: `backend/app/api/routes/visualization.py`

- [ ] **Step 1: Add the `/heatmap` endpoint after the `/plot` endpoint**

```python
@router.get("/{session_id}/gsea/{database}/{term}/heatmap")
async def get_gsea_heatmap_data(
    session_id: str,
    database: str,
    term: str,
    store: SessionStore = Depends(get_session_store)
):
    """Get GSEA heatmap data (z-scores for leading edge genes) for a specific pathway."""
    session = await store.get(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found"
        )

    # Get results directory
    results_dir = settings.sessions_dir / session_id / "results"

    # Load slim GSEA results to get lead_genes
    gsea_data = load_gsea_results(results_dir, database, session_id)
    results = gsea_data.get("results", [])

    # Find the specific pathway
    pathway = None
    for r in results:
        if r.get("term") == term:
            pathway = r
            break

    if pathway is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pathway '{term}' not found in {database}"
        )

    lead_genes = pathway.get("lead_genes", [])
    if not lead_genes:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Load protein abundance data
    protein_file = results_dir / "Protein_Abundances.tsv"
    if not protein_file.exists():
        return create_response({"genes": [], "samples": [], "z_scores": []})

    try:
        protein_df = await asyncio.to_thread(pd.read_csv, protein_file, sep='\t')
    except Exception as e:
        logger.warning(f"Could not load protein abundance for heatmap: {e}")
        return create_response({"genes": [], "samples": [], "z_scores": []})

    # Use existing method to generate heatmap data (PSM_Count already excluded)
    heatmap_data = GSEAService()._generate_heatmap_data(protein_df, lead_genes)

    if heatmap_data is None:
        return create_response({"genes": [], "samples": [], "z_scores": []})

    return create_response(heatmap_data)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/routes/visualization.py
git commit -m "feat: add on-demand GSEA heatmap endpoint"
```

---

### Task 4: Add frontend API functions for new endpoints

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/types/api.ts`

- [ ] **Step 1: Add new types to `frontend/src/types/api.ts`**

After the `GSEAData` interface (around line 158), add:

```typescript
export interface GSEAPlotData {
  term: string;
  es: number;
  nes: number;
  running_es_curve: Array<[number, number]>;
  rank_metric_positions: Array<[string, number, number]>;
}

export interface GSEAHeatmapData {
  genes: string[];
  samples: string[];
  z_scores: number[][];
}
```

- [ ] **Step 2: Add API functions to `frontend/src/lib/api.ts`**

After the `getGSEAData` function (around line 98), add:

```typescript
// GSEA Plot Data (on-demand)
export async function getGSEAPlotData(
  sessionId: string,
  database: string,
  term: string
): Promise<GSEAPlotData> {
  return fetchApi<GSEAPlotData>(`/api/sessions/${sessionId}/gsea/${database}/${encodeURIComponent(term)}/plot`);
}

// GSEA Heatmap Data (on-demand)
export async function getGSEAHeatmapData(
  sessionId: string,
  database: string,
  term: string
): Promise<GSEAHeatmapData> {
  return fetchApi<GSEAHeatmapData>(`/api/sessions/${sessionId}/gsea/${database}/${encodeURIComponent(term)}/heatmap`);
}
```

- [ ] **Step 3: Add import for the new types at the top of `api.ts`**

Add `GSEAPlotData, GSEAHeatmapData` to the existing import from `@/types/api`:

```typescript
import type {
  ApiResponse,
  DEResultsData,
  QCData,
  GSEAData,
  GSEADatabase,
  ProteinAbundance,
  PSMAbundanceData,
  GSEAPlotData,
  GSEAHeatmapData,
} from '@/types/api';
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/lib/api.ts
git commit -m "feat: add GSEA plot/heatmap API client functions"
```

---

### Task 5: Update GSEAPlot component to fetch data on-demand

**Files:**
- Modify: `frontend/src/components/visualization/GSEAPlot.tsx`

- [ ] **Step 1: Rewrite GSEAPlot to fetch plot/heatmap data on-demand**

Replace the entire file content:

```tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GSEAResult, GSEAPlotData, GSEAHeatmapData } from '@/types/api';
import { getGSEAPlotData, getGSEAHeatmapData } from '@/lib/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface GSEAPlotProps {
  pathway: GSEAResult | null;
  sessionId: string;
  database: string;
}

export default function GSEAPlot({ pathway, sessionId, database }: GSEAPlotProps) {
  const [plotData, setPlotData] = useState<GSEAPlotData | null>(null);
  const [heatmapData, setHeatmapData] = useState<GSEAHeatmapData | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch plot and heatmap data when pathway changes
  useEffect(() => {
    if (!pathway || !sessionId || !database) {
      setPlotData(null);
      setHeatmapData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPlotData(null);
    setHeatmapData(null);

    async function fetchData() {
      try {
        const [plot, heatmap] = await Promise.all([
          getGSEAPlotData(sessionId, database, pathway.term),
          getGSEAHeatmapData(sessionId, database, pathway.term),
        ]);
        if (!cancelled) {
          setPlotData(plot);
          setHeatmapData(heatmap.data?.genes?.length ? heatmap : null);
        }
      } catch (err) {
        console.error('Failed to load GSEA visualization data:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [pathway?.term, sessionId, database]);

  // Generate Plotly traces from fetched data
  const renderData = useMemo(() => {
    if (!pathway || !plotData) return null;

    const xValues = plotData.running_es_curve.map(([rank]) => rank);
    const yValues = plotData.running_es_curve.map(([, es]) => es);

    // Rank metric distribution
    const maxRank = xValues.length > 0 ? Math.max(...xValues) : 100;
    const rankMetrics = new Array(xValues.length).fill(0);
    plotData.rank_metric_positions.forEach(([, rank, metric]) => {
      const index = Math.floor((rank / maxRank) * (xValues.length - 1));
      if (index >= 0 && index < rankMetrics.length) {
        rankMetrics[index] = metric;
      }
    });

    // Leading edge positions
    const leadingEdgePositions = plotData.rank_metric_positions.map(([, rank]) =>
      Math.floor((rank / maxRank) * (xValues.length - 1))
    );

    const zeroLineY = new Array(xValues.length).fill(0);

    // Heatmap
    const hasHeatmap = heatmapData && heatmapData.genes.length > 0;
    const mainPlotDomain = hasHeatmap ? [0, 0.7] : [0, 1];
    const heatmapDomain = hasHeatmap ? [0.75, 1] : [0, 0];

    const traces: Array<Record<string, unknown>> = [
      // Zero reference line
      {
        x: xValues,
        y: zeroLineY,
        type: 'scatter' as const,
        mode: 'lines' as const,
        line: { color: '#000000', width: 1, dash: 'dash' as const },
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hoverinfo: 'skip',
        showlegend: false,
      },
      // Running Enrichment Score
      {
        x: xValues,
        y: yValues,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Running ES',
        line: { color: '#E73564', width: 2 },
        fill: 'tozeroy' as const,
        fillcolor: pathway.es > 0 ? 'rgba(231, 53, 100, 0.3)' : 'rgba(0, 173, 239, 0.3)',
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hovertemplate: 'Rank: %{x}<br>ES: %{y:.3f}<extra></extra>',
      },
      // Leading edge markers
      ...(leadingEdgePositions.length > 0 ? [{
        x: leadingEdgePositions,
        y: leadingEdgePositions.map(() => 0),
        type: 'scatter' as const,
        mode: 'markers' as const,
        marker: { color: '#00ADEF', size: 8, symbol: 'line-ns' as const, line: { width: 2 } },
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hovertemplate: 'Leading Edge Gene<extra></extra>',
        showlegend: false,
      }] : []),
      // Rank metric distribution
      {
        x: xValues,
        y: rankMetrics,
        type: 'bar' as const,
        marker: { color: rankMetrics.map((v) => (v > 0 ? '#10B981' : '#EF4444')) },
        yaxis: 'y2' as const,
        xaxis: 'x' as const,
        hovertemplate: 'Rank: %{x}<br>Metric: %{y:.3f}<extra></extra>',
        showlegend: false,
      },
    ];

    if (hasHeatmap) {
      traces.push({
        z: heatmapData!.z_scores,
        x: heatmapData!.samples,
        y: heatmapData!.genes,
        type: 'heatmap',
        colorscale: 'RdBu',
        reversescale: true,
        zmid: 0,
        zmin: -3,
        zmax: 3,
        showscale: true,
        colorbar: { title: 'Z-score', titleside: 'right', thickness: 15, len: 0.5, y: 0.5, x: 1.02 },
        yaxis: 'y3',
        xaxis: 'x2',
        hovertemplate: 'Gene: %{y}<br>Sample: %{x}<br>Z-score: %{z:.2f}<extra></extra>',
      });
    }

    const layout: Record<string, unknown> = {
      title: { text: pathway.name, font: { size: 14, color: '#111827' } },
      xaxis: { title: { text: 'Gene Rank', font: { size: 12 } }, domain: mainPlotDomain, showgrid: false },
      yaxis: {
        title: { text: 'Running Enrichment Score', font: { size: 12 } },
        domain: [0.3, 1], gridcolor: '#E5E7EB', zeroline: true,
        zerolinecolor: '#000', zerolinewidth: 1,
      },
      yaxis2: { domain: [0, 0.2], showgrid: false, zeroline: false, showticklabels: false },
      ...(hasHeatmap ? {
        xaxis2: { domain: heatmapDomain, showgrid: false, tickangle: -45, tickfont: { size: 8 }, matches: 'x' },
        yaxis3: { domain: [0.3, 1], anchor: 'x2', showgrid: false, tickfont: { size: 8 }, autorange: 'reversed' },
      } : {}),
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: hasHeatmap ? 100 : 30, t: 50, b: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: 1.1 },
      annotations: [
        {
          x: 0.5, y: 0.25, xref: 'paper', yref: 'paper',
          text: `NES: ${pathway.nes.toFixed(3)} | P-value: ${pathway.pval.toExponential(2)} | FDR: ${pathway.fdr.toExponential(2)}`,
          showarrow: false, font: { size: 11, color: '#6B7280' },
        },
        ...(hasHeatmap ? [{
          x: 0.875, y: 1.05, xref: 'paper', yref: 'paper',
          text: 'Leading Edge Genes (Z-score)', showarrow: false,
          font: { size: 11, color: '#111827' },
        }] : []),
      ],
    };

    return { traces, layout };
  }, [pathway, plotData, heatmapData]);

  if (!pathway) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 flex items-center justify-center h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">GSEA Plot</p>
          <p className="text-sm mt-2">Select a pathway to view GSEA plot</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-center h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-500 text-sm">Loading pathway visualization...</p>
        </div>
      </div>
    );
  }

  const config = {
    displayModeBar: true,
    displaylogo: false,
    responsive: true,
  };

  return (
    <div data-testid="gsea-plot" className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="h-[400px]">
        {renderData && (
          <Plot
            data={renderData.traces}
            layout={renderData.layout}
            config={config}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/visualization/GSEAPlot.tsx
git commit -m "refactor: GSEAPlot fetches plot/heatmap data on-demand"
```

---

### Task 6: Update bioinformatics page to pass sessionId and database to GSEAPlot

**Files:**
- Modify: `frontend/src/app/analysis/visualization/bioinformatics/page.tsx`

- [ ] **Step 1: Update the GSEAPlot usage**

Around line 131, change:

```tsx
{selectedPathway && (
  <div className="w-full">
    <GSEAPlot
      pathway={selectedPathway}
      sessionId={sessionId}
      database={selectedDatabase}
    />
  </div>
)}
```

The `sessionId` and `selectedDatabase` are already available as state variables in the component.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/analysis/visualization/bioinformatics/page.tsx
git commit -m "feat: pass sessionId/database to GSEAPlot for on-demand fetching"
```

---

### Task 7: Verify and test

- [ ] **Step 1: Run backend lint**

```bash
cd backend && .venv/Scripts/python.exe -m py_compile app/services/gsea_service.py app/api/routes/visualization.py
```

- [ ] **Step 2: Run frontend type check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Run backend tests**

```bash
backend/.venv/Scripts/python.exe -m pytest Tests/backend/unit -v -k gsea
```

- [ ] **Step 4: Manual test**

Start backend and frontend, navigate to the bioinformatics page, select a pathway, verify:
- Plot renders with actual curve data
- Heatmap renders without PSM_Count column
- More pathways are marked significant (FDR < 0.25)
- FDR threshold correctly applied in significant_count

- [ ] **Step 5: Commit if all tests pass**

```bash
git commit --allow-empty -m "chore: verify GSEA slim index refactor"
```
