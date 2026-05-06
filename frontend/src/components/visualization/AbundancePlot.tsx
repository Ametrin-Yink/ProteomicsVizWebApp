'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinAbundance, PeptideAbundanceData } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ProteinAbundancePlotProps {
  data: ProteinAbundance;
}

export function ProteinAbundancePlot({ data }: ProteinAbundancePlotProps) {
  const plotData = useMemo(() => {
    // Defensive: ensure data exists and has required arrays
    if (!data || !data.samples || !data.abundances || data.samples.length === 0) {
      return [];
    }

    // Group by condition, include ALL samples (even with zero/missing values)
    // Filter out metadata columns like PSM_Count
    const conditionData: { [condition: string]: { samples: string[]; abundances: number[] } } = {};

    data.samples.forEach((sample, i) => {
      // Skip metadata columns
      if (sample === 'PSM_Count' || sample === 'psm_count' || sample === 'Protein') {
        return;
      }

      const condition = data.conditions?.[i] || 'Unknown';
      const abundance = data.abundances?.[i];

      // Include all values, treating undefined/null as 0
      const validAbundance = abundance === undefined || abundance === null ? 0 : abundance;

      if (!conditionData[condition]) {
        conditionData[condition] = { samples: [], abundances: [] };
      }
      conditionData[condition].samples.push(sample);
      conditionData[condition].abundances.push(validAbundance);
    });

    const TABLEAU_10 = [
      '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
      '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
    ];

    function getColorForCondition(condition: string, index: number): string {
      return TABLEAU_10[index % TABLEAU_10.length];
    }

    return Object.entries(conditionData).map(([condition, values], idx) => {
      const color = getColorForCondition(condition, idx);
      return {
        x: values.samples,
        y: values.abundances,
        type: 'bar' as const,
        name: condition,
        marker: {
          color,
        },
        hovertemplate: '<b>%{x}</b><br>Abundance: %{y:.3f}<extra></extra>',
      };
    });
  }, [data]);

  const layout = useMemo(
    () => ({
      xaxis: {
        title: { text: 'Sample', font: { size: 12 }, standoff: 20 },
        tickangle: -45,
        tickfont: { size: 9 },
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Abundance', font: { size: 12 } },
        gridcolor: '#E5E7EB',
        rangemode: 'tozero' as const,
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        y: -0.5,
        x: 0.5,
        xanchor: 'center' as const,
        yanchor: 'top' as const,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: 30, t: 30, b: 170 },
      barmode: 'group' as const,
    }),
    []
  );

  const config = useMemo(
    () => ({
      displayModeBar: true,
      modeBarButtonsToRemove: ['select2d', 'lasso2d'],
      displaylogo: false,
      responsive: true,
    }),
    []
  );

  return (
    <div className="w-full h-[450px] bg-background rounded-lg border border-border p-2">
      <Plot
        data={plotData}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler={true}
      />
    </div>
  );
}

interface PeptideAbundancePlotProps {
  data: PeptideAbundanceData;
}

export function PeptideAbundancePlot({ data }: PeptideAbundancePlotProps) {
  const plotData = useMemo(() => {
    // Defensive: ensure data exists and has peptides array
    if (!data || !data.peptides || data.peptides.length === 0) {
      return [];
    }

    const traces: Array<{
      x: string[];
      y: number[];
      mode: 'lines+markers';
      name: string;
      line: { color: string; width: number };
      marker: { size: number };
      hovertemplate: string;
      type: 'scatter';
    }> = [];

    const colors = ['#E73564', '#00ADEF', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

    data.peptides.forEach((peptide, index) => {
      if (!peptide || !peptide.samples || !peptide.abundances) {
        return;
      }

      // Aggregate abundances by sample (multiple rows per sample from different charge states)
      const aggregated = new Map<string, number>();
      peptide.samples.forEach((s, i) => {
        aggregated.set(s, (aggregated.get(s) || 0) + peptide.abundances[i]);
      });

      // Sort by sample name for consistent ordering
      const sorted = [...aggregated.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const sortedSamples = sorted.map(([s]) => s);
      const sortedAbundances = sorted.map(([, v]) => v);

      // Min-max normalize to 0-1
      const minVal = Math.min(...sortedAbundances);
      const maxVal = Math.max(...sortedAbundances);
      const range = maxVal - minVal || 1;
      const normalizedY = sortedAbundances.map(v => (v - minVal) / range);

      const color = colors[index % colors.length];
      traces.push({
        x: sortedSamples,
        y: normalizedY,
        mode: 'lines+markers' as const,
        name: peptide.sequence || peptide.peptide_id || `Peptide ${index + 1}`,
        line: { color, width: 2 },
        marker: { size: 6 },
        hovertemplate: `<b>${peptide.peptide_id || 'Unknown'}</b><br>Sample: %{x}<br>Abundance: %{y:.2f}<extra></extra>`,
        type: 'scatter' as const,
      });
    });

    return traces;
  }, [data]);

  const peptideCount = data?.peptides?.length ?? 0;
  const plotHeight = 450 + peptideCount * 12;
  const maxPlotHeight = Math.min(plotHeight, 750);

  const layout = useMemo(
    () => ({
      xaxis: {
        title: { text: 'Sample', font: { size: 12 }, standoff: 20 },
        tickangle: -45,
        tickfont: { size: 10 },
        gridcolor: '#E5E7EB',
        type: 'category' as const,
      },
      yaxis: {
        title: { text: 'Relative Abundance', font: { size: 12 } },
        gridcolor: '#E5E7EB',
        range: [-0.05, 1.05],
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        x: 0.5,
        y: -0.7,
        xanchor: 'center' as const,
        yanchor: 'top' as const,
        font: { size: 10 },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 30, b: 200 + peptideCount * 10 },
    }),
    [peptideCount]
  );

  const config = useMemo(
    () => ({
      displayModeBar: false,
      displaylogo: false,
      responsive: true,
    }),
    []
  );

  return (
    <div className="w-full bg-background rounded-lg border border-border p-2"
      style={{ height: `${plotHeight}px`, maxHeight: `${maxPlotHeight}px`, overflowY: 'auto' }}>
      <Plot
        data={plotData}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler={true}
      />
    </div>
  );
}
