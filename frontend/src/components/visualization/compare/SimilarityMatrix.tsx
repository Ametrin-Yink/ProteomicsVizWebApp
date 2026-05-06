'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';

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

  const labels = comparisons.map((c) => {
    const parts = c.replace(/_vs_/g, ' vs ').split(' vs ');
    if (parts.length === 2) {
      return `${parts[0].substring(0, 8)} vs ${parts[1].substring(0, 8)}`;
    }
    return c.substring(0, 20);
  });

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
    title: 'Comparison Similarity Matrix',
    xaxis: { tickangle: -45 },
    yaxis: { autorange: 'reversed' as const },
    height,
    width: height,
    margin: { t: 40, b: 100, l: 100, r: 40 },
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
