'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { QCData } from '@/types/api';
import { transformPCARowBased } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';
import { Maximize2, Download } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

function LazyPlot({ plotId, ...plotProps }: React.ComponentProps<typeof Plot> & { plotId: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={plotProps.style}>
      {visible ? (
        <Plot {...plotProps} style={{ width: '100%', height: '100%' }} useResizeHandler />
      ) : (
        <div data-testid={`${plotId}-skeleton`} className="h-full w-full animate-pulse bg-border/20 rounded" />
      )}
    </div>
  );
}

interface QCPlotsProps {
  data: QCData;
  conditionList?: string[];
  selectedComparison: string;
  onComparisonChange: (value: string) => void;
  comparisonOptions: Array<{ value: string; label: string }>;
}

// 24-color palette — enough distinct colors for any realistic condition count
const PALETTE_24 = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  '#D37295', '#665191', '#A05195', '#D45087', '#F95D6A',
  '#FF7C43', '#FFA600', '#003F5C', '#2F4B7C', '#488F31',
  '#DE425B', '#69B33D', '#F7B844', '#7B68EE',
];

// Deterministic HSL-based fallback for >24 conditions
function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Reconstruct synthetic data from box statistics so Plotly renders
// reliable normal box plots (its precomputed format is fragile).
function boxStatsToValues(s: Record<string, unknown>): number[] {
  const q1 = s.q1 as number, med = s.median as number, q3 = s.q3 as number;
  const lf = s.lowerfence as number, uf = s.upperfence as number;
  const out = (s.outliers as number[]) || [];
  // Build ~30 synthetic points that reproduce the box shape
  const vals: number[] = [lf, lf, lf];
  for (let i = 0; i < 6; i++) vals.push(lf + (q1 - lf) * (i / 6));
  for (let i = 0; i < 8; i++) vals.push(q1 + (med - q1) * (i / 8));
  for (let i = 0; i < 8; i++) vals.push(med + (q3 - med) * (i / 8));
  for (let i = 0; i < 6; i++) vals.push(q3 + (uf - q3) * (i / 6));
  vals.push(uf, uf, uf);
  vals.push(...out);
  return vals;
}

// Convert old-style raw lists or new-style box-stats dicts into Plotly box traces.
// Old: {condition: [values...]} or {condition: {replicate: [values...]}}
// New: {condition: {q1, median, q3, lowerfence, upperfence, outliers}}
function normalizeBoxData(
  raw: Record<string, unknown>,
  getColor: (c: string) => string,
  labelFn: (key: string, subKey?: string) => string,
  hovertemplate: string,
): Array<Record<string, unknown>> {
  const traces: Array<Record<string, unknown>> = [];
  for (const [key, val] of Object.entries(raw)) {
    const color = getColor(key);
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const first = Object.values(val as Record<string, unknown>)[0];
      if (typeof first === 'object' && first !== null && !Array.isArray(first) && 'q1' in (first as object)) {
        // Nested box-stats: {condition: {replicate: stats}}
        for (const [subKey, stats] of Object.entries(val as Record<string, unknown>)) {
          const name = labelFn(key, subKey);
          traces.push({
            y: boxStatsToValues(stats as Record<string, unknown>),
            x: [name], type: 'box', name,
            marker: { color, size: 3, outliercolor: color + '66' },
            boxpoints: 'outliers', hovertemplate,
          });
        }
      } else if ('q1' in (val as object)) {
        // Flat box-stats: {condition: stats}
        const name = labelFn(key);
        traces.push({
          y: boxStatsToValues(val as Record<string, unknown>),
          x: [name], type: 'box', name,
          marker: { color, size: 3, outliercolor: color + '66' },
          boxpoints: 'outliers', hovertemplate,
        });
      } else if (Array.isArray(first)) {
        // Old nested list format
        for (const [subKey, vals] of Object.entries(val as Record<string, unknown>)) {
          const arr = vals as number[];
          if (arr.length > 0) {
            traces.push({
              y: arr, x: [labelFn(key, subKey)], type: 'box',
              name: labelFn(key, subKey),
              marker: { color, size: 3, outliercolor: color + '66' },
              boxpoints: 'outliers', hovertemplate,
            });
          }
        }
      }
    } else if (Array.isArray(val)) {
      // Old flat list format
      const name = labelFn(key);
      traces.push({
        y: val, x: [name], type: 'box', name,
        marker: { color, size: 3, outliercolor: color + '66' },
        boxpoints: 'outliers', hovertemplate,
      });
    }
  }
  return traces;
}

