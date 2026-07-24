import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import QCWorkspace from './QCWorkspace';

// Track QCPlots mock props for perSampleData forwarding assertions
let mockQCPlotsProps: Record<string, unknown> = {};
vi.mock('@/components/visualization/QCPlots', () => ({
  default: (props: Record<string, unknown>) => {
    // Store all props for test assertions
    Object.assign(mockQCPlotsProps, props);
    return (
      <div data-testid="selected-comparison">{props.selectedComparison as string}</div>
    );
  },
}));

describe('QCWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockQCPlotsProps = {};
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

  it('forwards perSampleData to the QCPlots component', async () => {
    const perSampleData = {
      psm_intensity: [{ condition: 'Drug', replicate: 'R1', result_layer: 'protein', sample_count: 3, q1: 4, median: 5, q3: 6 }],
      protein_intensity: [{ sample_id: 'Drug_1', condition: 'Drug', abundance_q1: 4, abundance_median: 5, abundance_q3: 6 }],
      protein_completeness: [{ sample_id: 'Drug_1', condition: 'Drug', total: 100, present: 80, missing: 20 }],
      psm_completeness: [{ sample_id: 'Drug_1', condition: 'Drug', total: 500, present: 400, missing: 100 }],
    };

    await act(async () => {
      root.render(
        <QCWorkspace
          data={{ total_psms: 20, avg_psms_per_sample: 10 }}
          labels={{ psm: 'PSM', entity: 'Protein', entityPlural: 'Proteins' }}
          selectedComparison="Drug_vs_DMSO"
          onComparisonChange={() => undefined}
          comparisonOptions={[{ value: 'Drug_vs_DMSO', label: 'Drug vs DMSO' }]}
          perSampleData={perSampleData}
        />,
      );
    });

    expect(mockQCPlotsProps.perSampleData).toEqual(perSampleData);
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
