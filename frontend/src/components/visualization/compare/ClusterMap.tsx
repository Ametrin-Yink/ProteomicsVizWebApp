'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinClusterPoint, ComparisonClusterPoint } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ProteinModeProps {
  mode: 'protein';
  points: ProteinClusterPoint[];
  selectedKey: string;
  colorBy: Record<string, number>;
  varExplained?: number;
}

interface ComparisonModeProps {
  mode: 'comparison';
  points: ComparisonClusterPoint[];
  selectedKey: string;
  varExplained?: number;
}

type Props = ProteinModeProps | ComparisonModeProps;

const COLORS = [
  '#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#ec4899',
  '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16',
];

export default function ClusterMap(props: Props) {
  const { traces, layout } = useMemo(() => {
    if (props.mode === 'protein') {
      return buildProteinTraces(props);
    }
    return buildComparisonTraces(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.points, props.selectedKey]);

  if (!props.points.length) {
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

  const fcValues = points.map((p) => colorBy[p.accession] ?? 0);
  const { selected, others } = partitionPoints(points, selectedKey, (p) => p.accession);

  const title = varExplained
    ? `PCA (${varExplained.toFixed(1)}% variance explained)`
    : 'Cluster Map';

  const traces = [];

  if (others.length > 0) {
    const otherFC = others.map((p) => colorBy[p.accession] ?? 0);
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: others.map((p) => p.x),
      y: others.map((p) => p.y),
      marker: {
        color: otherFC,
        colorscale: [[0, '#3b82f6'], [0.5, '#ffffff'], [1, '#ef4444']] as unknown as string[][],
        size: 6,
        showscale: true,
        colorbar: { title: 'log2 FC', len: 0.4 },
      },
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
      marker: {
        color: [colorBy[selected[0]?.accession] ?? 0],
        colorscale: [[0, '#3b82f6'], [0.5, '#ffffff'], [1, '#ef4444']] as unknown as string[][],
        size: 16,
        line: { color: '#1e293b', width: 2 },
        showscale: false,
      },
      text: selected.map((p) => `${p.gene_name || p.accession} (selected)`),
      hoverinfo: 'text' as const,
      name: 'Selected',
    });
  }

  return {
    traces,
    layout: {
      title,
      xaxis: { title: 'Component 1', zeroline: false },
      yaxis: { title: 'Component 2', zeroline: false },
      height: 400,
      margin: { t: 40, b: 60, l: 60, r: 80 },
      hovermode: 'closest' as const,
      showlegend: selected.length > 0,
    },
  };
}

function buildComparisonTraces(props: ComparisonModeProps) {
  const { points, selectedKey, varExplained } = props;

  const { selected, others } = partitionPoints(points, selectedKey, (p) => p.comparison);

  const title = varExplained
    ? `PCA (${varExplained.toFixed(1)}% variance explained)`
    : 'Cluster Map';

  const traces = [];

  if (others.length > 0) {
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: others.map((p) => p.x),
      y: others.map((p) => p.y),
      marker: {
        color: '#6366f1',
        size: 6,
      },
      text: others.map((p) => p.comparison.replace(/_vs_/g, ' vs ')),
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
      text: selected.map((p) => `${p.comparison.replace(/_vs_/g, ' vs ')} (selected)`),
      hoverinfo: 'text' as const,
      name: 'Selected',
    });
  }

  return {
    traces,
    layout: {
      title,
      xaxis: { title: 'Component 1', zeroline: false },
      yaxis: { title: 'Component 2', zeroline: false },
      height: 400,
      margin: { t: 40, b: 60, l: 60, r: 20 },
      hovermode: 'closest' as const,
      showlegend: selected.length > 0,
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
