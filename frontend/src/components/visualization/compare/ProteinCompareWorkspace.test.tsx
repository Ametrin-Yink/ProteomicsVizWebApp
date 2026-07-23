import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProteinCompareWorkspace from './ProteinCompareWorkspace';

vi.mock('./ProteinCorrelationPanel', () => ({
  default: () => <div data-testid="protein-panel">Protein panel</div>,
}));
vi.mock('./ComparisonCorrelationPanel', () => ({
  default: () => <div data-testid="legacy-comparison-panel">Legacy comparison panel</div>,
}));
vi.mock('./ScalableComparisonCorrelationPanel', () => ({
  default: () => <div data-testid="scalable-comparison-panel">Scalable comparison panel</div>,
}));

describe('ProteinCompareWorkspace', () => {
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

  it('opens only the scalable comparison view for DIA workflows', async () => {
    await act(async () => {
      root.render(
        <ProteinCompareWorkspace
          comparisons={[
            { value: 'A_vs_B', label: 'A vs B' },
            { value: 'C_vs_B', label: 'C vs B' },
          ]}
          scalableComparison
        />,
      );
    });

    expect(container.textContent).not.toContain('Protein Correlation');
    expect(container.querySelector('[data-testid="scalable-comparison-panel"]')).not.toBeNull();
  });
});
