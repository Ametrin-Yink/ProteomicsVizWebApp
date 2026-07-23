'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { QCData, QCDifferentialData, QCOverviewData } from '@/types/api';
import { transformPCARowBased } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';
import { Maximize2, Download } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

function LazyPlot({ plotId, ...plotProps }: React.ComponentProps<typeof Plot> & { plotId: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={plotProps.style}>
      {visible ? (
        <Plot {...plotProps} style={{ width: '100%', height: '100%' }} useResizeHandler />
      ) : (
        <div data-testid={`${plotId}-skeleton`} className="h-full w-full animate-pulse bg-border/20 rounded" />
      )}
    </div>
  );
}

interface QCPlotsProps {
  data: QCData;
  overview?: QCOverviewData | null;
  differential?: QCDifferentialData | null;
  conditionList?: string[];
  selectedComparison: string;
  onComparisonChange: (value: string) => void;
  comparisonOptions: Array<{ value: string; label: string }>;
  onComparisonSearch?: (value: string) => void;
  groupBy: 'condition' | 'batch';
  onGroupByChange?: (value: 'condition' | 'batch') => void;
  groupSearch?: string;
  onGroupSearch?: (value: string) => void;
  labels?: {
    psm: string;
    entity: string;
  };
}

// 24-color palette — enough distinct colors for any realistic condition count
const PALETTE_24 = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  '#D37295', '#665191', '#A05195', '#D45087', '#F95D6A',
  '#FF7C43', '#FFA600', '#003F5C', '#2F4B7C', '#488F31',
  '#DE425B', '#69B33D', '#F7B844', '#7B68EE',
];

// Deterministic HSL-based fallback for >24 conditions
function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Reconstruct data so Plotly's percentile algorithm produces exact quartiles.
// Plotly uses R-type-7: index = (N-1)*p + 1 with linear interpolation.
// With 25×lf, 50×q1, 50×med, 50×q3, 25×uf (N=200), adjacent sorted
// values at each percentile boundary are identical → interpolated = exact.
// Outliers are excluded from the distribution — they would dominate
// (500 outliers vs 200 synthetic points) and distort the quartiles.
function boxStatsToValues(s: Record<string, unknown>, includeOutliers: boolean): number[] {
  const q1 = s.q1 as number, med = s.median as number, q3 = s.q3 as number;
  const lf = s.lowerfence as number, uf = s.upperfence as number;
  const vals: number[] = [];
  for (let i = 0; i < 25; i++) vals.push(lf);
  for (let i = 0; i < 50; i++) vals.push(q1);
  for (let i = 0; i < 50; i++) vals.push(med);
  for (let i = 0; i < 50; i++) vals.push(q3);
  for (let i = 0; i < 25; i++) vals.push(uf);
  if (includeOutliers) {
    const out = (s.outliers as number[]) || [];
    vals.push(...out.slice(0, 20));  // few enough not to distort the box
  }
  return vals;
}

