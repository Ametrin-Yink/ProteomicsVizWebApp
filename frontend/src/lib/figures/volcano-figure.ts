/**
 * Volcano figure export builder.
 *
 * Pure function that builds a Plotly figure spec and DE table data from
 * differential expression results. Matches the structure produced by the
 * VolcanoPlot component so exported HTML renders identically.
 */

import type { DEResult, VolcanoFilters } from '@/types/api';
import {
  getVolcanoPointColor,
  isSignificantVolcano,
  parseDelimited,
} from '@/lib/utils';

/** Return shape for the volcano export builder. */
export interface VolcanoFigureExport {
  figureSpec: {
    data: unknown[];
    layout: Record<string, unknown>;
  };
  deTable: {
    columns: { key: string; label: string }[];
    rows: Record<string, unknown>[];
  };
  markedProteins: string[];
  comparisonLabel: string;
}

/**
 * Build a complete volcano figure spec and accompanying DE table data.
 *
 * @param deResults      Array of differential expression results.
 * @param filters        Volcano filter thresholds (foldChange, pValue, s0 …).
 * @param comparisonLabel  Human-readable label e.g. "A375 vs A549".
 * @param markedProteins   Array of master-protein-accession strings to highlight.
 */
export function buildVolcanoExport(
  deResults: DEResult[],
  filters: VolcanoFilters,
  comparisonLabel: string,
  markedProteins: string[],
): VolcanoFigureExport {
  const parts = comparisonLabel.split(' vs ');
  const group1Label = parts[0] || 'Treatment';
  const group2Label = parts[1] || 'Control';
  const markedSet = new Set(markedProteins);

  // ── Dynamic y-axis range ──────────────────────────────────────────────
  let rawMaxY = 0;
  let maxAbsFC = 0;
  for (const d of deResults) {
    rawMaxY = Math.max(rawMaxY, -Math.log10(d.pval || 1e-300));
    maxAbsFC = Math.max(maxAbsFC, Math.abs(d.log_fc));
  }
  const dynamicMaxY = Math.max(2, Math.ceil(rawMaxY * 1.1));

  // ── Threshold lines / curves ──────────────────────────────────────────
  const maxX = maxAbsFC * 1.1;

  const thresholdShapes = buildThresholdShapes(
    filters,
    dynamicMaxY,
    maxX,
    deResults.length === 0,
  );

  // ── Marked protein data (overlay trace + annotations) ─────────────────
  const markedData = deResults
    .filter((d) => markedSet.has(d.master_protein_accessions))
    .map((d) => ({
      x: d.log_fc,
      y: -Math.log10(d.pval || 1e-300),
      color: getVolcanoPointColor(d.log_fc, d.pval, d.adj_pval, filters),
      label:
        d.gene_name || parseDelimited(d.master_protein_accessions)[0],
    }));

  // ── Per-point properties for the main trace ───────────────────────────
  const points = deResults.map((d) => {
    const isMarked = markedSet.has(d.master_protein_accessions);
    return {
      x: d.log_fc,
      y: -Math.log10(d.pval || 1e-300),
      color: getVolcanoPointColor(d.log_fc, d.pval, d.adj_pval, filters),
      size: isMarked ? 10 : 6,
      opacity: isMarked ? 0.9 : 0.7,
      lineColor: isMarked ? '#1F2937' : 'transparent',
      lineWidth: isMarked ? 1.5 : 0,
      customdata: d.master_protein_accessions,
    };
  });

  // ── Hover text (matches VolcanoPlot component exactly) ────────────────
  const hoverText = deResults.map((d) => {
    const accessions = parseDelimited(d.master_protein_accessions);
    const genes = d.gene_name ? parseDelimited(d.gene_name) : [];
    const maxAcc = 5;
    const accDisplay = accessions.length > maxAcc
      ? accessions.slice(0, maxAcc).join(', ') + ` +${accessions.length - maxAcc} more`
      : accessions.join(', ');
    const maxGenes = 3;
    const geneDisplay = genes.length > maxGenes
      ? genes.slice(0, maxGenes).join(', ') + ` +${genes.length - maxGenes} more`
      : genes.length > 0 ? genes.join(', ') : 'N/A';

    return (
      `<b>${accDisplay}</b><br>` +
      `Gene: ${geneDisplay}<br>` +
      `Log2 FC: ${(d.log_fc ?? 0).toFixed(3)}<br>` +
      `P-value: ${(d.pval ?? 1).toExponential(2)}<br>` +
      `Adj P-value: ${(d.adj_pval ?? 1).toExponential(2)}`
    );
  });

  // ── Main scatter trace (single trace, per-point styling) ──────────────
  const mainTrace: Record<string, unknown> = {
    x: points.map((p) => p.x),
    y: points.map((p) => p.y),
    mode: 'markers',
    type: 'scatter',
    marker: {
      color: points.map((p) => p.color),
      size: points.map((p) => p.size),
      opacity: points.map((p) => p.opacity),
      line: {
        color: points.map((p) => p.lineColor),
        width: points.map((p) => p.lineWidth),
      },
    },
    text: hoverText,
    hoverinfo: 'text',
    hoverlabel: { namelength: -1, font: { size: 12 } },
    customdata: points.map((p) => p.customdata),
    name: 'Proteins',
  };

  const traces: Record<string, unknown>[] = [mainTrace];

  // ── Overlay trace for marked proteins ──────────────────────────────────
  if (markedData.length > 0) {
    traces.push({
      x: markedData.map((p) => p.x),
      y: markedData.map((p) => p.y),
      mode: 'markers',
      type: 'scatter',
      marker: {
        color: markedData.map((p) => p.color),
        size: 10,
        opacity: 0.9,
        line: { color: '#1F2937', width: 1.5 },
      },
      text: markedData.map((p) => p.label),
      hoverinfo: 'text',
      showlegend: false,
      name: 'Marked',
    });
  }

  // ── Annotations for marked proteins ───────────────────────────────────
  const annotations = markedData.map((p) => ({
    x: p.x,
    y: p.y,
    ax: 0,
    ay: -28,
    text: p.label,
    showarrow: true,
    arrowhead: 2,
    arrowcolor: '#6B7280',
    arrowsize: 1.2,
    arrowwidth: 1,
    font: { size: 10, color: '#1F2937' },
    bgcolor: 'rgba(255, 255, 255, 0.85)',
    borderpad: 2,
    xanchor: 'center' as const,
    yanchor: 'bottom' as const,
  }));

  // ── Layout (matches VolcanoPlot component) ────────────────────────────
  const layout: Record<string, unknown> = {
    title: {
      text: 'Volcano Plot',
      font: { size: 18, color: '#111827' },
    },
    xaxis: {
      title: {
        text: `log₂(${group1Label}/${group2Label})`,
        font: { size: 14 },
      },
      zeroline: true,
      zerolinecolor: '#D1D5DB',
      zerolinewidth: 1,
      gridcolor: '#E5E7EB',
    },
    yaxis: {
      title: {
        text: '-log₁₀(p-value)',
        font: { size: 14 },
      },
      range: [0, dynamicMaxY],
      zeroline: true,
      zerolinecolor: '#D1D5DB',
      zerolinewidth: 1,
      gridcolor: '#E5E7EB',
    },
    shapes: thresholdShapes,
    annotations,
    showlegend: false,
    hovermode: 'closest',
    plot_bgcolor: '#FFFFFF',
    paper_bgcolor: '#FFFFFF',
    margin: { l: 60, r: 30, t: 50, b: 60 },
  };

  // ── DE result table ──────────────────────────────────────────────────
  const columns = [
    { key: 'master_protein_accessions', label: 'Accession' },
    { key: 'gene_name', label: 'Gene' },
    { key: 'log_fc', label: 'log₂FC' },
    { key: 'pval', label: 'p-value' },
    { key: 'adj_pval', label: 'adj. p-value' },
    { key: 'significant', label: 'Significant' },
  ];

  const rows = deResults.map((d) => ({
    master_protein_accessions: d.master_protein_accessions,
    gene_name: d.gene_name ?? '',
    log_fc: d.log_fc,
    pval: d.pval,
    adj_pval: d.adj_pval,
    significant: isSignificantVolcano(
      d.log_fc,
      d.pval,
      d.adj_pval,
      filters,
    ),
  }));

  return {
    figureSpec: { data: traces, layout },
    deTable: { columns, rows },
    markedProteins,
    comparisonLabel,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build threshold line/curve shapes matching the VolcanoPlot component.
 *
 * When s0 > 0, hyperbolic curves are generated (the S0-factor cutoff).
 * When s0 === 0, standard rectangular cutoff lines are used.
 */
function buildThresholdShapes(
  filters: VolcanoFilters,
  maxY: number,
  maxX: number,
  isEmpty: boolean,
): Array<Record<string, unknown>> {
  if (isEmpty) return [];

  const shapes: Array<Record<string, unknown>> = [];
  const actualS0 = filters.s0 * filters.foldChange;

  if (actualS0 > 0) {
    // Hyperbolic S0-factor curves:
    //   y = y0 + c / (|x| - actualS0)
    // where c = y0 * (foldChange - actualS0).
    const pLog10Threshold = -Math.log10(filters.pValue);
    const c = pLog10Threshold * (filters.foldChange - actualS0);
    const step = 0.02;

    // Right curve (positive logFC)
    let rightPath = '';
    for (let x = actualS0 + step; x <= maxX; x += step) {
      const y = pLog10Threshold + c / (x - actualS0);
      if (y <= maxY) {
        rightPath +=
          rightPath === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    }
    if (rightPath) {
      shapes.push({
        type: 'path',
        path: rightPath,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      });
    }

    // Left curve (negative logFC)
    let leftPath = '';
    for (let x = -maxX; x < -actualS0 - step; x += step) {
      const y = pLog10Threshold + c / (-x - actualS0);
      if (y <= maxY) {
        leftPath +=
          leftPath === '' ? `M ${x} ${y}` : ` L ${x} ${y}`;
      }
    }
    if (leftPath) {
      shapes.push({
        type: 'path',
        path: leftPath,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      });
    }
  } else {
    // Standard rectangular cutoff lines
    shapes.push(
      {
        type: 'line',
        x0: filters.foldChange,
        x1: filters.foldChange,
        y0: 0,
        y1: maxY,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      },
      {
        type: 'line',
        x0: -filters.foldChange,
        x1: -filters.foldChange,
        y0: 0,
        y1: maxY,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      },
    );

    const yThreshold = -Math.log10(filters.pValue);
    shapes.push({
      type: 'line',
      x0: -maxX,
      x1: maxX,
      y0: yThreshold,
      y1: yThreshold,
      line: { color: '#9CA3AF', width: 1, dash: 'dash' },
    });
  }

  return shapes;
}
