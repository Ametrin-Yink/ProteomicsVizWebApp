import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PTMQCWorkspace from './PTMQCWorkspace';

vi.mock('@/components/visualization/QCPlots', () => ({
  default: ({ labels }: { labels: { psm: string; entity: string } }) => (
    <div data-testid="qc-plots">{labels.psm} plots Â· {labels.entity} plots</div>
  ),
}));

describe('PTMQCWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {
        preprocessing: {
          passing_site_count: 100,
          localization: { Confident: 90, Ambiguous: 9, Unscored: 1 },
          normalization: { method: 'centered_median', applied: true, complete_feature_count: 80 },
          quantified_protein_count: 50,
        },
        results: { protein_layer_available: true },
        plots: {
          pca: { samples: ['Drug_1', 'DMSO_1'], pc1: [1, -1], pc2: [0, 0], conditions: ['Drug', 'DMSO'], pc1_variance: 80, pc2_variance: 20 },
          pvalue_distributions: { Drug_vs_DMSO: { bins: [0, 1], counts: [100] } },
          total_psms: 200,
          avg_psms_per_sample: 100,
          total_proteins: 100,
          avg_proteins_per_sample: 95,
          average_protein_cv: 12.3,
          average_psm_cv: 15.4,
        },
        protein_plots: {
          pca: { samples: ['Drug_1', 'DMSO_1'], pc1: [1, -1], pc2: [0, 0], conditions: ['Drug', 'DMSO'], pc1_variance: 70, pc2_variance: 30 },
          pvalue_distributions: { Drug_vs_DMSO: { bins: [0, 1], counts: [50] } },
          total_psms: 150,
          avg_psms_per_sample: 75,
          total_proteins: 50,
          avg_proteins_per_sample: 45,
          average_protein_cv: 10.1,
          average_psm_cv: 13.2,
        },
      } }),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('switches the shared QC summary and plots between PTM and protein levels', async () => {
    await act(async () => {
      root.render(<PTMQCWorkspace sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('QC Summary Statistics');
    expect(container.textContent).toContain('Total Unique PTM PSMs');
    expect(container.textContent).toContain('Avg PTM Site CV');
    expect(container.textContent).toContain('PTM PSM plots Â· PTM Site plots');

    const proteinButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Protein');
    expect(proteinButton?.disabled).toBe(false);
    await act(async () => proteinButton?.click());

    expect(container.textContent).toContain('Total Unique Protein PSMs');
    expect(container.textContent).toContain('Avg Protein CV');
    expect(container.textContent).toContain('Protein PSM plots Â· Protein plots');
  });

  it('keeps protein QC visible but disabled without a protein matrix', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {
        preprocessing: {},
        results: { protein_layer_available: false },
        plots: { total_psms: 1, total_proteins: 1 },
      } }),
    });

    await act(async () => {
      root.render(<PTMQCWorkspace sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const proteinButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Protein');
    expect(proteinButton?.disabled).toBe(true);
  });
});
