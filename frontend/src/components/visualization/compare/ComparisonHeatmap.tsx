'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey, truncateText } from '@/lib/utils';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  proteins: Array<{ accession: string; gene_name: string }>;
  comparisons: string[];
  foldChanges: number[][];
}

export default function ComparisonHeatmap({ proteins, comparisons, foldChanges }: Props) {
  const { trace, layout } = useMemo(() => {
    const yLabels = proteins.map((p) => p.gene_name || p.accession);
    const zData = foldChanges;
    const xLabels = comparisons.map((c) => formatComparisonKey(c, 30));
    const truncatedYLabels = yLabels.map((l) => truncateText(l, 25));

    const height = Math.max(400, Math.min(800, proteins.length * 10 + 120));

    if (!proteins.length || !comparisons.length) {
      return { trace: undefined, layout: { height: 0 } };
    }

    const trace = {
      type: 'heatmap' as const,
      z: zData,
      x: xLabels,
      y: truncatedYLabels,
      colorscale: [
        [0, '#3b82f6'],
        [0.5, '#ffffff'],
        [1, '#ef4444'],
      ] as unknown as string[][],
      zmid: 0,
      hovertemplate: 'Protein: %{y}<br>Comparison: %{x}<br>log2 FC: %{z:.2f}<extra></extra>',
    };

    const layout = {
      title: { text: 'Marked Proteins Fold Change Heatmap', font: { size: 16, color: '#111827' } },
      xaxis: { tickangle: -45, automargin: true, title: { text: '', font: { size: 14 } } },
      yaxis: { autorange: 'reversed' as const, automargin: true, title: { text: '', font: { size: 14 } } },
      height,
      margin: { t: 60, b: 120, l: 130, r: 60 },
    };

    return { trace, layout };
  }, [proteins, comparisons, foldChanges]);

  if (!trace) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No heatmap data available
      </div>
    );
  }

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
