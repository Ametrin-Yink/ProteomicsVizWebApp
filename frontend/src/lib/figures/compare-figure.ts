/**
 * Compare figure export builders.
 *
 * Pure functions that build Plotly heatmap specs from comparison correlation
 * data, matching the SimilarityMatrix and ComparisonHeatmap components
 * exactly so exported HTML renders identically.
 */

import type { ComparisonCorrelationData } from '@/types/api';
import { formatComparisonKey, COLORSCALE_CYAN_GREY_CORAL } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompareFigureExport {
  /** Same structure as SimilarityMatrix — RMSD heatmap across comparisons. */
  similarityMatrixSpec: { data: unknown[]; layout: Record<string, unknown> } | null;
  /** Same structure as ComparisonHeatmap — fold-change heatmap. */
  heatmapSpec: { data: unknown[]; layout: Record<string, unknown> } | null;
  comparisonLabel: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the complete Compare figure export from raw comparison correlation data.
 *
 * Produces two Plotly heatmap specs:
 * 1. `similarityMatrixSpec` — RMSD similarity matrix across all selected
 *    comparisons (mirrors the SimilarityMatrix component).
 * 2. `heatmapSpec` — protein fold-change heatmap across comparisons (mirrors
 *    the ComparisonHeatmap component).
 */
export function buildCompareExport(
  data: ComparisonCorrelationData,
  comparisonLabel: string,
): CompareFigureExport {
  return {
    similarityMatrixSpec: buildSimilarityMatrixSpec(data),
    heatmapSpec: buildComparisonHeatmapSpec(data),
    comparisonLabel,
  };
}

// ---------------------------------------------------------------------------
// Internal: Similarity Matrix
// ---------------------------------------------------------------------------

function buildSimilarityMatrixSpec(
  data: ComparisonCorrelationData,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  const { comparisons, matrix } = data.similarity_matrix;
  if (!comparisons.length || !matrix.length) return null;

  const labels = comparisons.map((c) => formatComparisonKey(c).replace(/ vs /g, ' vs<br>'));

  const height = Math.max(400, comparisons.length * 40 + 120);

  // Annotations (text in cells) — identical logic to SimilarityMatrix
  const sorted = [...matrix.flat()].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const annotations: Array<Record<string, unknown>> = [];
  for (let i = 0; i < comparisons.length; i++) {
    for (let j = 0; j < comparisons.length; j++) {
      const val = matrix[i]?.[j];
      if (val !== undefined) {
        const textColor = val > median ? '#ffffff' : '#1e293b';
        annotations.push({
          x: j,
          y: i,
          text: val.toFixed(2),
          showarrow: false,
          font: { color: textColor, size: 11 },
        });
      }
    }
  }

  const trace: Record<string, unknown> = {
    type: 'heatmap',
    z: matrix,
    x: labels,
    y: labels,
    colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
    colorbar: {
      orientation: 'h',
      x: 0,
      y: -0.18,
      xanchor: 'right',
      yanchor: 'top',
      len: 0.35,
      thickness: 12,
    },
    hovertemplate: 'Comparison: %{x}<br>vs %{y}<br>RMSD: %{z:.3f}<extra></extra>',
  };

  const layout: Record<string, unknown> = {
    title: {
      text: 'Comparison Similarity Matrix',
      font: { size: 16, color: '#111827' },
    },
    xaxis: {
      tickangle: -90,
      automargin: true,
      title: { text: '', font: { size: 14 } },
    },
    yaxis: {
      autorange: 'reversed',
      automargin: true,
      title: { text: '', font: { size: 14 } },
    },
    height,
    margin: { t: 50, b: 160, l: 140, r: 40 },
    annotations,
  };

  return { data: [trace], layout };
}

// ---------------------------------------------------------------------------
// Internal: Comparison Fold-Change Heatmap
// ---------------------------------------------------------------------------

function buildComparisonHeatmapSpec(
  data: ComparisonCorrelationData,
): { data: unknown[]; layout: Record<string, unknown> } | null {
  const { proteins, comparisons, fold_changes } = data.heatmap_data;
  if (!proteins.length || !comparisons.length) return null;

  const xLabels = comparisons.map((c) => formatComparisonKey(c, 30));
  const yLabels = proteins.map((p) => {
    const label = p.gene_name || p.accession;
    return label.length > 25 ? `${label.slice(0, 25)}...` : label;
  });

  const height = Math.max(400, proteins.length * 12 + 150);

  const trace: Record<string, unknown> = {
    type: 'heatmap',
    z: fold_changes,
    x: xLabels,
    y: yLabels,
    colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
    zmid: 0,
    hovertemplate: 'Protein: %{y}<br>Comparison: %{x}<br>log2 FC: %{z:.2f}<extra></extra>',
  };

  const layout: Record<string, unknown> = {
    title: {
      text: 'Comparison Fold Change Heatmap',
      font: { size: 16, color: '#111827' },
    },
    xaxis: {
      tickangle: -45,
      automargin: true,
      title: { text: '', font: { size: 14 } },
    },
    yaxis: {
      autorange: 'reversed',
      automargin: true,
      title: { text: '', font: { size: 14 } },
    },
    height,
    margin: { t: 60, b: 120, l: 130, r: 60 },
  };

  return { data: [trace], layout };
}
