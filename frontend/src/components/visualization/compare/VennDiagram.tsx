'use client';

import React, { useMemo, useState } from 'react';
import { formatComparisonKey, formatComparisonKeyWrapped, CHART_COLORS } from '@/lib/utils';
import type { VennData } from '@/types/api';
import { ChevronDown, ChevronRight } from 'lucide-react';

function fcColor(v: number | null | undefined): string {
  if (v == null) return '';
  return v > 0 ? '#E73564' : '#00ADEF';
}

interface Props {
  data: VennData | null;
  sideBySide?: boolean;
}

interface CircleSpec {
  comparisons: string[];
  cx: number;
  cy: number;
  r: number;
  color: string;
  labelParts: string[];
  labelX: number;
  labelY: number;
  textAnchor: 'start' | 'middle' | 'end';
}

interface RegionLabel {
  regionKey: string;
  x: number;
  y: number;
  count: number;
}

function vennLayout(data: VennData): { circles: CircleSpec[]; regionLabels: RegionLabel[] } {
  const entries = Object.entries(data.set_sizes);
  const scale = entries.length === 2 ? 3.5 : 3.0;
  const circles: CircleSpec[] = [];
  const regionLabels: RegionLabel[] = [];

  if (entries.length === 2) {
    const [[c1, s1], [c2, s2]] = entries;
    const r1 = Math.max(50, Math.sqrt(Math.max(s1, 1)) * scale);
    const r2 = Math.max(50, Math.sqrt(Math.max(s2, 1)) * scale);
    const overlapKey = [c1, c2].sort().join('+');
    const overlap = data.overlaps.find((o) => o.label === overlapKey)?.count ?? 0;
    const smaller = Math.min(s1, s2);
    const overlapRatio = smaller > 0 ? overlap / smaller : 0.3;
    const dMax = r1 + r2;
    const dMin = Math.abs(r1 - r2) + 10;
    const d = dMax - (dMax - dMin) * Math.min(1, overlapRatio * 1.5);
    const cx1 = 170 - d * (r2 / (r1 + r2));
    const cx2 = cx1 + d;
    const cy = 140;

    const parts1 = formatComparisonKeyWrapped(c1).split('<br>');
    const parts2 = formatComparisonKeyWrapped(c2).split('<br>');
    circles.push(
      { comparisons: [c1], cx: cx1, cy, r: r1, color: CHART_COLORS[0], labelParts: parts1,
        labelX: cx1 - r1 * 0.5, labelY: cy + r1 + 18, textAnchor: 'end' },
      { comparisons: [c2], cx: cx2, cy, r: r2, color: CHART_COLORS[1], labelParts: parts2,
        labelX: cx2 + r2 * 0.5, labelY: cy + r2 + 18, textAnchor: 'start' },
    );

    // Region labels
    const midX = (cx1 + cx2) / 2;
    const c1Only = (data.overlaps.find((o) => o.label === c1)?.count ?? 0);
    const c2Only = (data.overlaps.find((o) => o.label === c2)?.count ?? 0);
    regionLabels.push(
      { regionKey: c1, x: cx1 - r1 * 0.35, y: cy, count: c1Only },
      { regionKey: c2, x: cx2 + r2 * 0.35, y: cy, count: c2Only },
      { regionKey: overlapKey, x: midX, y: cy, count: overlap },
    );

    circles.sort((a, b) => b.r - a.r);
    return { circles, regionLabels };
  }

  // 3 circles
  const [[c1, s1], [c2, s2], [c3, s3]] = entries;
  const r1 = Math.max(40, Math.sqrt(Math.max(s1, 1)) * scale);
  const r2 = Math.max(40, Math.sqrt(Math.max(s2, 1)) * scale);
  const r3 = Math.max(40, Math.sqrt(Math.max(s3, 1)) * scale);
  const avgR = (r1 + r2 + r3) / 3;
  const gap = avgR * 0.5;
  const mid = 170;
  const topY = 100;
  const botY = topY + avgR + gap;

  circles.push(
    { comparisons: [c1], cx: mid, cy: topY, r: r1, color: CHART_COLORS[0],
      labelParts: formatComparisonKeyWrapped(c1).split('<br>'),
      labelX: mid, labelY: topY - r1 - 16, textAnchor: 'middle' },
    { comparisons: [c2], cx: mid - avgR * 0.8, cy: botY, r: r2, color: CHART_COLORS[1],
      labelParts: formatComparisonKeyWrapped(c2).split('<br>'),
      labelX: mid - avgR * 0.8 - r2 * 0.5, labelY: botY + r2 + 18, textAnchor: 'end' },
    { comparisons: [c3], cx: mid + avgR * 0.8, cy: botY, r: r3, color: CHART_COLORS[2],
      labelParts: formatComparisonKeyWrapped(c3).split('<br>'),
      labelX: mid + avgR * 0.8 + r3 * 0.5, labelY: botY + r3 + 18, textAnchor: 'start' },
  );

  // Approximate region label positions
  const cx = [mid, mid - avgR * 0.8, mid + avgR * 0.8];
  const cY = [topY, botY, botY];
  for (const ov of data.overlaps) {
    let x = 0, y = 0, n = 0;
    for (const comp of ov.region) {
      const idx = entries.findIndex(([k]) => k === comp);
      if (idx >= 0) { x += cx[idx]; y += cY[idx]; n++; }
    }
    if (n > 0) {
      regionLabels.push({ regionKey: ov.label, x: x / n, y: y / n, count: ov.count });
    }
  }

  circles.sort((a, b) => b.r - a.r);
  return { circles, regionLabels };
}