export default function QCPlots({ data, conditionList, selectedComparison, onComparisonChange, comparisonOptions }: QCPlotsProps) {
  // Build a deterministic condition→color map from the condition list
  const conditionColors = useMemo(() => {
    const map: Record<string, string> = {};
    (conditionList || []).forEach((cond, i) => {
      map[cond] = PALETTE_24[i % PALETTE_24.length];
    });
    return map;
  }, [conditionList]);

  // Shared color resolver — always derives from condition list, never hashes unless unknown
  const getConditionColor = useCallback((condition: string) => {
    if (conditionColors[condition]) return conditionColors[condition];
    const key = Object.keys(conditionColors).find(
      k => k.toLowerCase() === condition.toLowerCase()
    );
    if (key) return conditionColors[key];
    return hashColor(condition);
  }, [conditionColors]);

  const pcaPlot = useMemo(() => {
    if (!data.pca) return null;

    const rowData = transformPCARowBased(
      data.pca.samples,
      data.pca.pc1,
      data.pca.pc2,
      data.pca.conditions
    );

    const conditionGroups: Record<string, typeof rowData> = {};
    rowData.forEach((d) => {
      (conditionGroups[d.condition] ??= []).push(d);
    });

    const traces = Object.entries(conditionGroups).map(([condition, points]) => ({
      x: points.map((d) => d.pc1),
      y: points.map((d) => d.pc2),
      mode: 'markers' as const,
      type: 'scatter' as const,
      name: condition,
      text: points.map((d) => d.sample),
      marker: {
        size: 12,
        color: getConditionColor(condition),
      },
      hovertemplate: '<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
    }));

    const nConditions = traces.length;
    const layout = {
      title: {
        text: `PCA Analysis (PC1: ${data.pca.pc1_variance.toFixed(1)}%, PC2: ${data.pca.pc2_variance.toFixed(1)}%)`,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: `PC1 (${data.pca.pc1_variance.toFixed(1)}%)`, font: { size: 12 } },
        zeroline: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: `PC2 (${data.pca.pc2_variance.toFixed(1)}%)`, font: { size: 12 } },
        zeroline: true,
        gridcolor: '#E5E7EB',
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        y: -0.15 * Math.ceil(nConditions / 4),
        x: 0.5,
        xanchor: 'center' as const,
        font: { size: 11 },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 20 + nConditions * 18 },
    };

    return { traces, layout };
  }, [data.pca, getConditionColor]);

  const pvalueDistPlot = useMemo(() => {
    const pvDist = selectedComparison && data.pvalue_distributions
      ? data.pvalue_distributions[selectedComparison]
      : data.pvalue_distribution;
    if (!pvDist) return null;

    const trace = {
      x: pvDist.bins.slice(0, -1).map((bin, i) =>
        (bin + pvDist.bins[i + 1]) / 2
      ),
      y: pvDist.counts,
      type: 'bar' as const,
      marker: {
        color: '#3B82F6',
        line: { color: '#2563EB', width: 1 },
      },
      hovertemplate: 'P-value: %{x:.3f}<br>Count: %{y}<extra></extra>',
    };

    const layout = {
      title: { text: 'P-value Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'P-value', font: { size: 12 } },
        range: [0, 1],
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      bargap: 0.1,
    };

    return { traces: [trace], layout };
  }, [data.pvalue_distribution, data.pvalue_distributions, selectedComparison]);

  const psmCVPlot = useMemo(() => {
    if (!data.psm_cv) return null;
    const traces = normalizeBoxData(
      data.psm_cv, getConditionColor,
      (c) => c,
      'CV: %{y:.1f}%<extra></extra>',
    );

    const nConditions = traces.length;
    const layout = {
      title: { text: 'PSM CVs by Condition (whiskers at 95th %ile)', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nConditions > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nConditions > 2 ? 120 : 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.psm_cv, getConditionColor]);

  const proteinCVPlot = useMemo(() => {
    if (!data.protein_cv) return null;
    const traces = normalizeBoxData(
      data.protein_cv, getConditionColor,
      (c) => c,
      'CV: %{y:.1f}%<extra></extra>',
    );

    const nConditions = traces.length;
    const layout = {
      title: { text: 'Protein CVs by Condition (whiskers at 95th %ile)', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nConditions > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nConditions > 2 ? 120 : 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.protein_cv, getConditionColor]);

  const psmIntensityPlot = useMemo(() => {
    const boxData = data.intensity_distributions?.psm_boxplot;
    if (!boxData || Object.keys(boxData).length === 0) return null;
    const traces = normalizeBoxData(
      boxData, getConditionColor,
      (c, r) => `${c} - ${r || ''}`,
      'Log2 Intensity: %{y:.2f}<extra></extra>',
    );

    const nTraces = traces.length;
    const layout = {
      title: { text: 'PSM Intensity Distribution', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nTraces > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      boxgap: 0.3,
      boxgroupgap: 0,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nTraces > 2 ? 120 : 50 },
      showlegend: nTraces <= 12,
      legend: { orientation: 'h' as const, y: -0.25 },
    };

    return { traces, layout };
  }, [data.intensity_distributions?.psm_boxplot, getConditionColor]);

  const proteinIntensityPlot = useMemo(() => {
    const boxData = data.intensity_distributions?.protein_boxplot;
    if (!boxData || Object.keys(boxData).length === 0) return null;
    const traces = normalizeBoxData(
      boxData, getConditionColor,
      (c) => c,
      'Intensity: %{y:.2f}<extra></extra>',
    );

    const nSamples = traces.length;
    const layout = {
      title: { text: 'Protein Intensity Distribution', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Intensity', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      boxgap: 0.3,
      boxgroupgap: 0,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: nSamples <= 12,
      legend: { orientation: 'h' as const, y: -0.25 },
    };

    return { traces, layout };
  }, [data.intensity_distributions?.protein_boxplot, getConditionColor]);

  const completenessPlot = useMemo(() => {
    if (!data.data_completeness) return null;

    const samples = Object.keys(data.data_completeness);
    const present = samples.map((s) => data.data_completeness![s].present);
    const missing = samples.map((s) => data.data_completeness![s].missing);
    const nSamples = samples.length;

    const traces = [
      {
        x: samples,
        y: present,
        name: 'Present',
        type: 'bar' as const,
        marker: { color: '#10B981' },
        hovertemplate: 'Present: %{y}<extra></extra>',
      },
      {
        x: samples,
        y: missing,
        name: 'Missing',
        type: 'bar' as const,
        marker: { color: '#EF4444' },
        hovertemplate: 'Missing: %{y}<extra></extra>',
      },
    ];

    const layout = {
      title: { text: 'Protein Data Completeness by Sample', font: { size: 14, color: '#111827' } },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.data_completeness]);

  const psmCompletenessPlot = useMemo(() => {
    if (!data.psm_completeness) return null;

    const samples = Object.keys(data.psm_completeness);
    const present = samples.map((s) => data.psm_completeness![s].present);
    const missing = samples.map((s) => data.psm_completeness![s].missing);
    const nSamples = samples.length;

    const traces = [
      {
        x: samples,
        y: present,
        name: 'Present',
        type: 'bar' as const,
        marker: { color: '#3B82F6' },
        hovertemplate: 'Present: %{y}<extra></extra>',
      },
      {
        x: samples,
        y: missing,
        name: 'Missing',
        type: 'bar' as const,
        marker: { color: '#F59E0B' },
        hovertemplate: 'Missing: %{y}<extra></extra>',
      },
    ];

    const layout = {
      title: { text: 'PSM Data Completeness by Sample', font: { size: 14, color: '#111827' } },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.psm_completeness]);

  const config = {
    displayModeBar: 'hover',
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    displaylogo: false,
    responsive: true,
  };

  const plots = [
    { id: 'pca', data: pcaPlot, title: 'PCA Analysis' },
    { id: 'pvalue', data: pvalueDistPlot, title: 'P-value Distribution', showComparisonDropdown: true },
    { id: 'psm-cv', data: psmCVPlot, title: 'PSM CVs' },
    { id: 'protein-cv', data: proteinCVPlot, title: 'Protein CVs' },
    { id: 'psm-intensity', data: psmIntensityPlot, title: 'PSM Intensity Distribution' },
    { id: 'protein-intensity', data: proteinIntensityPlot, title: 'Protein Intensity Distribution' },
    { id: 'completeness', data: completenessPlot, title: 'Protein Data Completeness' },
    { id: 'psm-completeness', data: psmCompletenessPlot, title: 'PSM Data Completeness' },
  ];

  const [expandedPlot, setExpandedPlot] = useState<string | null>(null);

  const handleDownload = (plotId: string) => {
    const plotElement = document.querySelector(`[data-testid="${plotId}-plot"] .js-plotly-plot`);
    if (plotElement) {
      // @ts-expect-error - Plotly is loaded globally
      window.Plotly.toImage(plotElement, { format: 'png', width: 1200, height: 800 })
        .then((dataUrl: string) => {
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `${plotId}-plot.png`;
          link.click();
        })
        .catch((err: unknown) => {
          console.error('Failed to download plot:', err);
        });
    }
  };

  return (
    <>
      <div data-testid="qc-plots-container" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {plots.map((plot) =>
          plot.data ? (
            <div
              key={plot.id}
              data-testid={`${plot.id}-plot`}
              className="bg-background rounded-lg border border-border p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-text-primary">{plot.title}</h3>
                <div className="flex items-center gap-2">
                  {plot.showComparisonDropdown && comparisonOptions.length > 1 && (
                    <SearchableSelect
                      options={comparisonOptions}
                      value={selectedComparison}
                      onChange={onComparisonChange}
                      placeholder="Select comparison..."
                      searchPlaceholder="Filter comparisons..."
                    />
                  )}
                  <button
                    data-testid={`expand-${plot.id}-btn`}
                    onClick={() => setExpandedPlot(plot.id)}
                    className="p-1.5 text-text-muted hover:text-text-primaryhover:bg-surface rounded-md transition-colors"
                    title="Expand plot"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    data-testid={`download-${plot.id}-btn`}
                    onClick={() => handleDownload(plot.id)}
                    className="p-1.5 text-text-muted hover:text-text-primaryhover:bg-surface rounded-md transition-colors"
                    title="Download plot"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="h-[480px]">
                <LazyPlot
                  plotId={plot.id}
                  data={plot.data.traces}
                  layout={plot.data.layout}
                  config={config}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          ) : (
            <div
              key={plot.id}
              data-testid={`${plot.id}-plot`}
              className="bg-surface rounded-lg border border-border p-4 flex items-center justify-center h-[480px]"
            >
              <div data-testid="no-data" className="text-center text-text-muted">
                <p className="text-lg font-medium">{plot.title}</p>
                <p className="text-sm mt-2">No data available</p>
              </div>
            </div>
          )
        )}
      </div>

      {expandedPlot && (
        <div
          data-testid="plot-modal"
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedPlot(null)}
        >
          <div
            className="bg-background rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">
                {plots.find(p => p.id === expandedPlot)?.title}
              </h2>
              <button
                data-testid="close-modal-btn"
                onClick={() => setExpandedPlot(null)}
                className="p-2 text-text-muted hover:text-text-primaryhover:bg-surface rounded-md transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 h-[600px]">
              {(() => {
                const plot = plots.find(p => p.id === expandedPlot);
                return plot?.data ? (
                  <Plot
                    data={plot.data.traces}
                    layout={{ ...plot.data.layout, margin: { l: 60, r: 30, t: 50, b: 60 } }}
                    config={config}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler={true}
                  />
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
