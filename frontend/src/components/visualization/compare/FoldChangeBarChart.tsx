'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey } from '@/lib/utils';
import type { ProteinFCResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

function logPColor(negLogP: number): string {
  // blue at -log10(p) <= 1 (p >= 0.1), red at -log10(p) >= 5 (p <= 1e-5)
  if (negLogP <= 1) return '#3b82f6';
  if (negLogP >= 5) return '#ef4444';
  const t = (negLogP - 1) / 4;
  const r = Math.round(59 + (239 - 59) * t);
  const g = Math.round(130 + (68 - 130) * t);
  const b = Math.round(246 + (68 - 246) * t);
  return `rgb(${r},${g},${b})`;
}

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
    const colors = negLogP.map((v) => logPColor(v));

    const traceBar = {
      type: 'bar' as const,
      x: logFC,
      y: comparisons,
      orientation: 'h' as const,
      marker: { color: colors },
      customdata: negLogP,
      hovertemplate: '%{y}<br>log2 FC: %{x:.3f}<br>-log10(p): %{customdata:.2f}<extra></extra>',
    };

    const layout = {
      title: { text: `Fold Change: ${proteinName}`, font: { size: 16, color: '#111827' } },
      xaxis: { title: { text: 'log2 Fold Change', font: { size: 14 } }, automargin: true },
      yaxis: { automargin: true },
      height: Math.max(300, data.length * 40 + 100),
      margin: { t: 60, b: 60, l: 10, r: 60 },
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
