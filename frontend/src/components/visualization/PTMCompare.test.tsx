import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PTMCompare from './PTMCompare';

vi.mock('@/components/visualization/compare/SimilarityMatrix', () => ({
  default: ({ title }: { title: string }) => <div data-testid="matrix">{title}</div>,
}));

vi.mock('@/components/visualization/compare/ProteinCompareWorkspace', () => ({
  default: ({ comparisons }: { comparisons: Array<{ label: string }> }) => (
    <div data-testid="protein-workspace">
      Protein Correlation / Comparison Correlation / {comparisons.length} comparisons
    </div>
  ),
}));

function mockSummaries({
  comparisons,
  matched = 2,
  correlation = 1,
  protein = false,
  adjusted = false,
}: {
  comparisons: string[];
  matched?: number;
  correlation?: number | null;
  protein?: boolean;
  adjusted?: boolean;
}) {
  global.fetch = vi.fn(async (input) => {
    const url = String(input);
    const layer = new URL(url, 'http://localhost').searchParams.get('layer');
    const available = layer === 'ptm'
      || (layer === 'protein' && protein)
      || (layer === 'adjusted' && adjusted);
    const pairs = comparisons.length < 2 ? [] : [{
      left: comparisons[0],
      right: comparisons[1],
      matched,
      correlation,
    }];
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({
        data: {
          comparisons,
          matrix: comparisons.length < 2 ? [[1]] : [[1, correlation], [correlation, 1]],
          pairs,
          available_for_all: available,
        },
      }),
    } as unknown as Response;
  });
}

describe('PTMCompare', () => {
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

  it('requires two comparisons', async () => {
    mockSummaries({ comparisons: ['Drug_vs_DMSO'] });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('At least two comparisons are required');
  });

  it('compares matched PTM features across comparisons', async () => {
    mockSummaries({ comparisons: ['A_vs_Control', 'B_vs_Control'] });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('PTM Comparison Correlation');
    expect(container.textContent).toContain('Matched-feature evidence');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('1.000');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('uses the standard protein Compare workspace for the optional protein layer', async () => {
    mockSummaries({
      comparisons: ['A_vs_Control', 'B_vs_Control'],
      protein: true,
      adjusted: true,
    });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const proteinButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Protein');
    expect(proteinButton?.disabled).toBe(false);
    await act(async () => proteinButton?.click());

    expect(container.querySelector('[data-testid="protein-workspace"]')).not.toBeNull();
    expect(container.textContent).toContain('Protein Correlation / Comparison Correlation / 2 comparisons');
  });

  it('reports undefined correlation when fewer than two sites are shared', async () => {
    mockSummaries({
      comparisons: ['A_vs_Control', 'B_vs_Control'],
      matched: 1,
      correlation: null,
    });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('N/A');
    expect(container.textContent).not.toContain('0.000');
  });
});
