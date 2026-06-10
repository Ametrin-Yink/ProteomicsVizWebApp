'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GSEAResult, GSEAPlotData, GSEAHeatmapData, GSEADatabase } from '@/types/api';
import { visualizationApi } from '@/lib/api-client';
import { useApi } from '@/lib/api-context';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface GSEAPlotProps {
  pathway: GSEAResult | null;
  database: GSEADatabase;
  comparison?: string;
  onPathwayUpdated?: (pathway: GSEAResult) => void;
}

export default function GSEAPlot({ pathway, database, comparison, onPathwayUpdated }: GSEAPlotProps) {
  const { apiPrefix } = useApi();
  const [plotData, setPlotData] = useState<GSEAPlotData | null>(null);
  const [heatmapData, setHeatmapData] = useState<GSEAHeatmapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch plot and heatmap data when pathway changes
  useEffect(() => {
    if (!pathway || !apiPrefix || !database) {
      setPlotData(null);
      setHeatmapData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPlotData(null);
    setHeatmapData(null);
    const currentPathway = pathway;

    async function fetchData() {
      setError(null);
      try {
        const [plot, heatmap] = await Promise.all([
          visualizationApi.getGSEAPlotData(apiPrefix, database, currentPathway.term, comparison),
          visualizationApi.getGSEAHeatmapData(apiPrefix, database, currentPathway.term, comparison),
        ]);
        if (!cancelled) {
          setPlotData(plot);
          setHeatmapData(heatmap.genes?.length ? heatmap : null);
          // Only update parent if pathway_gene_set_size wasn't already set
          // to prevent infinite re-render loop
          if (plot.pathway_gene_set_size && onPathwayUpdated && currentPathway && !currentPathway.pathway_gene_set_size) {
            onPathwayUpdated({
              ...currentPathway,
              pathway_gene_set_size: plot.pathway_gene_set_size,
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load plot data';
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [pathway, apiPrefix, database, comparison, onPathwayUpdated]);

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

    // Find the ES extremum (peak for positive NES, trough for negative NES)
    const extremumIndex = yValues.length > 0 ? yValues.reduce((idx, v, i) =>
      Math.abs(v) > Math.abs(yValues[idx]) ? i : idx, 0) : 0;
    const peakRank = xValues[extremumIndex] || 0;
    const peakES = yValues[extremumIndex] || 0;

    // Split pathway genes into leading edge and non-leading edge.
    // For positive NES: leading edge genes are BEFORE the peak (rank <= peakRank)
    // For negative NES: leading edge genes are AFTER the trough (rank >= peakRank)
    const isNegative = peakES < 0;
    const [leadingEdgeGenes, leadingEdgePositions] = plotData.rank_metric_positions.reduce(
      ([genes, positions]: [string[], number[]], [gene, rank]) => {
        const pos = Math.floor((rank / maxRank) * (xValues.length - 1));
        if (isNegative ? rank >= peakRank : rank <= peakRank) { genes.push(gene); positions.push(pos); }
        return [genes, positions];
      },
      [[], []] as [string[], number[]]
    );
    const [postPeakGenes, postPeakPositions] = plotData.rank_metric_positions.reduce(
      ([genes, positions]: [string[], number[]], [gene, rank]) => {
        const pos = Math.floor((rank / maxRank) * (xValues.length - 1));
        if (isNegative ? rank < peakRank : rank > peakRank) { genes.push(gene); positions.push(pos); }
        return [genes, positions];
      },
      [[], []] as [string[], number[]]
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
      // Leading edge gene markers (blue, before peak)
      ...(leadingEdgePositions.length > 0 ? [{
        x: leadingEdgePositions,
        y: leadingEdgePositions.map(() => 0),
        text: leadingEdgeGenes,
        type: 'scatter' as const,
        mode: 'markers' as const,
        marker: { color: '#00ADEF', size: 8, symbol: 'line-ns' as const, line: { width: 2 } },
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hovertemplate: '%{text}<extra></extra>',
        showlegend: false,
      }] : []),
      // Post-peak pathway gene markers (gray, after peak)
      ...(postPeakPositions.length > 0 ? [{
        x: postPeakPositions,
        y: postPeakPositions.map(() => 0),
        text: postPeakGenes,
        type: 'scatter' as const,
        mode: 'markers' as const,
        marker: { color: '#9CA3AF', size: 6, symbol: 'line-ns' as const, line: { width: 1 } },
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hovertemplate: '%{text}<extra></extra>',
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
      // Peak marker (vertical dashed line at ES maximum)
      {
        x: [peakRank, peakRank],
        y: [-Math.abs(peakES) * 1.1, Math.abs(peakES) * 1.1],
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Peak ES',
        line: { color: '#6B7280', width: 1.5, dash: 'dot' as const },
        yaxis: 'y' as const,
        xaxis: 'x' as const,
        hoverinfo: 'skip',
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
        xaxis2: { domain: heatmapDomain, showgrid: false, tickangle: -45, tickfont: { size: 8 } },
        yaxis3: { domain: [0.3, 1], anchor: 'x2', showgrid: false, tickfont: { size: 8 }, autorange: 'reversed' },
      } : {}),
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: hasHeatmap ? 100 : 30, t: 50, b: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: 1.1 },
      annotations: [
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
      <div className="bg-surface rounded-lg border border-border p-4 flex items-center justify-center h-[400px]">
        <div className="text-center text-text-muted">
          <p className="text-lg font-medium">GSEA Plot</p>
          <p className="text-sm mt-2">Select a pathway to view GSEA plot</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-lg p-6 text-center">
        <p className="text-error text-sm mb-3">Failed to load visualization</p>
        <p className="text-error text-xs mb-3">{error}</p>
        <p className="text-text-muted text-xs">Reload the page to retry.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-background rounded-lg border border-border p-4 flex items-center justify-center h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-text-muted text-sm">Loading pathway visualization...</p>
        </div>
      </div>
    );
  }

  const config = {
    displayModeBar: 'hover',
    displaylogo: false,
    responsive: true,
  };

  return (
    <div data-testid="gsea-plot" className="bg-background rounded-lg border border-border p-4">
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
