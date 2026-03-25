'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GSEAResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface GSEAPlotProps {
  pathway: GSEAResult | null;
}

export default function GSEAPlot({ pathway }: GSEAPlotProps) {
  // Generate GSEA enrichment plot data
  const plotData = useMemo(() => {
    if (!pathway) return null;

    // Use actual running ES curve if available, otherwise generate synthetic
    let xValues: number[] = [];
    let yValues: number[] = [];
    let hasRealCurve = false;

    if (pathway.running_es_curve && pathway.running_es_curve.length > 0) {
      // Use actual curve data from backend
      xValues = pathway.running_es_curve.map(([rank]) => rank);
      yValues = pathway.running_es_curve.map(([, es]) => es);
      hasRealCurve = true;
    } else {
      // Fallback: generate synthetic curve for backwards compatibility
      const numPoints = 100;
      xValues = Array.from({ length: numPoints }, (_, i) => i);

      const es = pathway.es;
      yValues = xValues.map((x) => {
        const normalizedX = x / numPoints;
        if (es > 0) {
          return es * Math.sin(normalizedX * Math.PI) * (1 + Math.random() * 0.1);
        } else {
          return es * Math.sin(normalizedX * Math.PI) * (1 + Math.random() * 0.1);
        }
      });
    }

    // Generate rank metric distribution (bar chart at bottom)
    // Use actual rank metric positions if available
    let rankMetrics: number[] = [];
    if (pathway.rank_metric_positions && pathway.rank_metric_positions.length > 0) {
      // Create an array aligned with xValues, filling in actual metric values
      const maxRank = xValues.length > 0 ? Math.max(...xValues) : 100;
      rankMetrics = new Array(xValues.length).fill(0);

      pathway.rank_metric_positions.forEach(([, rank, metric]) => {
        // Find closest index in xValues
        const index = Math.floor((rank / maxRank) * (xValues.length - 1));
        if (index >= 0 && index < rankMetrics.length) {
          rankMetrics[index] = metric;
        }
      });
    } else {
      // Fallback: random metrics
      rankMetrics = xValues.map(() => (Math.random() - 0.5) * 2);
    }

    // Leading edge positions from actual data
    let leadingEdgePositions: number[] = [];
    if (pathway.rank_metric_positions && pathway.rank_metric_positions.length > 0) {
      const maxRank = xValues.length > 0 ? Math.max(...xValues) : 100;
      leadingEdgePositions = pathway.rank_metric_positions.map(([, rank]) =>
        Math.floor((rank / maxRank) * (xValues.length - 1))
      );
    } else if (pathway.lead_genes.length > 0) {
      // Fallback: distribute evenly
      leadingEdgePositions = pathway.lead_genes.map((_, i) =>
        Math.floor((i / pathway.lead_genes.length) * xValues.length * 0.4 + xValues.length * 0.3)
      );
    }

    // Calculate zero line for the ES curve
    const zeroLineY = new Array(xValues.length).fill(0);

    // CRIT-005: Add heatmap data if available
    const hasHeatmap = pathway.heatmap_data &&
                       pathway.heatmap_data.genes &&
                       pathway.heatmap_data.genes.length > 0;

    // Define domain for main plot - leave room for heatmap on right if available
    const mainPlotDomain = hasHeatmap ? [0, 0.7] : [0, 1];
    const heatmapDomain = hasHeatmap ? [0.75, 1] : [0, 0];

    const traces: any[] = [
      // Zero reference line
      {
        x: xValues,
        y: zeroLineY,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Zero',
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
        name: 'Leading Edge',
        marker: {
          color: '#00ADEF',
          size: 8,
          symbol: 'line-ns' as const,
          line: { width: 2 },
        },
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
        name: 'Rank Metric',
        marker: {
          color: rankMetrics.map((v) => (v > 0 ? '#10B981' : '#EF4444')),
        },
        yaxis: 'y2' as const,
        xaxis: 'x' as const,
        hovertemplate: 'Rank: %{x}<br>Metric: %{y:.3f}<extra></extra>',
        showlegend: false,
      },
    ];

    // Add heatmap trace if data is available
    if (hasHeatmap) {
      const heatmapData = pathway.heatmap_data!;
      traces.push({
        z: heatmapData.z_scores,
        x: heatmapData.samples,
        y: heatmapData.genes,
        type: 'heatmap',
        colorscale: 'RdBu',
        reversescale: true,
        zmid: 0,
        zmin: -3,
        zmax: 3,
        showscale: true,
        colorbar: {
          title: 'Z-score',
          titleside: 'right',
          thickness: 15,
          len: 0.5,
          y: 0.5,
          x: 1.02,
        },
        yaxis: 'y3',
        xaxis: 'x2',
        hovertemplate: 'Gene: %{y}<br>Sample: %{x}<br>Z-score: %{z:.2f}<extra></extra>',
      });
    }

    const layout: any = {
      title: {
        text: pathway.name,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: 'Gene Rank', font: { size: 12 } },
        domain: mainPlotDomain,
        showgrid: false,
      },
      yaxis: {
        title: { text: 'Running Enrichment Score', font: { size: 12 } },
        domain: [0.3, 1],
        gridcolor: '#E5E7EB',
        zeroline: true,
        zerolinecolor: '#000',
        zerolinewidth: 1,
      },
      yaxis2: {
        domain: [0, 0.2],
        showgrid: false,
        zeroline: false,
        showticklabels: false,
      },
      // Heatmap axes
      ...(hasHeatmap ? {
        xaxis2: {
          domain: heatmapDomain,
          showgrid: false,
          tickangle: -45,
          tickfont: { size: 8 },
          matches: 'x',
        },
        yaxis3: {
          domain: [0.3, 1],
          anchor: 'x2',
          showgrid: false,
          tickfont: { size: 8 },
          autorange: 'reversed',
        },
      } : {}),
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: hasHeatmap ? 100 : 30, t: 50, b: 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: 1.1 },
      annotations: [
        {
          x: 0.5,
          y: 0.25,
          xref: 'paper',
          yref: 'paper',
          text: `NES: ${pathway.nes.toFixed(3)} | P-value: ${pathway.pval.toExponential(2)} | FDR: ${pathway.fdr.toExponential(2)}`,
          showarrow: false,
          font: { size: 11, color: '#6B7280' },
        },
        ...(hasHeatmap ? [{
          x: 0.875,
          y: 1.05,
          xref: 'paper',
          yref: 'paper',
          text: 'Leading Edge Genes (Z-score)',
          showarrow: false,
          font: { size: 11, color: '#111827' },
        }] : []),
      ],
    };

    return { traces, layout };
  }, [pathway]);

  if (!pathway || !plotData) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 flex items-center justify-center h-[400px]">
        <div className="text-center text-gray-400">
          <p className="text-lg font-medium">GSEA Plot</p>
          <p className="text-sm mt-2">Select a pathway to view GSEA plot</p>
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
        <Plot
          data={plotData.traces}
          layout={plotData.layout}
          config={config}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler={true}
        />
      </div>
    </div>
  );
}
