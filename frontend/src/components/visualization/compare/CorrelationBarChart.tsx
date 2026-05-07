'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface CorrelationItem {
  label: string;
  correlation: number;
}

interface Props {
  data: CorrelationItem[];
  title: string;
  topN?: number;
  ascending?: boolean; // true when lower values = better (e.g. distance)
  onItemClick?: (label: string) => void;
}

export default function CorrelationBarChart({ data, title, topN = 10, ascending = false, onItemClick }: Props) {
  const { labels, values, colors } = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      ascending ? a.correlation - b.correlation : b.correlation - a.correlation
    );
    const topBottom: CorrelationItem[] = [];

    // Take top N and bottom N
    const top = sorted.slice(0, topN);
    const bottom = sorted.slice(-topN).reverse();

    // Deduplicate: if 2*topN > data.length, just show top N
    if (top.length + bottom.length > data.length && sorted.length <= topN * 2) {
      topBottom.push(...sorted);
    } else {
      topBottom.push(...top, ...bottom);
    }

    return {
      labels: topBottom.map((d) => d.label),
      values: topBottom.map((d) => d.correlation),
      colors: topBottom.map((d) => (d.correlation >= 0 ? '#ef4444' : '#3b82f6')),
    };
  }, [data, topN]);

  const height = Math.max(400, labels.length * 30 + 80);

  const trace = {
    type: 'bar' as const,
    x: values,
    y: labels,
    orientation: 'h' as const,
    marker: { color: colors },
    text: values.map((v) => v.toFixed(3)),
    textposition: 'outside' as const,
    hovertemplate: '%{y}: %{x:.3f}<extra></extra>',
  };

  const plotConfig = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
    scrollZoom: false,
    doubleClick: 'reset' as const,
  };

  const layout = {
    title: { text: title, font: { size: 16, color: '#111827' } },
    xaxis: {
      title: { text: ascending ? 'RMSD' : 'Correlation', font: { size: 14 } },
      automargin: true,
    },
    yaxis: { automargin: true },
    height,
    margin: { t: 50, b: 60, l: 10, r: 60 },
    dragmode: onItemClick ? (false as const) : ('zoom' as const),
    hovermode: 'closest' as const,
    bargap: 0.15,
  };

  if (!data.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No correlation data available
      </div>
    );
  }

  const handleClick = onItemClick
    ? (eventData: { points?: Array<{ y: string | number }> }) => {
        if (eventData.points && eventData.points.length > 0) {
          onItemClick(String(eventData.points[0].y));
        }
      }
    : undefined;

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot
        data={[trace]}
        layout={layout}
        config={plotConfig}
        style={{ width: '100%' }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
