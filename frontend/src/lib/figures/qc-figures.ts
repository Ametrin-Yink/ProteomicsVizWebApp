/**
 * Pure QC figure builders — no React, no hooks.
 * Produces Plotly figure specs that match the QCPlots component EXACTLY.
 */

import { transformPCARowBased } from '@/lib/utils';
import type {
  QCData,
  PCAData,
  PValueDistribution,
  PSMCV,
  DataCompleteness,
  IntensityDistributions,
  QCOverviewData,
  QCPerSampleData,
  QCDifferentialData,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Palette — matches QCPlots PALETTE_24 exactly
// ---------------------------------------------------------------------------
const PALETTE_24 = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F',
  '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC',
  '#D37295', '#665191', '#A05195', '#D45087', '#F95D6A',
  '#FF7C43', '#FFA600', '#003F5C', '#2F4B7C', '#488F31',
  '#DE425B', '#69B33D', '#F7B844', '#7B68EE',
];

function hashColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function buildConditionColors(conditionList: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  conditionList.forEach((cond, i) => {
    map[cond] = PALETTE_24[i % PALETTE_24.length];
  });
  return map;
}

function getConditionColor(
  condition: string,
  conditionColors: Record<string, string>,
): string {
  if (conditionColors[condition]) return conditionColors[condition];
  const key = Object.keys(conditionColors).find(
    (k) => k.toLowerCase() === condition.toLowerCase(),
  );
  if (key) return conditionColors[key];
  return hashColor(condition);
}

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface QcBuildInput {
  /** QC data from the legacy /qc/plots endpoint. */
  data: QCData;
  /** Canonical overview data from /visualization/qc/overview. */
  overview?: QCOverviewData;
  /** Canonical per-sample data from /visualization/qc/per-sample. */
  perSample?: QCPerSampleData;
  /** Canonical differential data from /visualization/qc/differential. */
  differential?: QCDifferentialData | null;
  /** Ordered list of condition names for deterministic color mapping. */
  conditionList?: string[];
  /** Active comparison key used to select from pvalue_distributions. */
  selectedComparison?: string;
}

export interface QcFigureEntry {
  data: unknown[];
  layout: Record<string, unknown>;
}

export interface QcFigureExport {
  plots: Record<string, QcFigureEntry>;
}

// ---------------------------------------------------------------------------
// Internal helpers (same logic as QCPlots component)
// ---------------------------------------------------------------------------

function pcaTracesAndLayout(
  pca: PCAData,
  conditionColors: Record<string, string>,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  const rowData = transformPCARowBased(pca.samples, pca.pc1, pca.pc2, pca.conditions);

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
      color: getConditionColor(condition, conditionColors),
    },
    hovertemplate:
      '<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>',
  }));

  const nConditions = traces.length;
  const layout: Record<string, unknown> = {
    title: {
      text: `PCA Analysis (PC1: ${pca.pc1_variance.toFixed(1)}%, PC2: ${pca.pc2_variance.toFixed(1)}%)`,
      font: { size: 14, color: '#111827' },
    },
    xaxis: {
      title: { text: `PC1 (${pca.pc1_variance.toFixed(1)}%)`, font: { size: 12 } },
      zeroline: true,
      gridcolor: '#E5E7EB',
    },
    yaxis: {
      title: { text: `PC2 (${pca.pc2_variance.toFixed(1)}%)`, font: { size: 12 } },
      zeroline: true,
      gridcolor: '#E5E7EB',
    },
    showlegend: true,
    legend: {
      orientation: 'h',
      y: -0.15 * Math.ceil(nConditions / 4),
      x: 0.5,
      xanchor: 'center',
      font: { size: 11 },
    },
    plot_bgcolor: '#FFFFFF',
    paper_bgcolor: '#FFFFFF',
    margin: { l: 50, r: 30, t: 50, b: 20 + nConditions * 18 },
  };

  return { data: traces as unknown as unknown[], layout };
}

