'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey } from '@/lib/utils';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  comparisons: string[];
  matrix: number[][];
}

export default function SimilarityMatrix({ comparisons, matrix }: Props) {
  const height = Math.max(400, comparisons.length * 40 + 120);

  const annotations = useMemo(() => {
    if (!comparisons.length || !matrix.length) return [];
    const result: Array<{
      x: number;
      y: number;
      text: string;
      showarrow: boolean;
      font: { color: string; size: number };
    }> = [];
    for (let i = 0; i < comparisons.length; i++) {
      for (let j = 0; j < comparisons.length; j++) {
        const val = matrix[i]?.[j];
        if (val !== undefined) {
          const textColor = Math.abs(val) > 0.5 ? '#ffffff' : '#1e293b';
          result.push({
            x: j,
            y: i,
            text: val.toFixed(2),
            showarrow: false,
            font: { color: textColor, size: 11 },
          });
        }
      }
    }
    return result;
  }, [comparisons, matrix]);

  if (!comparisons.length || !matrix.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No similarity data available
      </div>
    );
  }

  const labels = comparisons.map((c) => formatComparisonKey(c, 24));

  const trace = {
    type: 'heatmap' as const,
    z: matrix,
    x: labels,
    y: labels,
    colorscale: 'Reds' as unknown as string[][],
    zmin: -1,
    zmax: 1,
    hovertemplate: 'Comparison: %{x}<br>vs %{y}<br>Correlation: %{z:.3f}<extra></extra>',
  };

  const layout = {
    title: { text: 'Comparison Similarity Matrix', font: { size: 16, color: '#111827' } },
    xaxis: { tickangle: -45, automargin: true, title: { text: '', font: { size: 14 } } },
    yaxis: { autorange: 'reversed' as const, automargin: true, title: { text: '', font: { size: 14 } } },
    height,
    width: height,
    margin: { t: 50, b: 120, l: 120, r: 60 },
    annotations,
  };

  return (
    <div className="bg-background border border-border rounded-lg p-4 overflow-x-auto">
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
