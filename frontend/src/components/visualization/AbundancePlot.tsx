'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type {
  AbundanceGroup,
  AbundancePoint,
  PeptideAbundanceData,
  ProteinAbundance,
} from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

const CONDITION_COLORS = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
];

interface AbundancePlotProps {
  data: ProteinAbundance | PeptideAbundanceData;
  peptide?: boolean;
}

function buildTrace(
  group: AbundanceGroup,
  points: AbundancePoint[],
  color: string,
  peptide: boolean,
) {
  if (points.length > 0) {
    return {
      x: points.map(() => group.condition),
      y: points.map((point) => point.processed_log2_abundance),
      customdata: points.map((point) => [
        point.sample_id,
        point.peptide_id ?? '',
        point.provenance,
      ]),
      type: 'box' as const,
      name: group.condition,
      boxpoints: 'all' as const,
      jitter: 0.28,
      pointpos: 0,
      marker: {
        color,
        size: 7,
        symbol: points.map((point) =>
          point.provenance === 'observed' ? 'circle' : 'circle-open'
        ),
        line: { color, width: 1.5 },
      },
      line: { color },
      fillcolor: `${color}55`,
      hovertemplate: peptide
        ? '<b>%{customdata[1]}</b><br>Sample: %{customdata[0]}<br>Normalized log2 abundance: %{y:.3f}<br>Evidence: %{customdata[2]}<extra></extra>'
        : '<b>%{customdata[0]}</b><br>Normalized log2 abundance: %{y:.3f}<br>Evidence: %{customdata[2]}<extra></extra>',
    };
  }

  return {
    x: [group.condition],
    q1: [group.q1],
    median: [group.median],
    q3: [group.q3],
    lowerfence: [group.lower_fence],
    upperfence: [group.upper_fence],
    type: 'box' as const,
    name: group.condition,
    boxpoints: false,
    line: { color },
    fillcolor: `${color}55`,
    hovertemplate:
      '<b>%{x}</b><br>Q1: %{q1:.3f}<br>Median: %{median:.3f}<br>Q3: %{q3:.3f}<extra></extra>',
  };
}

function ProcessedAbundancePlot({ data, peptide = false }: AbundancePlotProps) {
  const plotData = useMemo(() => {
    if (!data?.groups?.length) return [];
    return data.groups.map((group, index) => {
      const points = data.points.filter((point) => point.condition === group.condition);
      return buildTrace(
        group,
        points,
        CONDITION_COLORS[index % CONDITION_COLORS.length],
        peptide,
      );
    });
  }, [data, peptide]);

  const layout = useMemo(
    () => ({
      xaxis: {
        title: { text: 'Condition', font: { size: 12 }, standoff: 18 },
        tickfont: { size: 10 },
        gridcolor: '#E5E7EB',
        type: 'category' as const,
        categoryorder: 'array' as const,
        categoryarray: data.groups.map((group) => group.condition),
      },
      yaxis: {
        title: { text: 'Normalized log2 abundance', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      showlegend: false,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 70, r: 24, t: 24, b: 80 },
      boxmode: 'group' as const,
    }),
    [data.groups],
  );

  const config = useMemo(
    () => ({
      displayModeBar: 'hover' as const,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
      displaylogo: false,
      responsive: true,
    }),
    [],
  );

  return (
    <div className="w-full h-[420px] bg-background rounded-lg border border-border p-2">
      <Plot
        data={plotData}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  );
}

export function ProteinAbundancePlot({ data }: { data: ProteinAbundance }) {
  return <ProcessedAbundancePlot data={data} />;
}

export function PeptideAbundancePlot({ data }: { data: PeptideAbundanceData }) {
  return <ProcessedAbundancePlot data={data} peptide />;
}
