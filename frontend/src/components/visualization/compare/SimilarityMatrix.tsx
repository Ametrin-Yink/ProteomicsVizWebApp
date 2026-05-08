'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKeyWrapped, COLORSCALE_CYAN_GREY_CORAL } from '@/lib/utils';

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
    const sorted = [...matrix.flat()].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (let i = 0; i < comparisons.length; i++) {
      for (let j = 0; j < comparisons.length; j++) {
        const val = matrix[i]?.[j];
        if (val !== undefined) {
          const textColor = val > median ? '#ffffff' : '#1e293b';
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

  const labels = comparisons.map((c) => formatComparisonKeyWrapped(c));

  const trace = {
    type: 'heatmap' as const,
    z: matrix,
    x: labels,
    y: labels,
    colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
    colorbar: { orientation: 'h', x: 0, y: -0.18, xanchor: 'right', yanchor: 'top', len: 0.35, thickness: 12 },
    hovertemplate: 'Comparison: %{x}<br>vs %{y}<br>RMSD: %{z:.3f}<extra></extra>',
  };

  const layout = {
    title: { text: 'Comparison Similarity Matrix', font: { size: 16, color: '#111827' } },
    xaxis: { tickangle: -90, automargin: true, title: { text: '', font: { size: 14 } } },
    yaxis: { autorange: 'reversed' as const, automargin: true, title: { text: '', font: { size: 14 } } },
    height,
    margin: { t: 50, b: 160, l: 140, r: 40 },
    annotations,
  };

  return (
    <div className="bg-background border border-border rounded-lg p-4 overflow-x-auto">
      <Plot
        data={[trace]}
        layout={layout}
        config={{ displayModeBar: 'hover', displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
