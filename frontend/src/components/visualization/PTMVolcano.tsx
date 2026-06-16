'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface PTMVolcanoProps {
  sessionId: string;
}

// Fixed thresholds for PTM volcano
const PVALUE_THRESHOLD = 0.05;
const LOGFC_THRESHOLD = 1;
const Y_THRESHOLD = -Math.log10(PVALUE_THRESHOLD);

// Color palette matching existing VolcanoPlot
const COLOR_UP = '#E73564';
const COLOR_DOWN = '#00ADEF';
const COLOR_NS = '#6B7280';
const THRESHOLD_LINE_COLOR = '#9CA3AF';

interface PanelConfig {
  key: string;
  title: string;
  dataKey: string; // key in comparison object, e.g. 'ptm_model'
  fcKey: string;   // field in row for logFC
  pvalKey: string;  // field in row for p-value
  adjPvalKey: string;
}

const PANELS: PanelConfig[] = [
  { key: 'ptm', title: 'PTM Model', dataKey: 'ptm_model', fcKey: 'ptmLog2FC', pvalKey: 'ptmPvalue', adjPvalKey: 'ptmAdjPvalue' },
  { key: 'protein', title: 'Protein Model', dataKey: 'protein_model', fcKey: 'proteinLog2FC', pvalKey: 'proteinPvalue', adjPvalKey: 'proteinAdjPvalue' },
  { key: 'adjusted', title: 'Adjusted Model', dataKey: 'adjusted_model', fcKey: 'adjustedLog2FC', pvalKey: 'adjustedPvalue', adjPvalKey: 'adjustedAdjPvalue' },
];

