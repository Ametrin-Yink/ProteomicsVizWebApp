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

    // Generate running enrichment score data
    // This is a simplified representation - in production, the backend would provide the actual curve data
    const numPoints = 100;
    const xValues = Array.from({ length: numPoints }, (_, i) => i);

    // Simulate a running enrichment score curve
    // Positive NES: curve goes up then down
    // Negative NES: curve goes down then up
    const es = pathway.es;
    const yValues = xValues.map((x) => {
      const normalizedX = x / numPoints;
      if (es > 0) {
        // Upward curve
        return es * Math.sin(normalizedX * Math.PI) * (1 + Math.random() * 0.1);
      } else {
        // Downward curve
        return es * Math.sin(normalizedX * Math.PI) * (1 + Math.random() * 0.1);
      }
    });

    // Generate rank metric distribution (bar chart at bottom)
    const rankMetrics = xValues.map(() => (Math.random() - 0.5) * 2);

    // Leading edge positions
    const leadingEdgePositions = pathway.lead_genes.map((_, i) =>
      Math.floor((i / pathway.lead_genes.length) * numPoints * 0.4 + numPoints * 0.3)
    );

    const traces = [
      // Running Enrichment Score
      {
        x: xValues,
        y: yValues,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Running ES',
        line: { color: '#E73564', width: 2 },
        fill: 'tozeroy' as const,
        fillcolor: 'rgba(231, 53, 100, 0.3)',
        yaxis: 'y' as const,
        hovertemplate: 'Rank: %{x}<br>ES: %{y:.3f}<extra></extra>',
      },
      // Leading edge markers
      {
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
        hovertemplate: 'Leading Edge Gene<extra></extra>',
        showlegend: false,
      },
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
        hovertemplate: 'Rank: %{x}<br>Metric: %{y:.3f}<extra></extra>',
        showlegend: false,
      },
    ];

    const layout = {
      title: {
        text: pathway.name,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: 'Gene Rank', font: { size: 12 } },
        domain: [0, 1],
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
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: 30, t: 50, b: 50 },
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
