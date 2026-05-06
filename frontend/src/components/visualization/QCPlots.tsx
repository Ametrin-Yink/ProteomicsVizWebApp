'use client';

import React, { useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { QCData } from '@/types/api';
import { transformPCARowBased } from '@/lib/utils';
import { calculateKDE } from '@/lib/kde';
import { Maximize2, Download } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface QCPlotsProps {
  data: QCData;
  conditionList?: string[];
  selectedComparison?: string;
}

// KDE color palette shared by intensity plots (stable reference)
const kdeSampleColors = [
  '#00ADEF', '#E73564', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#D946EF',
];

export default function QCPlots({ data, conditionList, selectedComparison }: QCPlotsProps) {
  const TABLEAU_10 = [
    '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
    '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  ];

  // Build a deterministic condition→color map from the condition list
  const conditionColors = useMemo(() => {
    const map: Record<string, string> = {};
    (conditionList || []).forEach((cond, i) => {
      map[cond] = TABLEAU_10[i % TABLEAU_10.length];
    });
    return map;
  }, [conditionList]);

  // PSM CV color: direct lookup from condition list
  const getConditionColor = useCallback((condition: string) => {
    if (conditionColors[condition]) return conditionColors[condition];
    const key = Object.keys(conditionColors).find(
      k => k.toLowerCase() === condition.toLowerCase()
    );
    if (key) return conditionColors[key];
    // Hash-based fallback for unknown conditions
    let hash = 0;
    for (let i = 0; i < condition.length; i++) {
      hash = ((hash << 5) - hash) + condition.charCodeAt(i);
      hash |= 0;
    }
    return TABLEAU_10[Math.abs(hash) % TABLEAU_10.length];
  }, [conditionColors]);

  // Protein CV uses a shifted palette (offset by 4) for visual distinction
  const getProteinConditionColor = useCallback((condition: string) => {
    const shift = 4;
    // Look up the condition index from conditionList for deterministic shift
    const getIndex = (c: string): number => {
      const exact = conditionList?.indexOf(c);
      if (exact !== undefined && exact >= 0) return exact;
      const key = conditionList?.find(k => k.toLowerCase() === c.toLowerCase());
      return key ? conditionList!.indexOf(key) : -1;
    };
    const idx = getIndex(condition);
    if (idx >= 0) return TABLEAU_10[(idx + shift) % TABLEAU_10.length];
    // Hash-based fallback for unknown conditions
    let hash = 0;
    for (let i = 0; i < condition.length; i++) {
      hash = ((hash << 5) - hash) + condition.charCodeAt(i);
      hash |= 0;
    }
    return TABLEAU_10[(Math.abs(hash) + shift) % TABLEAU_10.length];
  }, [conditionList]);

  // 1. PCA Plot - Color by sample
  const pcaPlot = useMemo(() => {
    if (!data.pca) return null;

    const rowData = transformPCARowBased(
      data.pca.samples,
      data.pca.pc1,
      data.pca.pc2,
      data.pca.conditions
    );

    // Assign colors based on condition but ensure unique colors per sample
    const sampleColors = rowData.map((d) => getConditionColor(d.condition));

    const trace = {
      x: rowData.map((d) => d.pc1),
      y: rowData.map((d) => d.pc2),
      mode: 'markers+text' as const,
      type: 'scatter' as const,
      text: rowData.map((d) => d.sample),
      textposition: 'top center' as const,
      marker: {
        size: 12,
        color: sampleColors,
      },
      hovertemplate: '<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
    };

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
      showlegend: false,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 80 },
    };

    return { traces: [trace], layout };
  }, [data.pca, getConditionColor]);

  // 2. P-value Distribution (per-comparison if selectedComparison is provided)
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

  // 3. PSM CVs - show 95th percentile top
  const psmCVPlot = useMemo(() => {
    if (!data.psm_cv) return null;

    // Filter values to 95th percentile
    const filteredCV: { [condition: string]: number[] } = {};
    Object.entries(data.psm_cv).forEach(([condition, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index];
      filteredCV[condition] = values.filter(v => v <= p95);
    });

    const traces = Object.entries(filteredCV).map(([condition, values]) => ({
      y: values,
      type: 'violin' as const,
      name: condition,
      box: { visible: true },
      line: { color: getConditionColor(condition) },
      fillcolor: getConditionColor(condition) + '80', // 50% opacity hex
      hovertemplate: 'CV: %{y:.1f}%<extra></extra>',
      // Hide individual points - only show violin and box
      points: false,
      jitter: 0,
      pointpos: 0,
    }));

    const layout = {
      title: { text: 'PSM CVs by Condition (95% of data)', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        title: { text: 'Condition', font: { size: 12 } },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.psm_cv, getConditionColor]);

  // 3b. Protein CVs (with different colors) - show 95th percentile top
  const proteinCVPlot = useMemo(() => {
    if (!data.protein_cv) return null;

    // Filter values to 95th percentile
    const filteredCV: { [condition: string]: number[] } = {};
    Object.entries(data.protein_cv).forEach(([condition, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index];
      filteredCV[condition] = values.filter(v => v <= p95);
    });

    const traces = Object.entries(filteredCV).map(([condition, values]) => ({
      y: values,
      type: 'violin' as const,
      name: condition,
      box: { visible: true },
      line: { color: getProteinConditionColor(condition) },
      fillcolor: getProteinConditionColor(condition) + '80', // 50% opacity hex
      hovertemplate: 'CV: %{y:.1f}%<extra></extra>',
      // Hide individual points - only show violin and box
      points: false,
      jitter: 0,
      pointpos: 0,
    }));

    const layout = {
      title: { text: 'Protein CVs by Condition (95% of data)', font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        title: { text: 'Condition', font: { size: 12 } },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.protein_cv, getProteinConditionColor]);

  // Pre-compute KDE data for PSM intensity distribution with memoization
  const psmKDEData = useMemo(() => {
    if (!data.intensity_distributions?.psm) return null;

    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.psm).forEach(([, replicates]) => {
      Object.entries(replicates).forEach(([, values]) => {
        allValues = allValues.concat(values);
      });
    });

    const min = allValues.reduce((a, b) => Math.min(a, b), Infinity);
    const max = allValues.reduce((a, b) => Math.max(a, b), -Infinity);
    const range = { min, max };

    let colorIndex = 0;
    const kdes: Array<{
      name: string;
      x: number[];
      y: number[];
      color: string;
    }> = [];

    Object.entries(data.intensity_distributions.psm).forEach(([condition, replicates]) => {
      Object.entries(replicates).forEach(([replicate, values]) => {
        const kde = calculateKDE(values);
        if (kde.x.length > 0) {
          const color = kdeSampleColors[colorIndex % kdeSampleColors.length];
          colorIndex++;
          kdes.push({
            name: `${condition} - ${replicate}`,
            x: kde.x,
            y: kde.y,
            color,
          });
        }
      });
    });

    return { kdes, range };
  }, [data.intensity_distributions?.psm]);

  // 4. PSM Intensity Distribution - KDE curves (lines) showing all data
  const psmIntensityPlot = useMemo(() => {
    if (!psmKDEData) return null;

    const traces: Array<{
      x: number[];
      y: number[];
      type: 'scatter';
      mode: 'lines';
      name: string;
      line: { color: string; width: number };
      fill?: 'tozeroy';
      fillcolor?: string;
      hovertemplate: string;
    }> = [];

    psmKDEData.kdes.forEach((kde) => {
      traces.push({
        x: kde.x,
        y: kde.y,
        type: 'scatter',
        mode: 'lines',
        name: kde.name,
        line: { color: kde.color, width: 2 },
        fill: 'tozeroy',
        fillcolor: kde.color + '33', // 20% opacity hex
        hovertemplate: 'Log2 Intensity: %{x:.2f}<br>Density: %{y:.4f}<extra></extra>',
      });
    });

    const layout = {
      title: { text: 'PSM Intensity Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        range: [psmKDEData.range.min, psmKDEData.range.max],
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Density', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [psmKDEData]);

  // Pre-compute KDE data for Protein intensity distribution with memoization
  const proteinKDEData = useMemo(() => {
    if (!data.intensity_distributions?.protein) return null;

    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.protein).forEach(([, values]) => {
      allValues = allValues.concat(values);
    });

    const globalMin = allValues.reduce((a, b) => Math.min(a, b), Infinity);
    const globalMax = allValues.reduce((a, b) => Math.max(a, b), -Infinity);
    const range = { min: globalMin, max: globalMax };

    let colorIndex = 0;
    const kdes: Array<{
      name: string;
      x: number[];
      y: number[];
      color: string;
    }> = [];

    Object.entries(data.intensity_distributions.protein).forEach(([sampleName, values]) => {
      const kde = calculateKDE(values);
      if (kde.x.length > 0) {
        const color = kdeSampleColors[colorIndex % kdeSampleColors.length];
        colorIndex++;
        kdes.push({
          name: sampleName,
          x: kde.x,
          y: kde.y,
          color,
        });
      }
    });

    return { kdes, range };
  }, [data.intensity_distributions?.protein]);

  // 5. Protein Intensity Distribution - Line plots (KDE) showing all data
  const proteinIntensityPlot = useMemo(() => {
    if (!proteinKDEData) return null;

    const traces: Array<{
      x: number[];
      y: number[];
      type: 'scatter';
      mode: 'lines';
      name: string;
      line: { color: string; width: number };
      fill?: 'tozeroy';
      fillcolor?: string;
      hovertemplate: string;
    }> = [];

    proteinKDEData.kdes.forEach((kde) => {
      traces.push({
        x: kde.x,
        y: kde.y,
        type: 'scatter',
        mode: 'lines',
        name: kde.name,
        line: { color: kde.color, width: 2 },
        fill: 'tozeroy',
        fillcolor: kde.color + '33', // 20% opacity hex
        hovertemplate: 'Intensity: %{x:.2f}<br>Density: %{y:.4f}<extra></extra>',
      });
    });

    const layout = {
      title: { text: 'Protein Intensity Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Intensity', font: { size: 12 } },
        range: [proteinKDEData.range.min, proteinKDEData.range.max],
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Density', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.2 },
    };

    return { traces, layout };
  }, [proteinKDEData]);

  // 6. Data Completeness - Protein Level
  const completenessPlot = useMemo(() => {
    if (!data.data_completeness) return null;

    const samples = Object.keys(data.data_completeness);
    const present = samples.map((s) => data.data_completeness![s].present);
    const missing = samples.map((s) => data.data_completeness![s].missing);

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
        title: { text: 'Sample', font: { size: 12 } },
        tickangle: -45,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 100 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.data_completeness]);

  // 6b. Data Completeness - PSM Level
  const psmCompletenessPlot = useMemo(() => {
    if (!data.psm_completeness) return null;

    const samples = Object.keys(data.psm_completeness);
    const present = samples.map((s) => data.psm_completeness![s].present);
    const missing = samples.map((s) => data.psm_completeness![s].missing);

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
        title: { text: 'Sample', font: { size: 12 } },
        tickangle: -45,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 100 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.psm_completeness]);

  const config = {
    displayModeBar: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    displaylogo: false,
    responsive: true,
  };

  const plots = [
    { id: 'pca', data: pcaPlot, title: 'PCA Analysis' },
    { id: 'pvalue', data: pvalueDistPlot, title: 'P-value Distribution' },
    { id: 'psm-cv', data: psmCVPlot, title: 'PSM CVs' },
    { id: 'protein-cv', data: proteinCVPlot, title: 'Protein CVs' },
    { id: 'psm-intensity', data: psmIntensityPlot, title: 'PSM Intensity Distribution' },
    { id: 'protein-intensity', data: proteinIntensityPlot, title: 'Protein Intensity Distribution' },
    { id: 'completeness', data: completenessPlot, title: 'Protein Data Completeness' },
    { id: 'psm-completeness', data: psmCompletenessPlot, title: 'PSM Data Completeness' },
  ];

  // State for expanded plot modal
  const [expandedPlot, setExpandedPlot] = useState<string | null>(null);

  // Handle download plot
  const handleDownload = (plotId: string) => {
    // Trigger download using Plotly's toImage
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
              {/* Plot header with actions */}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-text-primary">{plot.title}</h3>
                <div className="flex items-center gap-2">
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
              <div className="h-[400px]">
                <Plot
                  data={plot.data.traces}
                  layout={plot.data.layout}
                  config={config}
                  style={{ width: '100%', height: '100%' }}
                  useResizeHandler={true}
                />
              </div>
            </div>
          ) : (
            <div
              key={plot.id}
              data-testid={`${plot.id}-plot`}
              className="bg-surface rounded-lg border border-border p-4 flex items-center justify-center h-[400px]"
            >
              <div data-testid="no-data" className="text-center text-text-muted">
                <p className="text-lg font-medium">{plot.title}</p>
                <p className="text-sm mt-2">No data available</p>
              </div>
            </div>
          )
        )}
      </div>

      {/* Expanded Plot Modal */}
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
