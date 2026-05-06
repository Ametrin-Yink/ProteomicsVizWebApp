'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinFCResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  selectedProtein: ProteinFCResult[];
  correlatedProtein: ProteinFCResult[];
  correlation: number;
  selectedName: string;
  correlatedName: string;
}

export default function CorrelationScatter({
  selectedProtein,
  correlatedProtein,
  correlation,
  selectedName,
  correlatedName,
}: Props) {
  const { traceScatter, traceRegression, layout } = useMemo(() => {
    // Match by comparison name
    const selectedMap = new Map(selectedProtein.map((p) => [p.comparison, p]));
    const points: Array<{ x: number; y: number; comparison: string }> = [];

    for (const cp of correlatedProtein) {
      const sp = selectedMap.get(cp.comparison);
      if (sp) {
        points.push({ x: sp.log_fc, y: cp.log_fc, comparison: cp.comparison });
      }
    }

    if (!points.length) {
      return {
        traceScatter: undefined,
        traceRegression: undefined,
        layout: { title: `${selectedName} vs ${correlatedName} (r = ${correlation.toFixed(3)})` },
      };
    }

    // Simple linear regression: y = mx + b
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
    const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const b = (sumY - m * sumX) / n;

    const xMin = Math.min(...points.map((p) => p.x));
    const xMax = Math.max(...points.map((p) => p.x));
    const regX = [xMin - 0.1, xMax + 0.1];
    const regY = regX.map((x) => m * x + b);

    // Unique colors by comparison
    const colorScale = [
      '#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#ec4899',
      '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16',
    ];
    const pointColors = points.map(
      (p, i) => colorScale[i % colorScale.length]
    );
    const comparisons = points.map((p) => p.comparison.replace(/_vs_/g, ' vs '));

    const traceScatter = {
      type: 'scatter' as const,
      mode: 'markers' as const,
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      marker: { color: pointColors, size: 8 },
      text: comparisons,
      hoverinfo: 'text' as const,
      name: 'Comparisons',
    };

    const traceRegression = {
      type: 'scatter' as const,
      mode: 'lines' as const,
      x: regX,
      y: regY,
      line: { color: '#1e293b', width: 1.5, dash: 'dash' as const },
      name: `y = ${m.toFixed(2)}x + ${b.toFixed(2)}`,
    };

    const layout = {
      title: `${selectedName} vs ${correlatedName} (r = ${correlation.toFixed(3)})`,
      xaxis: { title: `${selectedName} log2 FC` },
      yaxis: { title: `${correlatedName} log2 FC` },
      height: 350,
      margin: { t: 40, b: 60, l: 60, r: 40 },
      showlegend: true,
      legend: { x: 0.01, y: 0.99 },
      hovermode: 'closest' as const,
    };

    return { traceScatter, traceRegression, layout };
  }, [selectedProtein, correlatedProtein, correlation, selectedName, correlatedName]);

  if (!traceScatter || !traceRegression) {
    return (
      <div className="bg-background border border-border rounded-lg p-4 text-center text-text-muted">
        <p>No matching comparisons found between {selectedName} and {correlatedName}</p>
        <p className="text-xs mt-1">Correlation: {correlation.toFixed(3)}</p>
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg p-4">
      <Plot
        data={[traceScatter, traceRegression]}
        layout={layout}
        config={{ displayModeBar: true, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
