import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PTMVolcano from './PTMVolcano';

let proteinAvailable = false;

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="plot" />,
}));

vi.mock('@/components/visualization/FilterPanel', () => ({
  FilterPanel: () => <div data-testid="filters" />,
}));

vi.mock('@/components/visualization/ProteinInfo', () => ({
  default: ({ protein, comparison }: { protein: { gene_name?: string } | null; comparison?: string }) => (
    <div data-testid="shared-protein-info">{protein?.gene_name ?? 'none'}:{comparison}</div>
  ),
}));

vi.mock('@/lib/visualization-context', () => ({
  useVisualizationManifest: () => ({
    modules: [{
      id: 'volcano',
      data_scopes: proteinAvailable ? ['ptm', 'protein'] : ['ptm'],
    }],
  }),
}));

describe('PTMVolcano', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    proteinAvailable = false;
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      const response = (body: unknown) => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(body),
      } as unknown as Response);
      if (url.includes('/ptm/compare')) {
        return response({
          data: {
            comparisons: ['Drug_vs_DMSO'],
            matrix: [[1]],
            pairs: [],
            available_for_all: true,
          },
        });
      }
      if (url.includes('/ptm/results?')) {
        if (url.includes('layer=protein')) {
          return response({
            data: { comparisons: [{
              label: 'Drug_vs_DMSO',
              ptm_model: [],
              protein_model: [{
                Protein: 'P1',
                ProteinAccession: 'P1',
                Gene_Name: 'GENE1',
                PSM_Count: 2,
                log2FC: 1,
                pvalue: 0.01,
                'adj.pvalue': 0.02,
              }],
              adjusted_model: [],
            }] },
          });
        }
        return response({
          data: { comparisons: [{
            label: 'Drug_vs_DMSO',
            ptm_model: [{
              Protein: 'P1_C10',
              SiteLabel: 'P1 · C10',
              ProteinAccession: 'P1',
              Gene: 'GENE1',
              LocalizationStatus: 'Confident',
              log2FC: 5,
              pvalue: 1e-8,
              'adj.pvalue': 1e-7,
            }],
            protein_model: [],
            adjusted_model: [],
          }] },
        });
      }
      return response({ name: 'Results', markers: {}, ptm_volcano_filters: {} });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows a site-centric PTM layer and disables unavailable protein layers', async () => {
    await act(async () => {
      root.render(<PTMVolcano sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const protein = buttons.find((button) => button.textContent === 'Protein');
    const adjusted = buttons.find((button) => button.textContent === 'Protein-adjusted PTM');
    expect(container.textContent).toContain('Drug vs DMSO');
    expect(container.textContent).toContain('P1 · C10');
    expect(container.textContent).toContain('Confident');
    expect(container.textContent).toContain('1 DE (1↑ 0↓)');
    expect(container.textContent).toContain('Mark Significant in Batch');
    expect(container.textContent).toContain('Mark All Significant');
    expect(container.textContent).toContain('Download Results');
    expect(
      container.querySelector('a[download="ptm_results.zip"]')?.getAttribute('href'),
    ).toBe('/api/sessions/session-id/ptm/results/download');
    expect(container.textContent).toContain('No PTM Site Selected');
    expect(protein?.disabled).toBe(true);
    expect(adjusted?.disabled).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/ptm/results?comparison=Drug_vs_DMSO&layer=ptm'),
      expect.anything(),
    );
  });

  it('loads PTM results from a shared-report API prefix', async () => {
    await act(async () => {
      root.render(
        <PTMVolcano
          sessionId="session-id"
          apiPrefix="/api/shared-reports/share-token"
          canPersistVisualizationState={false}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/shared-reports/share-token/ptm/results?'),
      expect.anything(),
    );
    expect(
      container.querySelector('a[download="ptm_results.zip"]')?.getAttribute('href'),
    ).toBe('/api/shared-reports/share-token/ptm/results/download');
  });

  it('uses the shared protein information panel for the protein layer', async () => {
    proteinAvailable = true;
    await act(async () => {
      root.render(<PTMVolcano sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const proteinButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Protein');
    await act(async () => {
      proteinButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="shared-protein-info"]')).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('layer=protein'),
      expect.anything(),
    );
  });
});
