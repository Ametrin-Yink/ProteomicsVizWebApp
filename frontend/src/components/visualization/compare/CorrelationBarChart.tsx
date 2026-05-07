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

function rmsdColor(val: number, min: number, max: number): string {
  if (min === max) return '#9ca3af';
  const t = (val - min) / (max - min);
  const r = Math.round(6 + (255 - 6) * t);
  const g = Math.round(182 + (107 - 182) * t);
  const b = Math.round(212 + (107 - 212) * t);
  return `rgb(${r},${g},${b})`;
}

export default function CorrelationBarChart({ data, title, topN = 10, ascending = false, onItemClick }: Props) {
  const { labels, values, colors, height } = useMemo(() => {
    const sorted = [...data].sort((a, b) =>
      ascending ? a.correlation - b.correlation : b.correlation - a.correlation
    );
    const topBottom: CorrelationItem[] = [];

    const top = sorted.slice(0, topN);
    const bottom = sorted.slice(-topN).reverse();

    if (top.length + bottom.length > data.length && sorted.length <= topN * 2) {
      topBottom.push(...sorted);
    } else {
      topBottom.push(...top, ...bottom);
    }

    const vals = topBottom.map((d) => d.correlation);
    const vmin = Math.min(...vals);
    const vmax = Math.max(...vals);

    return {
      labels: topBottom.map((d) => d.label),
      values: vals,
      colors: ascending
        ? vals.map((v) => rmsdColor(v, vmin, vmax))
        : topBottom.map((d) => (d.correlation >= 0 ? '#ef4444' : '#3b82f6')),
      height: 350,
    };
  }, [data, topN, ascending]);

  const trace = {
    type: 'bar' as const,
    x: labels,
    y: values,
    marker: { color: colors },
    text: values.map((v) => v.toFixed(3)),
    textposition: 'outside' as const,
    hovertemplate: '%{x}: %{y:.3f}<extra></extra>',
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
    xaxis: { tickangle: -45, automargin: true },
    yaxis: { title: { text: ascending ? 'RMSD' : 'Correlation', font: { size: 14 } }, automargin: true },
    height,
    margin: { t: 50, b: 100, l: 60, r: 20 },
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
    ? (eventData: { points?: Array<{ x: string | number }> }) => {
        if (eventData.points && eventData.points.length > 0) {
          onItemClick(String(eventData.points[0].x));
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
