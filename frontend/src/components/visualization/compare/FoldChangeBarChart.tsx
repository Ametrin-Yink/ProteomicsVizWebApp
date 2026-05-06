'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinFCResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  data: ProteinFCResult[];
  proteinName: string;
}

export default function FoldChangeBarChart({ data, proteinName }: Props) {
  const { traceBar, traceDot, layout } = useMemo(() => {
    if (!data.length) return { traceBar: undefined, traceDot: undefined, layout: {} };

    const comparisons = data.map((d) => d.comparison.replace(/_vs_/g, ' vs '));
    const logFC = data.map((d) => d.log_fc);
    const negLogP = data.map((d) => (d.pval > 0 ? -Math.log10(d.pval) : 0));
    const colors = logFC.map((v) => (v >= 0 ? '#ef4444' : '#3b82f6'));

    const traceBar = {
      type: 'bar' as const,
      x: comparisons,
      y: logFC,
      marker: { color: colors },
      name: 'log2 Fold Change',
      yaxis: 'y',
    };

    const traceDot = {
      type: 'scatter' as const,
      x: comparisons,
      y: negLogP,
      mode: 'markers' as const,
      marker: { color: '#6366f1', size: 10, symbol: 'circle' as const },
      name: '-log10(p-value)',
      yaxis: 'y2',
    };

    const layout = {
      title: `Fold Change: ${proteinName}`,
      yaxis: { title: 'log2 Fold Change', side: 'left' as const },
      yaxis2: { title: '-log10(p-value)', overlaying: 'y' as const, side: 'right' as const },
      legend: { x: 0.01, y: 1.1, orientation: 'h' as const },
      height: 350,
      margin: { t: 40, b: 100, l: 60, r: 60 },
      xaxis: { tickangle: -45 },
    };

    return { traceBar, traceDot, layout };
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
        data={[traceBar, traceDot]}
        layout={layout}
        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