export default function VennDiagram({ data, sideBySide }: Props) {
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());

  const { circles, regionLabels } = useMemo(() => {
    if (!data || Object.keys(data.set_sizes).length === 0) {
      return { circles: [] as CircleSpec[], regionLabels: [] as RegionLabel[] };
    }
    return vennLayout(data);
  }, [data]);

  if (!data || Object.keys(data.set_sizes).length === 0) {
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

  const vbWidth = Math.max(340, circles.reduce((m, c) => Math.max(m, c.cx + c.r + 70), 0));
  const vbHeight = Math.max(280, circles.reduce((m, c) => Math.max(m, c.cy + c.r + 40), 0));

  const vennSvg = (
    <svg viewBox={`0 0 ${vbWidth} ${vbHeight}`} className="w-full max-w-[550px] mx-auto">
      {circles.map((c, i) => (
          <g key={i}>
            <circle
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={c.color}
              fillOpacity={0.3}
              stroke={c.color}
              strokeWidth={2}
              strokeOpacity={0.8}
            />
            <text
              x={c.labelX}
              y={c.labelY}
              textAnchor={c.textAnchor}
              fill="#334155"
              fontSize={11}
              fontWeight={500}
            >
              {c.labelParts.map((part, j) => (
                <tspan key={j} x={c.labelX} dy={j === 0 ? 0 : 13}>
                  {part}
                </tspan>
              ))}
            </text>
          </g>
        ))}
      {regionLabels.map((rl) => (
        <text
          key={rl.regionKey}
          x={rl.x}
          y={rl.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#1e293b"
          fontWeight={700}
          fontSize={12}
        >
          {rl.count}
        </text>
      ))}
    </svg>
  );

  const overlaps = data.overlaps ?? [];

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
            {expandedRegions.has(overlap.label) && (
              <div className="max-h-60 overflow-auto border-t border-border">
                {overlap.details && overlap.details.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface text-text-secondary sticky top-0">
                        <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">UniProt ID</th>
                        <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">Gene</th>
                        {overlap.region.map((comp, i) => (
                          <React.Fragment key={`${comp}-${i}`}>
                            <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                              {formatComparisonKey(comp)}<br />log2 FC
                            </th>
                            <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                              {formatComparisonKey(comp)}<br />adj.p
                            </th>
                          </React.Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overlap.details.map((d) => (
                        <tr key={d.accession} className="border-t border-border hover:bg-surface/30">
                          <td className="px-2 py-1 text-text-primary font-mono whitespace-nowrap">{d.accession}</td>
                          <td className="px-2 py-1 text-text-primary whitespace-nowrap">{d.gene_name}</td>
                          {overlap.region.map((comp, i) => (
                            <React.Fragment key={`${comp}-${i}`}>
                              <td className="px-2 py-1 text-right font-medium whitespace-nowrap" style={{
                                color: fcColor(d[`log_fc_${comp}`]),
                              }}>
                                {d[`log_fc_${comp}`] != null ? (d[`log_fc_${comp}`] as number).toFixed(2) : '-'}
                              </td>
                              <td className="px-2 py-1 text-right text-text-primary whitespace-nowrap">
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
                ) : (
                  <p className="text-xs text-text-muted px-3 py-4 text-center">
                    Re-compute Venn to load per-protein data.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  if (sideBySide) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-background border border-border rounded-lg p-4 flex items-center justify-center">
          {vennSvg}
        </div>
        <div className="lg:col-span-2 bg-background border border-border rounded-lg p-4">
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