/** Attempt to extract a numeric field from a row dict, trying multiple key variants. */
function getNumeric(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

/** Build log2FC and p-value from a row using multiple key fallbacks. */
function getFCPval(row: Record<string, unknown>, fcKeys: string[], pvalKeys: string[]): { logFC: number; pval: number } {
  return {
    logFC: getNumeric(row, ...fcKeys, 'log2FC', 'logFC'),
    pval: getNumeric(row, ...pvalKeys, 'pvalue', 'Pvalue', 'p_val') || 1,
  };
}

/** Get a stable identifier for a point for hover display. */
function getPointId(row: Record<string, unknown>): string {
  return String(row.site ?? row.Protein ?? row.protein ?? row.id ?? '');
}

function getGlobalProtein(row: Record<string, unknown>): string {
  return String(row.globalProtein ?? row.GlobalProtein ?? row.Protein ?? row.protein ?? '');
}

/** Get -log10 of p-value, clamped to avoid infinity. */
function negLog10P(pval: number): number {
  return -Math.log10(Math.max(pval, 1e-300));
}

interface VolcanoPanelProps {
  rows: Record<string, unknown>[];
  panel: PanelConfig;
}

/** Single volcano plot panel. */
function VolcanoPanel({ rows, panel }: VolcanoPanelProps) {
  const { plotData, shapes, dynamicMaxY } = useMemo(() => {
    const fcKeys = [panel.fcKey, `log2FC_${panel.key}`, 'log2FC', 'logFC'];
    const pvalKeys = [panel.pvalKey, `pvalue_${panel.key}`, 'pvalue', 'Pvalue'];

    const pts = rows.map((row) => {
      const { logFC, pval } = getFCPval(row, fcKeys, pvalKeys);
      const y = negLog10P(pval);
      const isSig = pval < PVALUE_THRESHOLD && Math.abs(logFC) > LOGFC_THRESHOLD;
      const color = !isSig ? COLOR_NS : logFC > 0 ? COLOR_UP : COLOR_DOWN;
      const pointId = getPointId(row);
      const globalProt = getGlobalProtein(row);
      return { logFC, y, color, pointId, globalProt, pval };
    });

    const dynamicMaxY = Math.max(2, Math.ceil(Math.max(0.1, ...pts.map((p) => p.y)) * 1.15));

    const hoverText = pts.map((p) =>
      `<b>${p.pointId}</b><br>` +
      `Protein: ${p.globalProt}<br>` +
      `Log2 FC: ${p.logFC.toFixed(3)}<br>` +
      `P-value: ${p.pval.toExponential(2)}`
    );

    const trace = {
      x: pts.map((p) => p.logFC),
      y: pts.map((p) => p.y),
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: {
        color: pts.map((p) => p.color),
        size: 6,
        opacity: 0.7,
      },
      text: hoverText,
      hoverinfo: 'text' as const,
      hoverlabel: { namelength: -1, font: { size: 12 } },
      name: panel.title,
    };

    const shapes: Array<Record<string, unknown>> = [];
    const maxX = Math.max(1, ...pts.map((p) => Math.abs(p.logFC))) * 1.15;

    // Vertical threshold lines at +/- log2FC
    shapes.push({
      type: 'line',
      x0: -LOGFC_THRESHOLD,
      x1: -LOGFC_THRESHOLD,
      y0: 0,
      y1: dynamicMaxY,
      line: { color: THRESHOLD_LINE_COLOR, width: 1, dash: 'dash' },
    });
    shapes.push({
      type: 'line',
      x0: LOGFC_THRESHOLD,
      x1: LOGFC_THRESHOLD,
      y0: 0,
      y1: dynamicMaxY,
      line: { color: THRESHOLD_LINE_COLOR, width: 1, dash: 'dash' },
    });

    // Horizontal threshold line at p=0.05
    shapes.push({
      type: 'line',
      x0: -maxX,
      x1: maxX,
      y0: Y_THRESHOLD,
      y1: Y_THRESHOLD,
      line: { color: THRESHOLD_LINE_COLOR, width: 1, dash: 'dash' },
    });

    return { plotData: [trace], shapes, dynamicMaxY };
  }, [rows, panel]);

  const layout = useMemo(() => ({
    title: { text: panel.title, font: { size: 14, color: '#111827' } },
    xaxis: {
      title: { text: 'log₂(Fold Change)', font: { size: 12 } },
      zeroline: true,
      zerolinecolor: '#D1D5DB',
      zerolinewidth: 1,
      gridcolor: '#E5E7EB',
      fixedrange: true,
    },
    yaxis: {
      title: { text: '-log₁₀(p-value)', font: { size: 12 } },
      range: [0, dynamicMaxY],
      zeroline: true,
      zerolinecolor: '#D1D5DB',
      zerolinewidth: 1,
      gridcolor: '#E5E7EB',
      fixedrange: true,
    },
    shapes,
    showlegend: false,
    hovermode: 'closest' as const,
    dragmode: false as const,
    plot_bgcolor: '#FFFFFF',
    paper_bgcolor: '#FFFFFF',
    margin: { l: 50, r: 20, t: 40, b: 50 },
  }), [panel.title, dynamicMaxY, shapes]);

  const config = useMemo(() => ({
    displayModeBar: 'hover',
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'zoom2d', 'pan2d'],
    displaylogo: false,
    responsive: true,
  }), []);

  if (rows.length === 0) {
    return (
      <div
        className="bg-background rounded-lg border border-border p-4 flex items-center justify-center h-[400px]"
        data-testid={`volcano-panel-${panel.key}-empty`}
      >
        <p className="text-sm text-text-muted">No data available for {panel.title}</p>
      </div>
    );
  }

  return (
    <div
      className="bg-background rounded-lg border border-border p-4"
      data-testid={`volcano-panel-${panel.key}`}
    >
      <div className="w-full h-[400px]">
        <Plot
          data={plotData}
          layout={layout}
          config={config}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler={true}
        />
      </div>
    </div>
  );
}

