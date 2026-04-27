'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GSEAResult, GSEAPlotData, GSEAHeatmapData, GSEADatabase } from '@/types/api';
import { getGSEAPlotData, getGSEAHeatmapData } from '@/lib/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface GSEAPlotProps {
  pathway: GSEAResult | null;
  sessionId: string;
  database: GSEADatabase;
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
    const currentPathway = pathway;

    async function fetchData() {
      try {
        const [plot, heatmap] = await Promise.all([
          getGSEAPlotData(sessionId, database, currentPathway.term),
          getGSEAHeatmapData(sessionId, database, currentPathway.term),
        ]);
        if (!cancelled) {
          setPlotData(plot);
          setHeatmapData(heatmap.genes?.length ? heatmap : null);
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
  }, [pathway, sessionId, database]);

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
