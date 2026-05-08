'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey, CHART_COLORS } from '@/lib/utils';
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
        layout: { title: { text: `${selectedName} vs ${correlatedName} (r = ${correlation.toFixed(3)})`, font: { size: 16, color: '#111827' } } },
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
    const pointColors = points.map(
      (p, i) => CHART_COLORS[i % CHART_COLORS.length]
    );
    const comparisons = points.map((p) => formatComparisonKey(p.comparison));

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
      title: { text: `${selectedName} vs ${correlatedName} (r = ${correlation.toFixed(3)})`, font: { size: 16, color: '#111827' } },
      xaxis: { title: { text: `${selectedName} log2 FC`, font: { size: 14 } }, automargin: true },
      yaxis: { title: { text: `${correlatedName} log2 FC`, font: { size: 14 } }, automargin: true },
      height: 380,
      margin: { t: 50, b: 90, l: 70, r: 40 },
      showlegend: true,
      legend: { orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center' },
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
        config={{ displayModeBar: 'hover', displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
