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
  // cyan (#00ADEF) → grey (#94a3b8) → coral (#E73564)
  if (t < 0.5) {
    const s = t * 2;
    const r = Math.round(0 + (148 - 0) * s);
    const g = Math.round(173 + (163 - 173) * s);
    const b = Math.round(239 + (184 - 239) * s);
    return `rgb(${r},${g},${b})`;
  }
  const s = (t - 0.5) * 2;
  const r = Math.round(148 + (231 - 148) * s);
  const g = Math.round(163 + (53 - 163) * s);
  const b = Math.round(184 + (100 - 184) * s);
  return `rgb(${r},${g},${b})`;
}

export default function CorrelationBarChart({ data, title, topN = 10, ascending = false, onItemClick }: Props) {
  const { labels, values, rawValues, colors, height } = useMemo(() => {
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

    // Re-sort for smooth low→high gradient when ascending
    const final = ascending
      ? [...topBottom].sort((a, b) => a.correlation - b.correlation)
      : topBottom;

    const rawVals = final.map((d) => d.correlation);
    const vmin = Math.min(...rawVals);
    const vmax = Math.max(...rawVals);

    // For ascending: normalize to 1 (most similar) → -1 (most dissimilar)
    const vals = ascending && vmax > vmin
      ? rawVals.map((v) => 1 - 2 * (v - vmin) / (vmax - vmin))
      : rawVals;

    return {
      labels: final.map((d) => d.label),
      values: vals,
      rawValues: ascending ? rawVals : null,
      colors: ascending
        ? rawVals.map((v) => rmsdColor(v, vmin, vmax))
        : final.map((d) => (d.correlation >= 0 ? '#ef4444' : '#3b82f6')),
      height: 380,
      ascending,
    };
  }, [data, topN, ascending]);

  const trace = ascending
    ? {
        type: 'bar' as const,
        x: labels,
        y: values,
        marker: { color: colors },
        customdata: rawValues,
        text: values.map((v) => v.toFixed(3)),
        textposition: 'outside' as const,
        hovertemplate: '%{x}<br>RMSD: %{customdata:.3f}<extra></extra>',
      }
    : {
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
    yaxis: {
      title: ascending ? { text: 'Relative Similarity', font: { size: 14 } } : { text: 'Correlation', font: { size: 14 } },
      range: ascending ? [-1.2, 1.2] : undefined,
      automargin: true,
    },
    height,
    margin: { t: 50, b: 90, l: 60, r: 20 },
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
