/**
 * GSEA figure export builders.
 *
 * Pure functions that build Plotly figure specs for GSEA visualizations
 * (bar chart, heatmap) and pathway table data. Matches the structure produced
 * by GSEADashboard, GSEAPlot, and PathwayTable components EXACTLY.
 *
 * No React imports -- safe to use in both browser and Node (SSR/export) contexts.
 */

import type { GSEAData, GSEAResult } from '@/types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input keyed by database identifier (e.g. "go_bp", "kegg", "reactome"). */
export interface GseaInputData {
  [database: string]: GSEAData;
}

/** Per-database figure and table specs. */
export interface GseaDatabaseExport {
  barChart: { data: unknown[]; layout: Record<string, unknown> };
  heatmap: { data: unknown[]; layout: Record<string, unknown> };
  pathwayTable: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };
}

/** Return shape for the GSEA export builder. */
export interface GseaFigureExport {
  databases: string[];
  results: Record<string, GseaDatabaseExport>;
}

// ---------------------------------------------------------------------------
// Constants -- match GSEADashboard / GSEAPlot components exactly
// ---------------------------------------------------------------------------

const POSITIVE_COLOR = '#E73564';
const NEGATIVE_COLOR = '#00ADEF';
const TITLE_COLOR = '#111827';
const GRID_COLOR = '#E5E7EB';
const BG_COLOR = '#FFFFFF';

// ---------------------------------------------------------------------------
// Bar Chart -- matches GSEADashboard topPathwaysPlot exactly
// ---------------------------------------------------------------------------

function buildBarChart(data: GSEAData): GseaDatabaseExport['barChart'] {
  const results: GSEAResult[] = data.results ?? [];

  // Top 5 positive and top 5 negative NES (same logic as GSEADashboard)
  const sorted = [...results].sort((a, b) => b.nes - a.nes);
  const topPositive = sorted.slice(0, 5);
  const topNegative = sorted.slice(-5).reverse();
  const selectedPathways = [...topPositive, ...topNegative];

  const labels = selectedPathways.map(
    (p) => p.name.substring(0, 50) + (p.name.length > 50 ? '...' : ''),
  );

  const trace: Record<string, unknown> = {
    y: labels,
    x: selectedPathways.map((p) => p.nes),
    type: 'bar',
    orientation: 'h',
    marker: {
      color: selectedPathways.map((p) => (p.nes > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR)),
    },
    hovertemplate: '<b>%{y}</b><br>NES: %{x:.3f}<br>P-value: %{customdata:.2e}<extra></extra>',
    customdata: selectedPathways.map((p) => p.pval),
  };

  const layout: Record<string, unknown> = {
    title: { text: 'Top Enriched Pathways', font: { size: 14, color: TITLE_COLOR } },
    xaxis: {
      title: { text: 'Normalized Enrichment Score (NES)', font: { size: 12 } },
      zeroline: true,
      zerolinecolor: '#000',
      zerolinewidth: 1,
      gridcolor: GRID_COLOR,
    },
    yaxis: {
      automargin: true,
      tickfont: { size: 10 },
    },
    plot_bgcolor: BG_COLOR,
    paper_bgcolor: BG_COLOR,
    margin: { l: 200, r: 30, t: 50, b: 50 },
    showlegend: false,
  };

  return { data: [trace], layout };
}

// ---------------------------------------------------------------------------
// Heatmap -- enrichment landscape (top pathways x key metrics)
// Matches the GSEAPlot heatmap styling (RdBu-inspired diverging, zmid=0).
// ---------------------------------------------------------------------------

