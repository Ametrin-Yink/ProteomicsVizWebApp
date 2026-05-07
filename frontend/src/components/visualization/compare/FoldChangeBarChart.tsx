'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey, COLORSCALE_PVAL } from '@/lib/utils';
import type { ProteinFCResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  data: ProteinFCResult[];
  proteinName: string;
}

export default function FoldChangeBarChart({ data, proteinName }: Props) {
  const { traceBar, layout } = useMemo(() => {
    if (!data.length) return { traceBar: undefined, layout: {} };

    const comparisons = data.map((d) => formatComparisonKey(d.comparison, 35));
    const logFC = data.map((d) => d.log_fc);
    const negLogP = data.map((d) => (d.pval > 0 ? -Math.log10(d.pval) : 0));

    const traceBar = {
      type: 'bar' as const,
      x: logFC,
      y: comparisons,
      orientation: 'h' as const,
      marker: {
        color: negLogP,
        colorscale: COLORSCALE_PVAL as string[][],
        cmin: 0,
        cmax: 5,
        colorbar: {
          title: { text: '-log10(p)', font: { size: 12 }, side: 'top' },
          orientation: 'h',
          y: -0.08,
          yanchor: 'top',
          x: -0.05,
          xanchor: 'right',
          len: 0.45,
          thickness: 12,
          tickvals: [0, 1, 2, 3, 4, 5],
          ticktext: ['0', '1', '2', '3', '4', '≥5'],
        },
      },
      customdata: negLogP,
      hovertemplate: '%{y}<br>log2 FC: %{x:.3f}<br>-log10(p): %{customdata:.2f}<extra></extra>',
    };

    const layout = {
      title: { text: `Fold Change: ${proteinName}`, font: { size: 16, color: '#111827' } },
      xaxis: { title: { text: 'log2 Fold Change', font: { size: 14 } }, automargin: true },
      yaxis: { automargin: true },
      height: 430,
      margin: { t: 60, b: 100, l: 10, r: 20 },
      bargap: 0.15,
    };

    return { traceBar, layout };
  }, [data, proteinName]);

  if (!data.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No fold change data available
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot
        data={[traceBar]}
        layout={layout}
        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
