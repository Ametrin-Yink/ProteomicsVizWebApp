'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { QCData } from '@/types/api';
import { transformPCARowBased } from '@/lib/utils';
import { calculateKDE } from '@/lib/kde';
import { Maximize2, Download } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface QCPlotsProps {
  data: QCData;
  treatment?: string;
  control?: string;
}

export default function QCPlots({ data, treatment, control }: QCPlotsProps) {
  // Color by treatment/control groups from session config
  const treatmentColor = '#E73564';
  const controlColor = '#00ADEF';

  const getConditionColor = (condition: string) => {
    if (treatment && condition.toLowerCase() === treatment.toLowerCase()) return treatmentColor;
    if (control && condition.toLowerCase() === control.toLowerCase()) return controlColor;
    // Fallback: if treatment/control not available, use default mapping
    if (condition.includes('INCZ')) return treatmentColor;
    if (condition === 'DMSO' || condition === 'Control') return controlColor;
    return '#6B7280';
  };

  // Protein CV uses different colors from PSM CV for visual distinction
  const proteinTreatmentColor = '#F59E0B';
  const proteinControlColor = '#10B981';

  const getProteinConditionColor = (condition: string) => {
    if (treatment && condition.toLowerCase() === treatment.toLowerCase()) return proteinTreatmentColor;
    if (control && condition.toLowerCase() === control.toLowerCase()) return proteinControlColor;
    // Fallback: if treatment/control not available, use default mapping
    if (condition.includes('INCZ')) return proteinTreatmentColor;
    if (condition === 'DMSO' || condition === 'Control') return proteinControlColor;
    return '#6B7280';
  };

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
  }, [data.pca, treatment, control]);

  // 2. P-value Distribution
  const pvalueDistPlot = useMemo(() => {
    if (!data.pvalue_distribution) return null;

    const trace = {
      x: data.pvalue_distribution.bins.slice(0, -1).map((bin, i) =>
        (bin + data.pvalue_distribution!.bins[i + 1]) / 2
      ),
      y: data.pvalue_distribution.counts,
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
  }, [data.pvalue_distribution]);

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
  }, [data.psm_cv, treatment, control]);

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
  }, [data.protein_cv, treatment, control]);

  // 4. PSM Intensity Distribution - KDE curves (lines) showing all data
  const psmIntensityPlot = useMemo(() => {
    if (!data.intensity_distributions?.psm) return null;

    // Collect all values for range calculation (all data, not 90%)
    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.psm).forEach(([, replicates]) => {
      Object.entries(replicates).forEach(([, values]) => {
        allValues = allValues.concat(values);
      });
    });

    // Calculate min/max for range (use all data)
    const min = allValues.reduce((a, b) => Math.min(a, b), Infinity);
    const max = allValues.reduce((a, b) => Math.max(a, b), -Infinity);

    // KDE calculation is shared via @/lib/kde
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

    // MAJ-007: Generate distinct colors for each sample
    const sampleColors = [
      '#00ADEF', '#E73564', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
      '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#D946EF',
    ];
    let colorIndex = 0;

    Object.entries(data.intensity_distributions.psm).forEach(([condition, replicates]) => {
      Object.entries(replicates).forEach(([replicate, values]) => {
        const kde = calculateKDE(values);
        if (kde.x.length > 0) {
          const color = sampleColors[colorIndex % sampleColors.length];
          colorIndex++;
          traces.push({
            x: kde.x,
            y: kde.y,
            type: 'scatter',
            mode: 'lines',
            name: `${condition} - ${replicate}`,
            line: { color, width: 2 },
            fill: 'tozeroy',
            fillcolor: color + '33', // 20% opacity hex
            hovertemplate: 'Log2 Intensity: %{x:.2f}<br>Density: %{y:.4f}<extra></extra>',
          });
        }
      });
    });

    const layout = {
      title: { text: 'PSM Intensity Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        range: [min, max],
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
  }, [data.intensity_distributions?.psm]);

  // 5. Protein Intensity Distribution - Line plots (KDE) showing all data
  const proteinIntensityPlot = useMemo(() => {
    if (!data.intensity_distributions?.protein) return null;

    // Collect all values for range calculation (all data, not 90%)
    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.protein).forEach(([, values]) => {
      allValues = allValues.concat(values);
    });

    // Calculate min/max for range (use all data)
    const globalMin = allValues.reduce((a, b) => Math.min(a, b), Infinity);
    const globalMax = allValues.reduce((a, b) => Math.max(a, b), -Infinity);

    // KDE calculation is shared via @/lib/kde
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

    // MAJ-008: Generate distinct colors for each sample
    const sampleColors = [
      '#00ADEF', '#E73564', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
      '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#D946EF',
    ];
    let colorIndex = 0;

    Object.entries(data.intensity_distributions.protein).forEach(([sampleName, values]) => {
      const kde = calculateKDE(values);
      if (kde.x.length > 0) {
        const color = sampleColors[colorIndex % sampleColors.length];
        colorIndex++;
        traces.push({
          x: kde.x,
          y: kde.y,
          type: 'scatter',
          mode: 'lines',
          name: sampleName,
          line: { color, width: 2 },
          fill: 'tozeroy',
          fillcolor: color + '33', // 20% opacity hex
          hovertemplate: 'Intensity: %{x:.2f}<br>Density: %{y:.4f}<extra></extra>',
        });
      }
    });

    const layout = {
      title: { text: 'Protein Intensity Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Intensity', font: { size: 12 } },
        range: [globalMin, globalMax],
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
  }, [data.intensity_distributions?.protein]);

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
              className="bg-white rounded-lg border border-gray-200 p-4"
            >
              {/* Plot header with actions */}
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700">{plot.title}</h3>
                <div className="flex items-center gap-2">
                  <button
                    data-testid={`expand-${plot.id}-btn`}
                    onClick={() => setExpandedPlot(plot.id)}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    title="Expand plot"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <button
                    data-testid={`download-${plot.id}-btn`}
                    onClick={() => handleDownload(plot.id)}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
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
              className="bg-gray-50 rounded-lg border border-gray-200 p-4 flex items-center justify-center h-[400px]"
            >
              <div data-testid="no-data" className="text-center text-gray-400">
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
            className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {plots.find(p => p.id === expandedPlot)?.title}
              </h2>
              <button
                data-testid="close-modal-btn"
                onClick={() => setExpandedPlot(null)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
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
