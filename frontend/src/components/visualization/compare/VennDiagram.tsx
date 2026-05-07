'use client';

import React, { useMemo, useState } from 'react';
import { formatComparisonKey, CHART_COLORS } from '@/lib/utils';
import type { VennData, VennOverlap } from '@/types/api';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  data: VennData | null;
  sideBySide?: boolean;
}

function vennLayout(data: VennData): Array<{
  comparisons: string[];
  cx: number;
  cy: number;
  r: number;
  color: string;
  label: string;
}> {
  const entries = Object.entries(data.set_sizes);
  if (entries.length === 2) {
    const [[c1, s1], [c2, s2]] = entries;
    const r1 = Math.max(60, Math.sqrt(s1) * 2.5);
    const r2 = Math.max(60, Math.sqrt(s2) * 2.5);
    const total = s1 + s2;
    const overlapKey = [c1, c2].sort().join('+');
    const overlapCount = data.overlaps.find((o) => o.label === overlapKey)?.count ?? 0;
    // Push circles apart proportionally to (total - overlap) / total
    const distFactor = total > 0 ? 1 - (overlapCount / total) * 1.2 : 0.7;
    const dist = (r1 + r2) * Math.max(0.3, distFactor);
    const cx1 = 150 - dist / 2;
    const cx2 = 150 + dist / 2;
    return [
      { comparisons: [c1], cx: cx1, cy: 130, r: r1, color: CHART_COLORS[0], label: formatComparisonKey(c1) },
      { comparisons: [c2], cx: cx2, cy: 130, r: r2, color: CHART_COLORS[1], label: formatComparisonKey(c2) },
    ];
  }
  // 3 circles — equilateral triangle layout
  const [[c1, s1], [c2, s2], [c3, s3]] = entries;
  const r1 = Math.max(50, Math.sqrt(s1) * 2.2);
  const r2 = Math.max(50, Math.sqrt(s2) * 2.2);
  const r3 = Math.max(50, Math.sqrt(s3) * 2.2);
  const cx = 150, cy = 130;
  const d = 80;
  return [
    { comparisons: [c1], cx: cx, cy: cy - d * 0.6, r: r1, color: CHART_COLORS[0], label: formatComparisonKey(c1) },
    { comparisons: [c2], cx: cx - d * 0.7, cy: cy + d * 0.4, r: r2, color: CHART_COLORS[1], label: formatComparisonKey(c2) },
    { comparisons: [c3], cx: cx + d * 0.7, cy: cy + d * 0.4, r: r3, color: CHART_COLORS[2], label: formatComparisonKey(c3) },
  ];
}

function getOverlapLabel(overlap: VennOverlap): string {
  return `${overlap.count} proteins`;
}

export default function VennDiagram({ data, sideBySide }: Props) {
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());

  const { circles, overlaps } = useMemo(() => {
    if (!data) return { circles: [], overlaps: [] as VennOverlap[] };
    return { circles: vennLayout(data), overlaps: data.overlaps };
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

  const vennSvg = (
    <svg viewBox="0 0 300 260" className="w-full max-w-[500px] mx-auto">
      {/* Circles (back to front by size, smallest on top) */}
      {[...circles]
        .sort((a, b) => b.r - a.r)
        .map((c, i) => (
          <g key={i}>
            <circle
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={c.color}
              fillOpacity={0.35}
              stroke={c.color}
              strokeWidth={2}
              strokeOpacity={0.8}
            />
            <text
              x={c.cx}
              y={c.cy}
              textAnchor="middle"
              dominantBaseline="central"
              className="text-xs"
              fill="#1e293b"
              fontWeight={600}
              fontSize={13}
            >
              {c.label}
            </text>
            <text
              x={c.cx}
              y={c.cy + 18}
              textAnchor="middle"
              fill="#475569"
              fontSize={11}
            >
              {data.set_sizes[c.comparisons[0]]} proteins
            </text>
          </g>
        ))}
    </svg>
  );

  const overlapTable = overlaps.length > 0 && (
    <div>
      <h4 className="text-sm font-medium text-text-primary mb-2">Overlap Details</h4>
      <div className="border border-border rounded-lg overflow-hidden max-h-[500px] overflow-y-auto">
        {overlaps.map((overlap) => (
          <div key={overlap.label} className="border-b border-border last:border-b-0">
            <div
              className="flex items-center px-3 py-2 hover:bg-surface/50 cursor-pointer"
              onClick={() => toggleRegion(overlap.label)}
            >
              <span className="flex-1 text-sm text-text-primary">
                {overlap.region.map((r) => formatComparisonKey(r)).join(' ∩ ')}
              </span>
              <span className="text-sm font-medium text-text-primary mr-2">{overlap.count}</span>
              {expandedRegions.has(overlap.label) ? (
                <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
              )}
            </div>
            {expandedRegions.has(overlap.label) && overlap.details && (
              <div className="max-h-64 overflow-y-auto border-t border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface text-text-secondary">
                      <th className="text-left px-2 py-1.5 font-medium">UniProt ID</th>
                      <th className="text-left px-2 py-1.5 font-medium">Gene</th>
                      {overlap.region.map((comp) => (
                        <React.Fragment key={comp}>
                          <th className="text-right px-2 py-1.5 font-medium">
                            {formatComparisonKey(comp)}<br />log2 FC
                          </th>
                          <th className="text-right px-2 py-1.5 font-medium">
                            {formatComparisonKey(comp)}<br />adj.p
                          </th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overlap.details.map((d) => (
                      <tr key={d.accession} className="border-t border-border hover:bg-surface/30">
                        <td className="px-2 py-1 text-text-primary font-mono">{d.accession}</td>
                        <td className="px-2 py-1 text-text-primary">{d.gene_name}</td>
                        {overlap.region.map((comp) => (
                          <React.Fragment key={comp}>
                            <td className="px-2 py-1 text-right text-text-primary">
                              {d[`log_fc_${comp}`] != null ? (d[`log_fc_${comp}`] as number).toFixed(2) : '-'}
                            </td>
                            <td className="px-2 py-1 text-right text-text-primary">
                              {d[`adj_pval_${comp}`] != null
                                ? (d[`adj_pval_${comp}`] as number) < 0.001
                                  ? (d[`adj_pval_${comp}`] as number).toExponential(1)
                                  : (d[`adj_pval_${comp}`] as number).toFixed(3)
                                : '-'}
                            </td>
                          </React.Fragment>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  if (sideBySide) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-background border border-border rounded-lg p-4 flex items-center justify-center">
          {vennSvg}
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
      <div className="flex items-center justify-center">
        {vennSvg}
      </div>
      {overlapTable}
    </div>
  );
}