// Convert old-style raw lists or new-style box-stats dicts into Plotly box traces.
// Old: {condition: [values...]} or {condition: {replicate: [values...]}}
// New: {condition: {q1, median, q3, lowerfence, upperfence, outliers}}
function normalizeBoxData(
  raw: Record<string, unknown>,
  getColor: (c: string) => string,
  labelFn: (key: string, subKey?: string) => string,
  hovertemplate: string,
  showOutliers: boolean = true,
): Array<Record<string, unknown>> {
  const bp = showOutliers ? 'outliers' as const : false;
  const traces: Array<Record<string, unknown>> = [];
  for (const [key, val] of Object.entries(raw)) {
    const color = getColor(key);
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const first = Object.values(val as Record<string, unknown>)[0];
      if (typeof first === 'object' && first !== null && !Array.isArray(first) && 'q1' in (first as object)) {
        // Nested box-stats: {condition: {replicate: stats}}
        for (const [subKey, stats] of Object.entries(val as Record<string, unknown>)) {
          const name = labelFn(key, subKey);
          traces.push({
            y: boxStatsToValues(stats as Record<string, unknown>, showOutliers),
            type: 'box', name,
            marker: { color, size: 3, outliercolor: color + '66' },
            boxpoints: bp, hovertemplate,
          });
        }
      } else if ('q1' in (val as object)) {
        // Flat box-stats: {condition: stats}
        const name = labelFn(key);
        traces.push({
          y: boxStatsToValues(val as Record<string, unknown>, showOutliers),
          type: 'box', name,
          marker: { color, size: 3, outliercolor: color + '66' },
          boxpoints: bp, hovertemplate,
        });
      } else if (Array.isArray(first)) {
        // Old nested list format
        for (const [subKey, vals] of Object.entries(val as Record<string, unknown>)) {
          const arr = vals as number[];
          if (arr.length > 0) {
            traces.push({
              y: arr, type: 'box',
              name: labelFn(key, subKey),
              marker: { color, size: 3, outliercolor: color + '66' },
              boxpoints: bp, hovertemplate,
            });
          }
        }
      }
    } else if (Array.isArray(val)) {
      // Old flat list format
      const name = labelFn(key);
      traces.push({
        y: val, type: 'box', name,
        marker: { color, size: 3, outliercolor: color + '66' },
        boxpoints: bp, hovertemplate,
      });
    }
  }
  return traces;
}

