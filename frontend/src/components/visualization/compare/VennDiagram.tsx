'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { formatComparisonKey, CHART_COLORS } from '@/lib/utils';
import type { VennData } from '@/types/api';
import { ChevronDown, ChevronRight } from 'lucide-react';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  data: VennData | null;
  sideBySide?: boolean;
}

export default function VennDiagram({ data, sideBySide }: Props) {
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());

  const { barLabels, barValues, barColors, overlapRows } = useMemo(() => {
    if (!data) {
      return { barLabels: [], barValues: [], barColors: [], overlapRows: [] };
    }

    // Bar chart: one bar per set (individual) and one bar per overlap
    const labels: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];

    // Set bars
    let colorIdx = 0;
    for (const [setName, size] of Object.entries(data.set_sizes)) {
      labels.push(formatComparisonKey(setName));
      values.push(size);
      colors.push(CHART_COLORS[colorIdx % CHART_COLORS.length]);
      colorIdx++;
    }

    // Overlap bars
    for (const overlap of data.overlaps) {
      labels.push(overlap.label);
      values.push(overlap.count);
      colors.push('#94a3b8');
    }

    // Overlap rows for table
    const rows = data.overlaps.map((overlap) => {
      let displayProteins = 'No protein list available';
      if (data.sets && overlap.region.length > 0) {
        const setList = overlap.region.map((r) => new Set(data.sets[r] ?? []));
        const intersection = [...(setList[0] ?? [])].filter((a) =>
          setList.every((s) => s.has(a))
        );
        const display = intersection.slice(0, 50);
        displayProteins = display.join(', ') + (intersection.length > 50 ? ' ...' : '');
      }
      return {
        key: overlap.region.join('+'),
        region: overlap.region.map((r) => formatComparisonKey(r)),
        count: overlap.count,
        displayProteins,
      };
    });

    return { barLabels: labels, barValues: values, barColors: colors, overlapRows: rows };
  }, [data]);

  if (!data) {
    return (
      <div className="bg-background border border-border rounded-lg p-6 text-center">
        <p className="text-text-muted">
          Select 2-3 comparisons and click Run to compute Venn diagram
        </p>
      </div>
    );
  }

  const toggleRegion = (key: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const trace = {
    type: 'bar' as const,
    x: barLabels,
    y: barValues,
    marker: { color: barColors },
    text: barValues.map((v) => String(v)),
    textposition: 'outside' as const,
  };

  const layout = {
    title: { text: 'Venn Diagram (Set Sizes & Overlaps)', font: { size: 16, color: '#111827' } },
    xaxis: { tickangle: -45, automargin: true, title: { text: '', font: { size: 14 } } },
    yaxis: { title: { text: 'Protein Count', font: { size: 14 } }, automargin: true },
    height: 400,
    margin: { t: 60, b: 140, l: 70, r: 40 },
  };

  const overlapTable = overlapRows.length > 0 && (
    <div>
      <h4 className="text-sm font-medium text-text-primary mb-2">Overlap Details</h4>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface border-b border-border">
              <th className="text-left px-3 py-2 text-text-secondary font-medium">Regions</th>
              <th className="text-right px-3 py-2 text-text-secondary font-medium">Proteins</th>
              <th className="w-8 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {overlapRows.map((row) => (
              <React.Fragment key={row.key}>
                <tr
                  className="border-b border-border hover:bg-surface/50 cursor-pointer"
                  onClick={() => toggleRegion(row.key)}
                >
                  <td className="px-3 py-2 text-text-primary">
                    {row.region.join(', ')}
                  </td>
                  <td className="px-3 py-2 text-right text-text-primary font-medium">
                    {row.count}
                  </td>
                  <td className="px-3 py-2">
                    {expandedRegions.has(row.key) ? (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-muted" />
                    )}
                  </td>
                </tr>
                {expandedRegions.has(row.key) && (
                  <tr key={`${row.key}-proteins`} className="bg-surface/30">
                    <td colSpan={3} className="px-3 py-2">
                      <p className="text-xs text-text-muted max-h-48 overflow-y-auto">
                        {row.displayProteins}
                      </p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (sideBySide) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-background border border-border rounded-lg p-4">
          <Plot
            data={[trace]}
            layout={layout}
            config={{ displayModeBar: false, displaylogo: false, responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler
          />
        </div>
        <div className="bg-background border border-border rounded-lg p-4">
          {overlapTable || (
            <p className="text-text-muted text-sm text-center py-8">No overlap data</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background border border-border rounded-lg p-4 space-y-4">
      <Plot
        data={[trace]}
        layout={layout}
        config={{ displayModeBar: false, displaylogo: false, responsive: true }}
        style={{ width: '100%' }}
        useResizeHandler
      />
      {overlapTable}
    </div>
  );
}
