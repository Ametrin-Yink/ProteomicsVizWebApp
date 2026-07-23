import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QCWorkspace from './QCWorkspace';

vi.mock('@/components/visualization/QCPlots', () => ({
  default: ({ selectedComparison }: { selectedComparison: string }) => (
    <div data-testid="selected-comparison">{selectedComparison}</div>
  ),
}));

describe('QCWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('selects the first available comparison instead of showing an empty selector', async () => {
    const onComparisonChange = vi.fn();

    await act(async () => {
      root.render(
        <QCWorkspace
          data={{ total_psms: 20, avg_psms_per_sample: 10 }}
          labels={{ psm: 'PSM', entity: 'Protein', entityPlural: 'Proteins' }}
          selectedComparison=""
          onComparisonChange={onComparisonChange}
          comparisonOptions={[{ value: 'Drug_vs_DMSO', label: 'Drug vs DMSO' }]}
        />,
      );
      await Promise.resolve();
    });

    expect(onComparisonChange).toHaveBeenCalledWith('Drug_vs_DMSO');
    expect(container.querySelector('[data-testid="selected-comparison"]')?.textContent)
      .toBe('Drug_vs_DMSO');
  });

  it('labels averages as detected features per sample', async () => {
    await act(async () => {
      root.render(
        <QCWorkspace
          data={{ total_psms: 20, avg_psms_per_sample: 20, total_proteins: 10, avg_proteins_per_sample: 10 }}
          labels={{ psm: 'PSM', entity: 'Protein', entityPlural: 'Proteins' }}
          selectedComparison="Drug_vs_DMSO"
          onComparisonChange={() => undefined}
          comparisonOptions={[{ value: 'Drug_vs_DMSO', label: 'Drug vs DMSO' }]}
        />,
      );
    });

    expect(container.textContent).toContain('Avg Detected PSMs/Sample');
    expect(container.textContent).toContain('Avg Detected Proteins/Sample');
  });
});
