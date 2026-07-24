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

  it('shows protein correlation tab alongside scalable comparison for DIA workflows', async () => {
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

    // Both tabs should be visible
    expect(container.textContent).toContain('Protein Correlation');
    expect(container.textContent).toContain('Comparison Correlation');
    // Default to comparison tab when scalableComparison is true
    expect(container.querySelector('[data-testid="scalable-comparison-panel"]')).not.toBeNull();
  });

  it('shows protein correlation panel when protein tab is clicked', async () => {
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

    // Click the Protein Correlation tab
    const proteinTab = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Protein Correlation',
    );
    expect(proteinTab).not.toBeUndefined();

    await act(async () => {
      proteinTab!.click();
    });

    // Protein panel should now be visible instead of scalable panel
    expect(container.querySelector('[data-testid="protein-panel"]')).not.toBeNull();
  });

  it('disables comparison correlation tab when fewer than 2 comparisons', async () => {
    await act(async () => {
      root.render(
        <ProteinCompareWorkspace
          comparisons={[{ value: 'A_vs_B', label: 'A vs B' }]}
          scalableComparison
        />,
      );
    });

    const comparisonTab = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent === 'Comparison Correlation',
    );
    expect(comparisonTab).not.toBeUndefined();
    expect((comparisonTab as HTMLButtonElement).disabled).toBe(true);
  });
});
