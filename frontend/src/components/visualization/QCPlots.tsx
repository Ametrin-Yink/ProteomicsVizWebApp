'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { QCData } from '@/types/api';
import { transformPCARowBased } from '@/lib/utils';
import { Maximize2, Download } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface QCPlotsProps {
  data: QCData;
}

export default function QCPlots({ data }: QCPlotsProps) {
  // 1. PCA Plot - Color by sample
  const pcaPlot = useMemo(() => {
    if (!data.pca) return null;

    const rowData = transformPCARowBased(
      data.pca.samples,
      data.pca.pc1,
      data.pca.pc2,
      data.pca.conditions
    );

    // Create a color map for each sample based on condition
    // Support both old (Control/Treatment) and new (DMSO/INCZ*) condition names
    const conditionColors: Record<string, string> = {
      Control: '#00ADEF',
      Treatment: '#E73564',
      DMSO: '#00ADEF',
    };
    // Any condition containing INCZ should use the treatment color
    const getConditionColor = (condition: string) => {
      if (condition.includes('INCZ')) return '#E73564';
      return conditionColors[condition] || '#6B7280';
    };

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
  }, [data.pca]);

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

  // 3. PSM CV Variance - no individual points shown
  const psmCVPlot = useMemo(() => {
    if (!data.psm_cv) return null;

    const traces = Object.entries(data.psm_cv).map(([condition, values]) => ({
      y: values,
      type: 'violin' as const,
      name: condition,
      box: { visible: true },
      line: { color: condition === 'DMSO' ? '#00ADEF' : '#E73564' },
      fillcolor: condition === 'DMSO' ? 'rgba(0, 173, 239, 0.5)' : 'rgba(231, 53, 100, 0.5)',
      hovertemplate: 'CV: %{y:.3f}<extra></extra>',
      // Hide individual points - only show violin and box
      points: false,
      jitter: 0,
      pointpos: 0,
    }));

    const layout = {
      title: { text: 'PSM CV Variance by Condition', font: { size: 14, color: '#111827' } },
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
  }, [data.psm_cv]);

  // 3b. Protein CV Variance (with different colors) - no individual points shown
  const proteinCVPlot = useMemo(() => {
    if (!data.protein_cv) return null;

    const traces = Object.entries(data.protein_cv).map(([condition, values]) => ({
      y: values,
      type: 'violin' as const,
      name: condition,
      box: { visible: true },
      line: { color: condition === 'DMSO' ? '#10B981' : '#F59E0B' },
      fillcolor: condition === 'DMSO' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(245, 158, 11, 0.5)',
      hovertemplate: 'CV: %{y:.3f}<extra></extra>',
      // Hide individual points - only show violin and box
      points: false,
      jitter: 0,
      pointpos: 0,
    }));

    const layout = {
      title: { text: 'Protein CV Variance by Condition', font: { size: 14, color: '#111827' } },
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
  }, [data.protein_cv]);

  // 4. PSM Intensity Distribution - KDE curves (lines) instead of histogram
  const psmIntensityPlot = useMemo(() => {
    if (!data.intensity_distributions?.psm) return null;

    // Collect all values to calculate percentiles
    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.psm).forEach(([condition, replicates]) => {
      Object.entries(replicates).forEach(([replicate, values]) => {
        allValues = allValues.concat(values);
      });
    });

    // Sort and calculate 5th and 95th percentiles (90% of data)
    allValues.sort((a, b) => a - b);
    const p5 = allValues[Math.floor(allValues.length * 0.05)];
    const p95 = allValues[Math.floor(allValues.length * 0.95)];

    // Function to calculate KDE
    const calculateKDE = (values: number[], numPoints: number = 100) => {
      if (values.length === 0) return { x: [], y: [] };

      // Filter values to 90% range
      const filtered = values.filter(v => v >= p5 && v <= p95);
      if (filtered.length === 0) return { x: [], y: [] };

      const min = Math.min(...filtered);
      const max = Math.max(...filtered);
      const range = max - min || 1;

      // Silverman's rule of thumb for bandwidth
      const std = Math.sqrt(filtered.reduce((sum, v) => sum + Math.pow(v - filtered.reduce((a, b) => a + b) / filtered.length, 2), 0) / filtered.length);
      const bandwidth = 1.06 * std * Math.pow(filtered.length, -0.2);

      const x: number[] = [];
      const y: number[] = [];

      for (let i = 0; i < numPoints; i++) {
        const xi = min + (range * i) / (numPoints - 1);
        x.push(xi);

        // Gaussian kernel
        let yi = 0;
        for (const v of filtered) {
          const z = (xi - v) / bandwidth;
          yi += Math.exp(-0.5 * z * z) / (bandwidth * Math.sqrt(2 * Math.PI));
        }
        y.push(yi / filtered.length);
      }

      return { x, y };
    };

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

    Object.entries(data.intensity_distributions.psm).forEach(([condition, replicates]) => {
      Object.entries(replicates).forEach(([replicate, values]) => {
        const kde = calculateKDE(values);
        if (kde.x.length > 0) {
          const color = condition === 'DMSO' ? '#00ADEF' : '#E73564';
          traces.push({
            x: kde.x,
            y: kde.y,
            type: 'scatter',
            mode: 'lines',
            name: `${condition} - ${replicate}`,
            line: { color, width: 2 },
            fill: 'tozeroy',
            fillcolor: condition === 'DMSO' ? 'rgba(0, 173, 239, 0.2)' : 'rgba(231, 53, 100, 0.2)',
            hovertemplate: 'Intensity: %{x:.2f}<br>Density: %{y:.4f}<extra></extra>',
          });
        }
      });
    });

    const layout = {
      title: { text: 'PSM Intensity Distribution (90% of data)', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        range: [p5, p95],
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

  // 5. Protein Intensity Distribution - Filter to 90% of data to avoid impossible values
  const proteinIntensityPlot = useMemo(() => {
    if (!data.intensity_distributions?.protein) return null;

    // Collect all values to calculate percentiles
    let allValues: number[] = [];
    Object.entries(data.intensity_distributions.protein).forEach(([condition, values]) => {
      allValues = allValues.concat(values);
    });

    // Sort and calculate 5th and 95th percentiles (90% of data)
    allValues.sort((a, b) => a - b);
    const p5 = allValues[Math.floor(allValues.length * 0.05)];
    const p95 = allValues[Math.floor(allValues.length * 0.95)];

    // Filter values to 90% range to avoid impossible values
    const traces = Object.entries(data.intensity_distributions.protein).map(
      ([condition, values]) => {
        const filteredValues = values.filter(v => v >= p5 && v <= p95);
        return {
          x: filteredValues,
          type: 'histogram' as const,
          name: condition,
          opacity: 0.6,
          marker: {
            color: condition === 'DMSO' ? '#00ADEF' : '#E73564',
          },
          hovertemplate: 'Intensity: %{x}<br>Count: %{y}<extra></extra>',
        };
      }
    );

    const layout = {
      title: { text: 'Protein Intensity Distribution (90% of data)', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        range: [p5, p95],
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'overlay' as const,
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
    { id: 'psm-cv', data: psmCVPlot, title: 'PSM CV Variance' },
    { id: 'protein-cv', data: proteinCVPlot, title: 'Protein CV Variance' },
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
      // @ts-ignore - Plotly is loaded globally
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
