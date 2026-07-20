import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PTMVolcano from './PTMVolcano';

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="plot" />,
}));

vi.mock('@/components/visualization/FilterPanel', () => ({
  FilterPanel: () => <div data-testid="filters" />,
}));

describe('PTMVolcano', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    expect(container.textContent).toContain('Export All');
    expect(container.textContent).toContain('No PTM Site Selected');
    expect(protein?.disabled).toBe(true);
    expect(adjusted?.disabled).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/ptm/results?comparison=Drug_vs_DMSO&layer=ptm'),
      expect.anything(),
    );
  });
});
