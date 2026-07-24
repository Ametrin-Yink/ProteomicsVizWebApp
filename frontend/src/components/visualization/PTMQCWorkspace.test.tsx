import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PTMQCWorkspace from './PTMQCWorkspace';
import { visualizationApi } from '@/lib/api-client';

vi.mock('@/components/visualization/QCPlots', () => ({
  default: ({ labels }: { labels: { psm: string; entity: string } }) => (
    <div data-testid="qc-plots">{labels.psm} plots Â· {labels.entity} plots</div>
  ),
}));

/** Helper: minimal fetch mock response for valid JSON API responses. */
function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

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

    expect(container.textContent).toContain('Analysis Summary');
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

  it('loads QC data from a shared-report API prefix', async () => {
    await act(async () => {
      root.render(
        <PTMQCWorkspace
          sessionId="session-id"
          apiPrefix="/api/shared-reports/share-token"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/shared-reports/share-token/ptm/qc/plots',
      expect.anything(),
    );
  });

  it('calls getPTMQCPlots, getQCOverview, and getQCPerSample with the correct URL patterns', async () => {
    // We import the real visualizationApi to verify URL construction.
    // Each function uses fetchApi → global.fetch internally.
    // The global.fetch mock from beforeEach returns a generic success response.

    // getPTMQCPlots: /{apiPrefix}/ptm/qc/plots
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({}),
    );
    await visualizationApi.getPTMQCPlots('/api/sessions/session-id');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session-id/ptm/qc/plots',
      expect.anything(),
    );

    // getQCOverview: /{apiPrefix}/visualization/qc/overview?group_by=...
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({}),
    );
    await visualizationApi.getQCOverview('/api/sessions/session-id', 'condition');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session-id/visualization/qc/overview?group_by=condition&limit=50',
      expect.anything(),
    );

    // getQCPerSample: /{apiPrefix}/visualization/qc/per-sample?result_layer=...
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({}),
    );
    await visualizationApi.getQCPerSample('/api/sessions/session-id', 'protein');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/sessions/session-id/visualization/qc/per-sample?result_layer=protein',
      expect.anything(),
    );
  });
});