export default function PTMVolcano({ sessionId }: PTMVolcanoProps) {
  const [comparisons, setComparisons] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/sessions/${sessionId}/ptm/results`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const comps = json.data?.comparisons ?? json.comparisons ?? [];
        setComparisons(comps);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const currentComparison = comparisons[selectedIdx] as Record<string, unknown> | undefined;
  const label = String(currentComparison?.label ?? '');

  const ptmRows = (currentComparison?.ptm_model as Record<string, unknown>[] | undefined) ?? [];
  const proteinRows = (currentComparison?.protein_model as Record<string, unknown>[] | undefined) ?? [];
  const adjustedRows = (currentComparison?.adjusted_model as Record<string, unknown>[] | undefined) ?? [];

  const hasProtein = proteinRows.length > 0;
  const hasAdjusted = adjustedRows.length > 0;

  // Determine which panels to show
  const visiblePanels = useMemo(() => {
    const panels: PanelConfig[] = [PANELS[0]]; // PTM always shown
    if (hasProtein) panels.push(PANELS[1]);
    if (hasAdjusted) panels.push(PANELS[2]);
    return panels;
  }, [hasProtein, hasAdjusted]);

  const gridClass = visiblePanels.length === 1
    ? 'grid-cols-1 max-w-2xl mx-auto'
    : visiblePanels.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-3';

  const comparisonLabels = comparisons.map((c) => String(c.label ?? ''));

  const handleComparisonChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedIdx(Number(e.target.value));
  }, []);

  if (loading) {
    return (
      <div data-testid="ptm-volcano-container" className="bg-background rounded-lg border border-border p-8">
        <div className="flex items-center justify-center h-[300px]">
          <div className="flex items-center gap-2 text-text-muted">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" data-testid="loading-spinner">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading PTM volcano data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="ptm-volcano-container" className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-error text-sm mb-2">Failed to load PTM volcano data.</p>
          <p className="text-text-muted text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!currentComparison) {
    return (
      <div data-testid="ptm-volcano-container" className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No PTM results available for this session.</p>
          <p className="text-text-muted text-xs mt-1">Run the PTM pipeline to generate volcano plots.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="ptm-volcano-container" className="bg-background rounded-lg border border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text-primary">PTM Volcano Plot</h3>
          {comparisonLabels.length > 1 && (
            <select
              value={selectedIdx}
              onChange={handleComparisonChange}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-text-primary"
              data-testid="comparison-select"
            >
              {comparisonLabels.map((l, i) => (
                <option key={l} value={i}>{l.replace(/_vs_/g, ' vs ')}</option>
              ))}
            </select>
          )}
        </div>
        {label && (
          <p className="text-sm text-text-muted mt-1">
            Comparison: {label.replace(/_vs_/g, ' vs ')}
          </p>
        )}
      </div>

      {/* Legend bar */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLOR_UP }}></span>
            <span>Upregulated (log2FC &gt; 1, p &lt; 0.05)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLOR_DOWN }}></span>
            <span>Downregulated (log2FC &lt; -1, p &lt; 0.05)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLOR_NS }}></span>
            <span>Not Significant</span>
          </div>
        </div>
      </div>

      {/* Mode A note */}
      {!hasProtein && (
        <div className="px-4 pt-3" data-testid="mode-a-notice">
          <p className="text-xs text-text-muted">
            Global proteome data not available. Only the PTM model is shown.
          </p>
        </div>
      )}

      {/* Volcano panels */}
      <div className={`grid ${gridClass} gap-4 p-4`}>
        {visiblePanels.map((panel) => {
          const rows = panel.dataKey === 'ptm_model' ? ptmRows
            : panel.dataKey === 'protein_model' ? proteinRows
            : adjustedRows;
          return <VolcanoPanel key={panel.key} rows={rows} panel={panel} />;
        })}
      </div>

      {/* Threshold indicator */}
      <div data-testid="threshold-lines" className="px-4 pb-3 text-xs text-text-muted text-center">
        Threshold lines: |log2FC| = {LOGFC_THRESHOLD}, P-value = {PVALUE_THRESHOLD}
      </div>
    </div>
  );
}
