'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { ProteinAbundance, PSMAbundanceData } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ProteinAbundancePlotProps {
  data: ProteinAbundance;
  title?: string;
}

export function ProteinAbundancePlot({ data, title = 'Protein Abundance' }: ProteinAbundancePlotProps) {
  const plotData = useMemo(() => {
    // Defensive: ensure data exists and has required arrays
    if (!data || !data.samples || !data.abundances || data.samples.length === 0) {
      return [];
    }

    // Group by condition, filter out negative values
    const conditionData: { [condition: string]: { samples: string[]; abundances: number[] } } = {};

    data.samples.forEach((sample, i) => {
      const condition = data.conditions?.[i] || 'Unknown';
      const abundance = data.abundances?.[i];

      // Filter out negative or undefined values
      if (abundance === undefined || abundance === null || abundance < 0) {
        return; // Skip negative values
      }

      if (!conditionData[condition]) {
        conditionData[condition] = { samples: [], abundances: [] };
      }
      conditionData[condition].samples.push(sample);
      conditionData[condition].abundances.push(abundance);
    });

    const colors: Record<string, string> = {
      Control: '#00ADEF',
      Treatment: '#E73564',
      DMSO: '#00ADEF',
    };

    // Helper to determine if condition is treatment
    const isTreatment = (condition: string) => {
      const upper = condition.toUpperCase();
      return upper.includes('INCZ') || upper.includes('TREATMENT');
    };

    return Object.entries(conditionData).map(([condition, values]) => {
      // Determine color based on condition name
      let color = colors[condition];
      if (!color) {
        color = isTreatment(condition) ? '#E73564' : '#6B7280';
      }
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
      title: {
        text: title,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: 'Sample', font: { size: 12 } },
        tickangle: -45,
        tickfont: { size: 9 },
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Protein Abundance', font: { size: 12 } },
        gridcolor: '#E5E7EB',
        // Ensure y-axis starts at 0 to show missing values clearly
        rangemode: 'tozero' as const,
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        y: -0.35,
        x: 0.5,
        xanchor: 'center' as const,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 40, b: 100 },
      barmode: 'group' as const,
    }),
    [title]
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
    <div className="w-full h-[350px] bg-white rounded-lg border border-gray-200 p-2">
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

interface PSMAbundancePlotProps {
  data: PSMAbundanceData;
  title?: string;
}

export function PSMAbundancePlot({ data, title = 'PSM Abundance' }: PSMAbundancePlotProps) {
  const plotData = useMemo(() => {
    // Defensive: ensure data exists and has psms array
    if (!data || !data.psms || data.psms.length === 0) {
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

    data.psms.forEach((psm, index) => {
      // Defensive: ensure psm has required arrays
      if (!psm || !psm.samples || !psm.abundances) {
        return;
      }

      const color = colors[index % colors.length];
      traces.push({
        x: psm.samples,
        y: psm.abundances,
        mode: 'lines+markers' as const,
        name: psm.psm_id || `PSM ${index + 1}`,
        line: { color, width: 2 },
        marker: { size: 6 },
        hovertemplate: `<b>${psm.sequence || 'Unknown'}</b><br>Sample: %{x}<br>Abundance: %{y:.2f}<extra></extra>`,
        type: 'scatter' as const,
      });
    });

    return traces;
  }, [data]);

  const layout = useMemo(
    () => ({
      title: {
        text: title,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: 'Sample', font: { size: 12 } },
        tickangle: -45,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Abundance', font: { size: 12 } },
        gridcolor: '#E5E7EB',
        rangemode: 'tozero' as const,
      },
      showlegend: true,
      legend: {
        orientation: 'v' as const,
        x: 1.05,
        y: 1,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 100, t: 40, b: 80 },
    }),
    [title]
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
    <div className="w-full h-[250px] bg-white rounded-lg border border-gray-200 p-2">
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