export default function QCPlots({
  data,
  overview,
  differential,
  conditionList,
  selectedComparison,
  onComparisonChange,
  comparisonOptions,
  onComparisonSearch,
  groupBy,
  onGroupByChange,
  groupSearch = '',
  onGroupSearch,
  labels = { psm: 'PSM', entity: 'Protein' },
}: QCPlotsProps) {
  // Build a deterministic condition→color map from the condition list
  const conditionColors = useMemo(() => {
    const map: Record<string, string> = {};
    (conditionList || []).forEach((cond, i) => {
      map[cond] = PALETTE_24[i % PALETTE_24.length];
    });
    return map;
  }, [conditionList]);

  // Shared color resolver — always derives from condition list, never hashes unless unknown
  const getConditionColor = useCallback((condition: string) => {
    if (conditionColors[condition]) return conditionColors[condition];
    const key = Object.keys(conditionColors).find(
      k => k.toLowerCase() === condition.toLowerCase()
    );
    if (key) return conditionColors[key];
    return hashColor(condition);
  }, [conditionColors]);

  const pcaPlot = useMemo(() => {
    if (overview?.pca.length) {
      const conditionGroups: Record<string, typeof overview.pca> = {};
      overview.pca.forEach((point) => {
        (conditionGroups[point.condition] ??= []).push(point);
      });
      const traces = Object.entries(conditionGroups).map(([condition, points]) => ({
        x: points.map((point) => point.pc1),
        y: points.map((point) => point.pc2),
        mode: 'markers' as const,
        type: 'scattergl' as const,
        name: condition,
        text: points.map((point) => point.sample_id),
        marker: { size: 8, color: getConditionColor(condition) },
        hovertemplate: '<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
      }));
      return {
        traces,
        layout: {
          title: { text: 'PCA of processed model input', font: { size: 14, color: '#111827' } },
          xaxis: {
            title: { text: overview.pc1_variance == null ? 'PC1' : `PC1 (${overview.pc1_variance.toFixed(1)}%)` },
            gridcolor: '#E5E7EB',
            zeroline: true,
          },
          yaxis: {
            title: { text: overview.pc2_variance == null ? 'PC2' : `PC2 (${overview.pc2_variance.toFixed(1)}%)` },
            gridcolor: '#E5E7EB',
            zeroline: true,
          },
          showlegend: true,
          plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF',
          margin: { l: 50, r: 30, t: 50, b: 70 },
        },
      };
    }
    if (!data.pca) return null;

    const rowData = transformPCARowBased(
      data.pca.samples,
      data.pca.pc1,
      data.pca.pc2,
      data.pca.conditions
    );

    const conditionGroups: Record<string, typeof rowData> = {};
    rowData.forEach((d) => {
      (conditionGroups[d.condition] ??= []).push(d);
    });

    const traces = Object.entries(conditionGroups).map(([condition, points]) => ({
      x: points.map((d) => d.pc1),
      y: points.map((d) => d.pc2),
      mode: 'markers' as const,
      type: 'scatter' as const,
      name: condition,
      text: points.map((d) => d.sample),
      marker: {
        size: 12,
        color: getConditionColor(condition),
      },
      hovertemplate: '<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
    }));

    const nConditions = traces.length;
    const layout = {
      title: {
        text: `PCA Analysis (PC1: ${data.pca.pc1_variance.toFixed(1)}%, PC2: ${data.pca.pc2_variance.toFixed(1)}%)`,
        font: { size: 14, color: '#111827' },
      },
      xaxis: {
        title: { text: `PC1 (${data.pca.pc1_variance.toFixed(1)}%)`, font: { size: 12 } },
        zeroline: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: `PC2 (${data.pca.pc2_variance.toFixed(1)}%)`, font: { size: 12 } },
        zeroline: true,
        gridcolor: '#E5E7EB',
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        y: -0.15 * Math.ceil(nConditions / 4),
        x: 0.5,
        xanchor: 'center' as const,
        font: { size: 11 },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 20 + nConditions * 18 },
    };

    return { traces, layout };
  }, [data.pca, getConditionColor, overview]);

  const pvalueDistPlot = useMemo(() => {
    const pvDist = differential?.pvalue_distribution ?? (selectedComparison && data.pvalue_distributions
      ? data.pvalue_distributions[selectedComparison]
      : data.pvalue_distribution);
    if (!pvDist) return null;

    const trace = {
      x: pvDist.bins.length === pvDist.counts.length
        ? pvDist.bins.map((bin) => bin + 0.025)
        : pvDist.bins.slice(0, -1).map((bin, i) => (bin + pvDist.bins[i + 1]) / 2),
      y: pvDist.counts,
      type: 'bar' as const,
      marker: {
        color: '#3B82F6',
        line: { color: '#2563EB', width: 1 },
      },
      hovertemplate: 'P-value: %{x:.3f}<br>Count: %{y}<extra></extra>',
    };

    const layout = {
      title: { text: 'P-value Distribution', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'P-value', font: { size: 12 } },
        range: [0, 1],
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: 50 },
      bargap: 0.1,
    };

    return { traces: [trace], layout };
  }, [data.pvalue_distribution, data.pvalue_distributions, differential, selectedComparison]);

  const groupAbundancePlot = useMemo(() => {
    if (!overview?.groups.length) return null;
    const traces = overview.groups.map((group) => {
      const color = getConditionColor(group.group_value);
      return {
        x: [group.group_value],
        q1: [group.q1],
        median: [group.median],
        q3: [group.q3],
        type: 'box' as const,
        name: group.group_value,
        boxpoints: false,
        line: { color },
        fillcolor: `${color}55`,
        hovertemplate: '<b>%{x}</b><br>Q1: %{q1:.3f}<br>Median: %{median:.3f}<br>Q3: %{q3:.3f}<extra></extra>',
      };
    });
    return {
      traces,
      layout: {
        title: { text: `Processed abundance by ${overview.group_by}`, font: { size: 14, color: '#111827' } },
        xaxis: { title: { text: overview.group_by }, automargin: true },
        yaxis: { title: { text: 'Normalized log2 abundance' }, gridcolor: '#E5E7EB' },
        boxmode: 'group' as const,
        showlegend: false,
        plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF',
        margin: { l: 60, r: 30, t: 50, b: 100 },
      },
    };
  }, [getConditionColor, overview]);

  const provenancePlot = useMemo(() => {
    if (!overview?.groups.length) return null;
    const groups = overview.groups.map((group) => group.group_value);
    return {
      traces: [
        { x: groups, y: overview.groups.map((group) => group.observed_count), name: 'Observed', type: 'bar' as const, marker: { color: '#10B981' } },
        { x: groups, y: overview.groups.map((group) => group.imputed_count), name: 'Imputed', type: 'bar' as const, marker: { color: '#F59E0B' } },
        { x: groups, y: overview.groups.map((group) => group.missing_count), name: 'Missing', type: 'bar' as const, marker: { color: '#EF4444' } },
      ],
      layout: {
        title: { text: `Evidence provenance by ${overview.group_by}`, font: { size: 14, color: '#111827' } },
        xaxis: { title: { text: overview.group_by }, automargin: true },
        yaxis: { title: { text: 'Feature count' }, gridcolor: '#E5E7EB' },
        barmode: 'stack' as const,
        showlegend: true,
        plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF',
        margin: { l: 60, r: 30, t: 50, b: 100 },
      },
    };
  }, [overview]);

  const psmCVPlot = useMemo(() => {
    if (overview) {
      const groups = overview.groups.filter((group) => group.peptide_cv_median != null);
      if (!groups.length) return null;
      return {
        traces: groups.map((group) => ({
          x: [group.group_value],
          q1: [group.peptide_cv_q1 as number],
          median: [group.peptide_cv_median as number],
          q3: [group.peptide_cv_q3 as number],
          type: 'box' as const,
          name: group.group_value,
          boxpoints: false,
          line: { color: getConditionColor(group.group_value) },
          fillcolor: `${getConditionColor(group.group_value)}55`,
          hovertemplate: '<b>%{x}</b><br>Q1: %{q1:.1f}%<br>Median: %{median:.1f}%<br>Q3: %{q3:.1f}%<extra></extra>',
        })),
        layout: {
          title: { text: `${labels.psm} CVs by ${overview.group_by}`, font: { size: 14, color: '#111827' } },
          xaxis: { title: { text: overview.group_by }, automargin: true },
          yaxis: { title: { text: 'Coefficient of Variation (%)' }, gridcolor: '#E5E7EB' },
          showlegend: false,
          plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF',
          margin: { l: 60, r: 30, t: 50, b: 100 },
        },
      };
    }
    if (!data.psm_cv) return null;
    const traces = normalizeBoxData(
      data.psm_cv, getConditionColor,
      (c) => c,
      'CV: %{y:.1f}%<extra></extra>',
      false,  // outliers are too numerous for CV plots
    );

    const nConditions = traces.length;
    const layout = {
      title: { text: `${labels.psm} CVs by Condition (whiskers at 95th %ile)`, font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nConditions > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nConditions > 2 ? 120 : 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.psm_cv, getConditionColor, labels.psm, overview]);

  const proteinCVPlot = useMemo(() => {
    if (overview) {
      const groups = overview.groups.filter((group) => group.protein_cv_median != null);
      if (!groups.length) return null;
      return {
        traces: groups.map((group) => ({
          x: [group.group_value],
          q1: [group.protein_cv_q1 as number],
          median: [group.protein_cv_median as number],
          q3: [group.protein_cv_q3 as number],
          type: 'box' as const,
          name: group.group_value,
          boxpoints: false,
          line: { color: getConditionColor(group.group_value) },
          fillcolor: `${getConditionColor(group.group_value)}55`,
          hovertemplate: '<b>%{x}</b><br>Q1: %{q1:.1f}%<br>Median: %{median:.1f}%<br>Q3: %{q3:.1f}%<extra></extra>',
        })),
        layout: {
          title: { text: `${labels.entity} CVs by ${overview.group_by}`, font: { size: 14, color: '#111827' } },
          xaxis: { title: { text: overview.group_by }, automargin: true },
          yaxis: { title: { text: 'Coefficient of Variation (%)' }, gridcolor: '#E5E7EB' },
          showlegend: false,
          plot_bgcolor: '#FFFFFF', paper_bgcolor: '#FFFFFF',
          margin: { l: 60, r: 30, t: 50, b: 100 },
        },
      };
    }
    if (!data.protein_cv) return null;
    const traces = normalizeBoxData(
      data.protein_cv, getConditionColor,
      (c) => c,
      'CV: %{y:.1f}%<extra></extra>',
      false,  // outliers are too numerous for CV plots
    );

    const nConditions = traces.length;
    const layout = {
      title: { text: `${labels.entity} CVs by Condition (whiskers at 95th %ile)`, font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Coefficient of Variation', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nConditions > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nConditions > 2 ? 120 : 50 },
      showlegend: false,
    };

    return { traces, layout };
  }, [data.protein_cv, getConditionColor, labels.entity, overview]);

  const psmIntensityPlot = useMemo(() => {
    if (overview) return null;
    const boxData = data.intensity_distributions?.psm_boxplot;
    if (!boxData || Object.keys(boxData).length === 0) return null;
    const traces = normalizeBoxData(
      boxData, getConditionColor,
      (c, r) => `${c} - ${r || ''}`,
      'Log2 Intensity: %{y:.2f}<extra></extra>',
    );

    const nTraces = traces.length;
    const layout = {
      title: { text: `${labels.psm} Intensity Distribution`, font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Log2 Intensity', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nTraces > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      boxgap: 0.3,
      boxgroupgap: 0,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nTraces > 2 ? 120 : 50 },
      showlegend: nTraces <= 12,
      legend: { orientation: 'h' as const, y: -0.25 },
    };

    return { traces, layout };
  }, [data.intensity_distributions?.psm_boxplot, getConditionColor, labels.psm, overview]);

  const proteinIntensityPlot = useMemo(() => {
    if (overview) return null;
    const boxData = data.intensity_distributions?.protein_boxplot;
    if (!boxData || Object.keys(boxData).length === 0) return null;
    const traces = normalizeBoxData(
      boxData, getConditionColor,
      (c) => c,
      'Intensity: %{y:.2f}<extra></extra>',
    );

    const nSamples = traces.length;
    const layout = {
      title: { text: `${labels.entity} Intensity Distribution`, font: { size: 14, color: '#111827' } },
      yaxis: {
        title: { text: 'Intensity', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
      },
      boxgap: 0.3,
      boxgroupgap: 0,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: nSamples <= 12,
      legend: { orientation: 'h' as const, y: -0.25 },
    };

    return { traces, layout };
  }, [data.intensity_distributions?.protein_boxplot, getConditionColor, labels.entity, overview]);

  const completenessPlot = useMemo(() => {
    if (overview) return null;
    if (!data.data_completeness) return null;

    const samples = Object.keys(data.data_completeness);
    const present = samples.map((s) => data.data_completeness![s].present);
    const missing = samples.map((s) => data.data_completeness![s].missing);
    const nSamples = samples.length;

    const traces = [
      {
        x: samples,
        y: present,
        name: 'Present',
        type: 'bar' as const,
        marker: { color: '#10B981' },
        hovertemplate: 'Present: %{y}<extra></extra>',
      },
      {
        x: samples,
        y: missing,
        name: 'Missing',
        type: 'bar' as const,
        marker: { color: '#EF4444' },
        hovertemplate: 'Missing: %{y}<extra></extra>',
      },
    ];

    const layout = {
      title: { text: `${labels.entity} Data Completeness by Sample`, font: { size: 14, color: '#111827' } },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.data_completeness, labels.entity, overview]);

  const psmCompletenessPlot = useMemo(() => {
    if (overview) return null;
    if (!data.psm_completeness) return null;

    const samples = Object.keys(data.psm_completeness);
    const present = samples.map((s) => data.psm_completeness![s].present);
    const missing = samples.map((s) => data.psm_completeness![s].missing);
    const nSamples = samples.length;

    const traces = [
      {
        x: samples,
        y: present,
        name: 'Present',
        type: 'bar' as const,
        marker: { color: '#3B82F6' },
        hovertemplate: 'Present: %{y}<extra></extra>',
      },
      {
        x: samples,
        y: missing,
        name: 'Missing',
        type: 'bar' as const,
        marker: { color: '#F59E0B' },
        hovertemplate: 'Missing: %{y}<extra></extra>',
      },
    ];

    const layout = {
      title: { text: `${labels.psm} Data Completeness by Sample`, font: { size: 14, color: '#111827' } },
      xaxis: {
        tickangle: nSamples > 2 ? -90 : 0,
        tickfont: { size: 11 },
        automargin: true,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: 'Count', font: { size: 12 } },
        gridcolor: '#E5E7EB',
      },
      barmode: 'stack' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
      showlegend: true,
      legend: { orientation: 'h' as const, y: -0.3 },
    };

    return { traces, layout };
  }, [data.psm_completeness, labels.psm, overview]);

  const config = {
    displayModeBar: 'hover',
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    displaylogo: false,
    responsive: true,
  };

  const plots = [
    { id: 'pca', data: pcaPlot, title: 'PCA Analysis' },
    { id: 'group-abundance', data: groupAbundancePlot, title: 'Processed Abundance Distribution' },
    { id: 'provenance', data: provenancePlot, title: 'Observed, Imputed, and Missing Evidence' },
    { id: 'pvalue', data: pvalueDistPlot, title: 'P-value Distribution' },
    { id: 'psm-cv', data: psmCVPlot, title: `${labels.psm} CVs` },
    { id: 'protein-cv', data: proteinCVPlot, title: `${labels.entity} CVs` },
    { id: 'psm-intensity', data: psmIntensityPlot, title: `${labels.psm} Intensity Distribution` },
    { id: 'protein-intensity', data: proteinIntensityPlot, title: `${labels.entity} Intensity Distribution` },
    { id: 'completeness', data: completenessPlot, title: `${labels.entity} Data Completeness` },
    { id: 'psm-completeness', data: psmCompletenessPlot, title: `${labels.psm} Data Completeness` },
  ];
  const sections = [
    {
      id: 'sample-relationships',
      title: 'Sample Relationships',
      scope: 'Experiment-wide',
      plotIds: ['pca'],
    },
    {
      id: 'abundance-distributions',
      title: 'Abundance Distributions',
      scope: 'Experiment-wide',
      plotIds: ['group-abundance', 'psm-intensity', 'protein-intensity'],
    },
    {
      id: 'missingness-imputation',
      title: 'Missingness and Imputation',
      scope: 'Experiment-wide',
      plotIds: ['provenance', 'completeness', 'psm-completeness'],
    },
    {
      id: 'reproducibility',
      title: 'Reproducibility',
      scope: 'Experiment-wide',
      plotIds: ['psm-cv', 'protein-cv'],
    },
    {
      id: 'differential-results',
      title: 'Differential Results',
      scope: 'Selected comparison',
      plotIds: ['pvalue'],
    },
  ];

  const [expandedPlot, setExpandedPlot] = useState<string | null>(null);

  const handleDownload = (plotId: string) => {
    const plotElement = document.querySelector(`[data-testid="${plotId}-plot"] .js-plotly-plot`);
    if (plotElement) {
      // @ts-expect-error - Plotly is loaded globally
      window.Plotly.toImage(plotElement, { format: 'png', width: 1200, height: 800 })
        .then((dataUrl: string) => {
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = `${plotId}-plot.png`;
          link.click();
        })
        .catch((err: unknown) => {
          console.error('Failed to download plot:', err);
        });
    }
  };

  return (
    <>
      <div data-testid="qc-plots-container" className="space-y-6">
        {sections.map((section) => {
          const sectionPlots = plots.filter((plot) => section.plotIds.includes(plot.id));
          return (
            <section key={section.id} data-testid={`qc-section-${section.id}`} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">{section.title}</h2>
                  <p className="mt-1 text-xs text-text-muted">{section.scope}</p>
                </div>
                {section.id === 'abundance-distributions' && onGroupByChange && (
                  <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                    {onGroupSearch && (
                      <label className="min-w-64 text-sm text-text-secondary">
                        <span className="sr-only">Search {groupBy} groups</span>
                        <input
                          value={groupSearch}
                          onChange={(event) => onGroupSearch(event.target.value)}
                          placeholder={`Search ${groupBy} groups...`}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                      Group by
                      <select
                        value={groupBy}
                        onChange={(event) => onGroupByChange(event.target.value as 'condition' | 'batch')}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="condition">Condition</option>
                        <option value="batch">Batch</option>
                      </select>
                    </label>
                  </div>
                )}
                {section.id === 'differential-results' && comparisonOptions.length > 0 && (
                  <div className="w-full max-w-sm">
                    <SearchableSelect
                      options={comparisonOptions}
                      value={selectedComparison}
                      onChange={onComparisonChange}
                      onSearchChange={onComparisonSearch}
                      placeholder="Select comparison..."
                      searchPlaceholder="Search all comparisons..."
                    />
                  </div>
                )}
              </div>
              {section.id === 'abundance-distributions' && overview && (
                <p className="text-xs text-text-muted">
                  Showing {overview.groups.length.toLocaleString()} of {overview.matching_group_count.toLocaleString()} matching {groupBy} groups
                  {overview.group_count !== overview.matching_group_count
                    ? ` (${overview.group_count.toLocaleString()} total)`
                    : ''}. A chart displays at most 50 groups; search reaches every group.
                </p>
              )}
              {section.id === 'differential-results' && differential && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-surface p-3 text-sm"><span className="text-text-muted">Tested</span><strong className="ml-2 text-text-primary">{differential.tested_count.toLocaleString()}</strong></div>
                  <div className="rounded-lg bg-surface p-3 text-sm"><span className="text-text-muted">Significant</span><strong className="ml-2 text-text-primary">{differential.significant_count.toLocaleString()}</strong></div>
                  <div className="rounded-lg bg-surface p-3 text-sm"><span className="text-text-muted">Failed/non-estimable</span><strong className="ml-2 text-text-primary">{differential.failed_count.toLocaleString()}</strong></div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {sectionPlots.map((plot) => plot.data ? (
                  <div key={plot.id} data-testid={`${plot.id}-plot`} className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-text-primary">{plot.title}</h3>
                      <div className="flex items-center gap-2">
                        <button data-testid={`expand-${plot.id}-btn`} onClick={() => setExpandedPlot(plot.id)} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary" title="Expand plot"><Maximize2 className="h-4 w-4" /></button>
                        <button data-testid={`download-${plot.id}-btn`} onClick={() => handleDownload(plot.id)} className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary" title="Download plot"><Download className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="h-[480px]"><LazyPlot plotId={plot.id} data={plot.data.traces} layout={plot.data.layout} config={config} style={{ width: '100%', height: '100%' }} /></div>
                  </div>
                ) : (
                  <div key={plot.id} data-testid={`${plot.id}-plot`} className="flex h-[480px] items-center justify-center rounded-lg border border-border bg-surface p-4">
                    <div data-testid="no-data" className="text-center text-text-muted"><p className="text-lg font-medium">{plot.title}</p><p className="mt-2 text-sm">No data available</p></div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {expandedPlot && (
        <div
          data-testid="plot-modal"
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedPlot(null)}
        >
          <div
            className="bg-background rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">
                {plots.find(p => p.id === expandedPlot)?.title}
              </h2>
              <button
                data-testid="close-modal-btn"
                onClick={() => setExpandedPlot(null)}
                className="p-2 text-text-muted hover:text-text-primaryhover:bg-surface rounded-md transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 h-[600px]">
              {(() => {
                const plot = plots.find(p => p.id === expandedPlot);
                return plot?.data ? (
                  <Plot
                    data={plot.data.traces}
                    layout={{ ...plot.data.layout, margin: { l: 60, r: 30, t: 50, b: 60 } }}
                    config={config}
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler={true}
                  />
                ) : null;
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