function pvalueTracesAndLayout(
  pvalueDist: PValueDistribution,
): { data: unknown[]; layout: Record<string, unknown> } {
  const trace = {
    x: pvalueDist.bins.slice(0, -1).map(
      (bin, i) => (bin + pvalueDist.bins[i + 1]) / 2,
    ),
    y: pvalueDist.counts,
    type: 'bar' as const,
    marker: {
      color: '#3B82F6',
      line: { color: '#2563EB', width: 1 },
    },
    hovertemplate: 'P-value: %{x:.3f}<br>Count: %{y}<extra></extra>',
  };

  const layout: Record<string, unknown> = {
    title: {
      text: 'P-value Distribution',
      font: { size: 14, color: '#111827' },
    },
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

  return { data: [trace] as unknown as unknown[], layout };
}

function cvTracesAndLayout(
  cv: PSMCV,
  title: string,
  conditionColors: Record<string, string>,
): { data: unknown[]; layout: Record<string, unknown> } {
  const entries = Object.entries(cv);
  const traces = entries.map(([condition, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return {
      y: values.filter((v) => v <= p95),
      type: 'box' as const,
      name: condition,
      marker: { color: getConditionColor(condition, conditionColors) },
      boxpoints: false,
      hovertemplate: 'CV: %{y:.1f}%<extra></extra>',
    };
  });

  const nConditions = traces.length;
  const layout: Record<string, unknown> = {
    title: {
      text: title,
      font: { size: 14, color: '#111827' },
    },
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

  return { data: traces as unknown as unknown[], layout };
}

function psmIntensityTracesAndLayout(
  boxData: IntensityDistributions['psm_boxplot'],
  conditionColors: Record<string, string>,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  if (!boxData || Object.keys(boxData).length === 0) return null;

  const traces: unknown[] = [];

  Object.entries(boxData).forEach(([condition, replicates]) => {
    const color = getConditionColor(condition, conditionColors);
    Object.entries(replicates).forEach(([repKey, vals]) => {
      if (vals && vals.length > 0) {
        traces.push({
          y: vals,
          type: 'box' as const,
          name: `${condition} - ${repKey}`,
          marker: { color, size: 3, outliercolor: color + '66' },
          boxpoints: 'outliers' as const,
          hovertemplate: `<b>${condition} - ${repKey}</b><br>Log2 Intensity: %{y:.2f}<extra></extra>`,
        });
      }
    });
  });

  const nTraces = traces.length;
  const layout: Record<string, unknown> = {
    title: {
      text: 'PSM Intensity Distribution',
      font: { size: 14, color: '#111827' },
    },
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
    legend: { orientation: 'h', y: -0.25 },
  };

  return { data: traces, layout };
}

function proteinIntensityTracesAndLayout(
  boxData: IntensityDistributions['protein_boxplot'],
  conditionColors: Record<string, string>,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  if (!boxData || Object.keys(boxData).length === 0) return null;

  const sampleNames = Object.keys(boxData);
  const nSamples = sampleNames.length;

  const traces = sampleNames.map((sample) => {
    const color = getConditionColor(sample, conditionColors);
    return {
      y: boxData[sample],
      type: 'box' as const,
      name: sample,
      marker: { color, size: 3, outliercolor: color + '66' },
      boxpoints: 'outliers' as const,
      hovertemplate: `<b>${sample}</b><br>Intensity: %{y:.2f}<extra></extra>`,
    };
  });

  const layout: Record<string, unknown> = {
    title: {
      text: 'Protein Intensity Distribution',
      font: { size: 14, color: '#111827' },
    },
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
    legend: { orientation: 'h', y: -0.25 },
  };

  return { data: traces as unknown as unknown[], layout };
}

function completenessTracesAndLayout(
  completeness: DataCompleteness,
  title: string,
  presentColor: string,
  missingColor: string,
): { data: unknown[]; layout: Record<string, unknown> } {
  const samples = Object.keys(completeness);
  const present = samples.map((s) => completeness[s].present);
  const missing = samples.map((s) => completeness[s].missing);
  const nSamples = samples.length;

  const traces: unknown[] = [
    {
      x: samples,
      y: present,
      name: 'Present',
      type: 'bar' as const,
      marker: { color: presentColor },
      hovertemplate: 'Present: %{y}<extra></extra>',
    },
    {
      x: samples,
      y: missing,
      name: 'Missing',
      type: 'bar' as const,
      marker: { color: missingColor },
      hovertemplate: 'Missing: %{y}<extra></extra>',
    },
  ];

  const layout: Record<string, unknown> = {
    title: {
      text: title,
      font: { size: 14, color: '#111827' },
    },
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
    barmode: 'stack',
    plot_bgcolor: '#FFFFFF',
    paper_bgcolor: '#FFFFFF',
    margin: { l: 50, r: 30, t: 50, b: nSamples > 2 ? 120 : 50 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.3 },
  };

  return { data: traces, layout };
}

// ---------------------------------------------------------------------------
// Canonical → legacy conversion
// ---------------------------------------------------------------------------

/**
 * Convert canonical QC data types (QCOverviewData, QCPerSampleData,
 * QCDifferentialData) into the legacy QCData format consumed by the
 * chart builders and by buildQcExport().
 *
 * Mapping rules:
 *  - PCA: row-based array → column-based PCAData (samples/pc1/pc2/conditions vectors)
 *  - P-value: differential.pvalue_distribution → data.pvalue_distribution
 *    and data.pvalue_distributions[comparison_id]
 *  - PSM/Protein CV: group peptide_cv/protein_cv quartiles → PSMCV dictionar{y,}
 *  - PSM intensity: perSample.psm_intensity (flat) → nested psm_boxplot
 *  - Protein intensity: perSample.protein_intensity (flat) → protein_boxplot
 *  - Data completeness: perSample.protein_completeness → DataCompleteness dict
 *  - PSM completeness: perSample.psm_completeness → DataCompleteness dict
 */
export function canonicalToQCData(
  overview: QCOverviewData,
  perSample: QCPerSampleData,
  differential?: QCDifferentialData | null,
): QCData {
  const data: QCData = {};

  // 1. PCA — row-based overview.pca → column-based PCAData
  if (overview.pca && overview.pca.length > 0) {
    data.pca = {
      samples: overview.pca.map((p) => p.sample_id),
      pc1: overview.pca.map((p) => p.pc1),
      pc2: overview.pca.map((p) => p.pc2),
      conditions: overview.pca.map((p) => p.condition),
      pc1_variance: overview.pc1_variance ?? 0,
      pc2_variance: overview.pc2_variance ?? 0,
    };
  }

  // 2. P-value distribution — from differential data
  if (differential?.pvalue_distribution) {
    data.pvalue_distribution = differential.pvalue_distribution;
    data.pvalue_distributions = {
      [differential.comparison_id]: differential.pvalue_distribution,
    };
  }

  // 3. PSM CV — from group peptide_cv quartiles
  const psmCv: PSMCV = {};
  const proteinCv: PSMCV = {};
  for (const group of overview.groups) {
    const { group_value: condition } = group;
    if (
      group.peptide_cv_q1 != null &&
      group.peptide_cv_median != null &&
      group.peptide_cv_q3 != null
    ) {
      psmCv[condition] = [
        group.peptide_cv_q1,
        group.peptide_cv_median,
        group.peptide_cv_q3,
      ];
    }
    if (
      group.protein_cv_q1 != null &&
      group.protein_cv_median != null &&
      group.protein_cv_q3 != null
    ) {
      proteinCv[condition] = [
        group.protein_cv_q1,
        group.protein_cv_median,
        group.protein_cv_q3,
      ];
    }
  }
  if (Object.keys(psmCv).length > 0) {
    data.psm_cv = psmCv;
  }
  if (Object.keys(proteinCv).length > 0) {
    data.protein_cv = proteinCv;
  }

  // 4. Intensity distributions
  const psmBoxplot: IntensityDistributions['psm_boxplot'] = {};
  for (const item of perSample.psm_intensity) {
    const vals = [item.q1, item.median, item.q3].filter(
      (v): v is number => v != null,
    );
    if (vals.length === 0) continue;
    if (!psmBoxplot[item.condition]) {
      psmBoxplot[item.condition] = {};
    }
    psmBoxplot[item.condition][item.replicate] = vals;
  }

  const proteinBoxplot: IntensityDistributions['protein_boxplot'] = {};
  for (const item of perSample.protein_intensity) {
    const vals = [item.abundance_q1, item.abundance_median, item.abundance_q3].filter(
      (v): v is number => v != null,
    );
    if (vals.length === 0) continue;
    proteinBoxplot[item.sample_id] = vals;
  }

  if (Object.keys(psmBoxplot).length > 0 || Object.keys(proteinBoxplot).length > 0) {
    data.intensity_distributions = {
      psm_boxplot: psmBoxplot,
      protein_boxplot: proteinBoxplot,
    };
  }

  // 5. Data completeness
  const dataCompleteness: DataCompleteness = {};
  for (const item of perSample.protein_completeness) {
    dataCompleteness[item.sample_id] = {
      present: item.present,
      missing: item.missing,
    };
  }
  if (Object.keys(dataCompleteness).length > 0) {
    data.data_completeness = dataCompleteness;
  }

  // 6. PSM completeness
  const psmCompleteness: DataCompleteness = {};
  for (const item of perSample.psm_completeness) {
    psmCompleteness[item.sample_id] = {
      present: item.present,
      missing: item.missing,
    };
  }
  if (Object.keys(psmCompleteness).length > 0) {
    data.psm_completeness = psmCompleteness;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build all 8 QC chart specs from raw QC data.
 * Returns a record keyed by chart id: `pca`, `pvalue`, `psmCv`, `proteinCv`,
 * `psmIntensity`, `proteinIntensity`, `completeness`, `psmCompleteness`.
 *
 * Charts whose input data is missing will have `null` entries.
 */
export function buildQcExport(input: QcBuildInput): QcFigureExport {
  const { data: rawData, overview, perSample, differential, conditionList, selectedComparison } = input;
  const conditionColors = buildConditionColors(conditionList ?? []);

  // Merge canonical data into legacy QCData if provided
  const data: QCData = overview && perSample
    ? { ...rawData, ...canonicalToQCData(overview, perSample, differential) }
    : rawData;

  // 1. PCA
  let pca: QcFigureEntry | null = null;
  if (data.pca) {
    const built = pcaTracesAndLayout(data.pca, conditionColors);
    if (built) {
      pca = built;
    }
  }

  // 2. P-value Distribution
  let pvalue: QcFigureEntry | null = null;
  const pvDist =
    selectedComparison && data.pvalue_distributions
      ? data.pvalue_distributions[selectedComparison]
      : data.pvalue_distribution;
  if (pvDist) {
    pvalue = pvalueTracesAndLayout(pvDist);
  }

  // 3. PSM CV
  let psmCv: QcFigureEntry | null = null;
  if (data.psm_cv) {
    psmCv = cvTracesAndLayout(
      data.psm_cv,
      'PSM CVs by Condition (whiskers at 95th %ile)',
      conditionColors,
    );
  }

  // 4. Protein CV
  let proteinCv: QcFigureEntry | null = null;
  if (data.protein_cv) {
    proteinCv = cvTracesAndLayout(
      data.protein_cv,
      'Protein CVs by Condition (whiskers at 95th %ile)',
      conditionColors,
    );
  }

  // 5. PSM Intensity
  let psmIntensity: QcFigureEntry | null = null;
  if (data.intensity_distributions?.psm_boxplot) {
    const built = psmIntensityTracesAndLayout(
      data.intensity_distributions.psm_boxplot,
      conditionColors,
    );
    if (built) {
      psmIntensity = built;
    }
  }

  // 6. Protein Intensity
  let proteinIntensity: QcFigureEntry | null = null;
  if (data.intensity_distributions?.protein_boxplot) {
    const built = proteinIntensityTracesAndLayout(
      data.intensity_distributions.protein_boxplot,
      conditionColors,
    );
    if (built) {
      proteinIntensity = built;
    }
  }

  // 7. Protein Completeness
  let completeness: QcFigureEntry | null = null;
  if (data.data_completeness) {
    completeness = completenessTracesAndLayout(
      data.data_completeness,
      'Protein Data Completeness by Sample',
      '#10B981',
      '#EF4444',
    );
  }

  // 8. PSM Completeness
  let psmCompleteness: QcFigureEntry | null = null;
  if (data.psm_completeness) {
    psmCompleteness = completenessTracesAndLayout(
      data.psm_completeness,
      'PSM Data Completeness by Sample',
      '#3B82F6',
      '#F59E0B',
    );
  }

  return {
    plots: {
      pca,
      pvalue,
      psmCv,
      proteinCv,
      psmIntensity,
      proteinIntensity,
      completeness,
      psmCompleteness,
    } as Record<string, QcFigureEntry>,
  };
}
