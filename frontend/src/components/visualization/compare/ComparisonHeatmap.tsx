'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  proteins: Array<{ accession: string; gene_name: string }>;
  comparisons: string[];
  foldChanges: number[][];
}

export default function ComparisonHeatmap({ proteins, comparisons, foldChanges }: Props) {
  const { yLabels, zData } = useMemo(() => {
    const yLabels = proteins.map((p) => p.gene_name || p.accession);
    const zData = foldChanges;
    return { yLabels, zData };
  }, [proteins]);

  const height = Math.max(400, Math.min(800, proteins.length * 10 + 120));

  if (!proteins.length || !comparisons.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No heatmap data available
      </div>
    );
  }

  const trace = {
    type: 'heatmap' as const,
    z: zData,
    x: comparisons.map((c) => c.replace(/_vs_/g, ' vs ')),
    y: yLabels,
    colorscale: [
      [0, '#3b82f6'],
      [0.5, '#ffffff'],
      [1, '#ef4444'],
    ] as unknown as string[][],
    zmid: 0,
    hovertemplate: 'Protein: %{y}<br>Comparison: %{x}<br>log2 FC: %{z:.2f}<extra></extra>',
  };

  const layout = {
    title: 'Marked Proteins Fold Change Heatmap',
    xaxis: { tickangle: -45 },
    yaxis: { autorange: 'reversed' as const },
    height,
    margin: { t: 40, b: 100, l: 120, r: 40 },
  };

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot
        data={[trace]}
        layout={layout}
        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
