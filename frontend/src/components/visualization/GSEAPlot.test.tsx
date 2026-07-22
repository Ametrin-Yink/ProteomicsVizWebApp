import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GSEAPlot from './GSEAPlot';

const apiMocks = vi.hoisted(() => ({
  getGSEAPlotData: vi.fn(),
  getGSEAHeatmapData: vi.fn(),
}));

vi.mock('@/lib/api-context', () => ({ useApi: () => ({ apiPrefix: '/api/sessions/session' }) }));
vi.mock('@/lib/api-client', () => ({ visualizationApi: apiMocks }));
vi.mock('next/dynamic', () => ({
  default: () => ({ data }: { data: Array<Record<string, unknown>> }) => (
    <div data-testid="plotly" data-traces={JSON.stringify(data)} />
  ),
}));

const pathway = {
  term: 'pathway', name: 'Pathway', es: 1, nes: 2, pval: 0.01, fdr: 0.02,
  lead_genes: ['GENE1'], matched_genes: 1,
};

describe('GSEAPlot heatmap', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getGSEAPlotData.mockResolvedValue({
      term: 'pathway', es: 1, nes: 2,
      running_es_curve: [[0, 0], [1, 1]],
      rank_metric_positions: [['GENE1', 1, 2]],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('uses comparison-scoped processed log2 values as heatmap hover data', async () => {
    apiMocks.getGSEAHeatmapData.mockResolvedValue({
      genes: ['GENE1'], protein_accessions: ['P1'], samples: ['Drug_1', 'DMSO_1'],
      conditions: ['Drug', 'DMSO'], replicates: ['1', '1'],
      z_scores: [[1, -1]], log2_abundances: [[14, 10]],
    });

    await act(async () => {
      root.render(<GSEAPlot pathway={pathway} database="go_bp" comparison="Drug_vs_DMSO" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const traces = container.querySelector('[data-testid="plotly"]')?.getAttribute('data-traces') || '';
    expect(traces).toContain('Processed log2 abundance');
    expect(traces).toContain('14');
    expect(traces).toContain('Drug');
  });

  it('shows an explanatory state when leading genes cannot be mapped', async () => {
    apiMocks.getGSEAHeatmapData.mockResolvedValue({
      genes: [], protein_accessions: [], samples: [], conditions: [], replicates: [],
      z_scores: [], log2_abundances: [],
    });

    await act(async () => {
      root.render(<GSEAPlot pathway={pathway} database="go_bp" comparison="Drug_vs_DMSO" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="gsea-heatmap-empty"]')?.textContent)
      .toContain('No leading-edge genes');
  });
});