function buildHeatmap(data: GSEAData): GseaDatabaseExport['heatmap'] {
  const results: GSEAResult[] = data.results ?? [];

  // Take top pathways by |NES| (up to 20)
  const sorted = [...results].sort((a, b) => Math.abs(b.nes) - Math.abs(a.nes));
  const topPathways = sorted.slice(0, 20);

  const zValues = topPathways.map((p) => [
    p.nes,
    -Math.log10(p.pval || 1e-300),
    -Math.log10(p.fdr || 1e-300),
  ]);

  const labels = topPathways.map(
    (p) => p.name.substring(0, 45) + (p.name.length > 45 ? '...' : ''),
  );

  const trace: Record<string, unknown> = {
    z: zValues,
    x: ['NES', '-log₁₀(p-value)', '-log₁₀(FDR)'],
    y: labels,
    type: 'heatmap',
    colorscale: [
      [0, NEGATIVE_COLOR],
      [0.5, BG_COLOR],
      [1, POSITIVE_COLOR],
    ],
    zmid: 0,
    showscale: true,
    colorbar: {
      title: 'Score',
      titleside: 'right',
      thickness: 15,
      len: 0.5,
      y: 0.5,
      x: 1.02,
    },
    hovertemplate:
      'Pathway: %{y}<br>Metric: %{x}<br>Value: %{z:.3f}<extra></extra>',
  };

  const layout: Record<string, unknown> = {
    title: {
      text: 'Pathway Enrichment Landscape',
      font: { size: 14, color: TITLE_COLOR },
    },
    xaxis: {
      tickfont: { size: 10 },
      gridcolor: GRID_COLOR,
    },
    yaxis: {
      automargin: true,
      tickfont: { size: 9 },
      autorange: 'reversed',
    },
    plot_bgcolor: BG_COLOR,
    paper_bgcolor: BG_COLOR,
    margin: { l: 200, r: 60, t: 50, b: 50 },
  };

  return { data: [trace], layout };
}

// ---------------------------------------------------------------------------
// Pathway Table -- matches PathwayTable component columns/sortable headers
// ---------------------------------------------------------------------------

function buildPathwayTable(data: GSEAData): GseaDatabaseExport['pathwayTable'] {
  const results: GSEAResult[] = data.results ?? [];

  const columns = [
    { key: 'pathway', label: 'Pathway' },
    { key: 'term', label: 'Term' },
    { key: 'nes', label: 'NES' },
    { key: 'es', label: 'ES' },
    { key: 'pval', label: 'P-value' },
    { key: 'fdr', label: 'FDR' },
    { key: 'matched_genes', label: 'Gene Count' },
    { key: 'lead_genes', label: 'Leading Edge Genes' },
  ];

  const rows = results.map((r: GSEAResult) => ({
    pathway: r.name,
    term: r.term,
    nes: r.nes,
    es: r.es,
    pval: r.pval,
    fdr: r.fdr,
    matched_genes: r.matched_genes,
    lead_genes: r.lead_genes.join('; '),
  }));

  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build GSEA figure specs (bar chart, heatmap) and pathway table data for
 * all databases present in the input.
 *
 * @param gseaData  Record keyed by database identifier, each value containing
 *                  per-database GSEA enrichment results (GSEAData).
 *
 * The bar chart replicates GSEADashboard's "Top Enriched Pathways" plot
 * (horizontal bars, top 5 positive / top 5 negative NES, direction-colored).
 *
 * The heatmap shows the top-20 pathways (by |NES|) in a matrix with three
 * metrics: NES, -log10(p-value), and -log10(FDR), using a diverging
 * colorscale that mirrors the bar-chart direction colors.
 *
 * The pathway table replicates PathwayTable columns: Pathway, Term, NES, ES,
 * P-value, FDR, Gene Count, and Leading Edge Genes.
 */
export function buildGseaExport(gseaData: GseaInputData): GseaFigureExport {
  const databases = Object.keys(gseaData);
  const results: GseaFigureExport['results'] = {};

  for (const db of databases) {
    const data = gseaData[db];

    const barChart = buildBarChart(data);
    const heatmap = buildHeatmap(data);
    const pathwayTable = buildPathwayTable(data);

    results[db] = { barChart, heatmap, pathwayTable };
  }

  return { databases, results };
}
