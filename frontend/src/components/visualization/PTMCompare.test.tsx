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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { comparisons: [{
        label: 'Drug_vs_DMSO', ptm_model: [], protein_model: [], adjusted_model: [],
      }] } }),
    });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('At least two comparisons are required');
  });

  it('compares matched PTM features across comparisons', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { comparisons: [
        {
          label: 'A_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 1 }, { Protein: 'P2_C20', log2FC: -1 }],
          protein_model: [],
          adjusted_model: [],
        },
        {
          label: 'B_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 2 }, { Protein: 'P2_C20', log2FC: -2 }],
          protein_model: [],
          adjusted_model: [],
        },
      ] } }),
    });

    await act(async () => {
      root.render(<PTMCompare sessionId="session-id" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('PTM Comparison Correlation');
    expect(container.textContent).toContain('Matched-feature evidence');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('1.000');
  });

  it('uses the standard protein Compare workspace for the optional protein layer', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { comparisons: [
        {
          label: 'A_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 1 }],
          protein_model: [{ Protein: 'P1', log2FC: 0.5 }],
          adjusted_model: [{ Protein: 'P1_C10', log2FC: 0.5 }],
        },
        {
          label: 'B_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 2 }],
          protein_model: [{ Protein: 'P1', log2FC: 1 }],
          adjusted_model: [{ Protein: 'P1_C10', log2FC: 1 }],
        },
      ] } }),
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { comparisons: [
        {
          label: 'A_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 1 }],
          protein_model: [],
          adjusted_model: [],
        },
        {
          label: 'B_vs_Control',
          ptm_model: [{ Protein: 'P1_C10', log2FC: 2 }],
          protein_model: [],
          adjusted_model: [],
        },
      ] } }),
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
