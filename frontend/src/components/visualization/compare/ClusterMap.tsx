'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey, COLORSCALE_CYAN_GREY_CORAL } from '@/lib/utils';
import type { ProteinClusterPoint, ComparisonClusterPoint } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ProteinModeProps {
  mode: 'protein';
  points: ProteinClusterPoint[];
  selectedKey: string;
  colorBy?: Record<string, number>;
  varExplained?: number[];
  title: string;
}

interface ComparisonModeProps {
  mode: 'comparison';
  points: ComparisonClusterPoint[];
  selectedKey: string;
  varExplained?: number[];
  title: string;
}

type Props = ProteinModeProps | ComparisonModeProps;


function buildClusterTitle(title: string, varExplained?: number[] | number): string {
  if (!varExplained) return title;
  if (typeof varExplained === 'number') return `${title} (${(varExplained * 100).toFixed(1)}% variance)`;
  if (varExplained.length === 0) return title;
  const total = varExplained.reduce((a, b) => a + b, 0);
  return `${title} (${(total * 100).toFixed(1)}% variance)`;
}

function pcLabel(pc: number, varExplained?: number[] | number): string {
  if (!varExplained) return `PC${pc + 1}`;
  if (typeof varExplained === 'number') return `PC${pc + 1}`;
  if (pc >= varExplained.length) return `PC${pc + 1}`;
  return `PC${pc + 1} (${(varExplained[pc] * 100).toFixed(1)}%)`;
}

export default function ClusterMap(props: Props) {
  const { mode, points, selectedKey, varExplained, title } = props;
  const colorBy = mode === 'protein' ? (props as ProteinModeProps).colorBy : undefined;

  const { traces, layout } = useMemo(() => {
    if (mode === 'protein') {
      return buildProteinTraces({ mode, points: points as ProteinClusterPoint[], selectedKey, colorBy, varExplained, title });
    }
    return buildComparisonTraces({ mode: 'comparison', points: points as ComparisonClusterPoint[], selectedKey, varExplained, title });
  }, [mode, points, selectedKey, colorBy, varExplained, title]);

  if (!points.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        No cluster data available
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot
        data={traces}
        layout={layout}
        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}

function buildProteinTraces(props: ProteinModeProps) {
  const { points, selectedKey, colorBy, varExplained } = props;
  const { selected, others: unsorted } = partitionPoints(points, selectedKey, (p) => p.accession);
  // Sort by absolute FC ascending so colored dots render on top of grey ones
  const others = colorBy
    ? [...unsorted].sort((a, b) => Math.abs(colorBy[a.accession] ?? 0) - Math.abs(colorBy[b.accession] ?? 0))
    : unsorted;

  const title = buildClusterTitle(props.title, varExplained);

  const traces = [];

  if (others.length > 0) {
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: others.map((p) => p.x),
      y: others.map((p) => p.y),
      marker: colorBy
        ? {
            color: others.map((p) => colorBy[p.accession] ?? 0),
            colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
            size: 6,
            opacity: 0.5,
            showscale: true,
            colorbar: { title: 'log2 FC', len: 0.4 },
          }
        : { color: '#9ca3af', size: 6, opacity: 0.5 },
      text: others.map((p) => p.gene_name || p.accession),
      hoverinfo: 'text' as const,
      name: 'Proteins',
    });
  }

  if (selected.length > 0) {
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: selected.map((p) => p.x),
      y: selected.map((p) => p.y),
      marker: colorBy
        ? {
            color: [colorBy[selected[0]?.accession] ?? 0],
            colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
            size: 16,
            line: { color: '#1e293b', width: 2 },
            showscale: false,
          }
        : {
            color: '#ef4444',
            size: 16,
            line: { color: '#1e293b', width: 2 },
          },
      text: selected.map((p) => `${p.gene_name || p.accession} (selected)`),
      hoverinfo: 'text' as const,
      name: 'Selected',
    });
  }

  return {
    traces,
    layout: {
      title: { text: title, font: { size: 16, color: '#111827' } },
      xaxis: { title: { text: pcLabel(0, varExplained), font: { size: 14 } }, zeroline: false, automargin: true },
      yaxis: { title: { text: pcLabel(1, varExplained), font: { size: 14 } }, zeroline: false, automargin: true },
      height: 400,
      margin: { t: 60, b: 70, l: 70, r: 80 },
      hovermode: 'closest' as const,
      showlegend: selected.length > 0,
    },
  };
}

function buildComparisonTraces(props: ComparisonModeProps) {
  const { points, selectedKey, varExplained } = props;

  const { selected, others } = partitionPoints(points, selectedKey, (p) => p.comparison);

  const title = buildClusterTitle(props.title, varExplained);

  const traces = [];

  if (others.length > 0) {
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: others.map((p) => p.x),
      y: others.map((p) => p.y),
      marker: {
        color: '#9ca3af',
        size: 6,
        opacity: 0.5,
      },
      text: others.map((p) => formatComparisonKey(p.comparison)),
      hoverinfo: 'text' as const,
      name: 'Comparisons',
    });
  }

  if (selected.length > 0) {
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: selected.map((p) => p.x),
      y: selected.map((p) => p.y),
      marker: {
        color: '#ef4444',
        size: 16,
        line: { color: '#1e293b', width: 2 },
      },
      text: selected.map((p) => `${formatComparisonKey(p.comparison)} (selected)`),
      hoverinfo: 'text' as const,
      name: 'Selected',
    });
  }

  return {
    traces,
    layout: {
      title: { text: title, font: { size: 16, color: '#111827' } },
      xaxis: { title: { text: pcLabel(0, varExplained), font: { size: 14 } }, zeroline: false, automargin: true },
      yaxis: { title: { text: pcLabel(1, varExplained), font: { size: 14 } }, zeroline: false, automargin: true },
      height: 400,
      margin: { t: 60, b: 70, l: 70, r: 40 },
      hovermode: 'closest' as const,
      showlegend: false,
    },
  };
}

function partitionPoints<T extends { x: number; y: number }>(
  points: T[],
  selectedKey: string,
  getKey: (p: T) => string
): { selected: T[]; others: T[] } {
  const selected: T[] = [];
  const others: T[] = [];
  for (const p of points) {
    if (getKey(p) === selectedKey) {
      selected.push(p);
    } else {
      others.push(p);
    }
  }
  return { selected, others };
}
