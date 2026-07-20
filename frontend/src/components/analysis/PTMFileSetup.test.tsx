import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PTMFileSetup from './PTMFileSetup';
import { useAnalysisStore } from '@/stores/analysis-store';

const addToast = vi.fn();

vi.mock('@/stores/ui-store', () => ({
  useUIStore: (selector: (state: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}));

vi.mock('@/components/files/FileLibraryPicker', () => ({
  FileLibraryPicker: () => <div data-testid="library-picker" />,
}));

describe('PTMFileSetup', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    useAnalysisStore.getState().reset();
    useAnalysisStore.getState().setAnalysisType('ptm');
    useAnalysisStore.getState().setConfig({
      ptm_target_modification: 'DBIA',
      ptm_fasta_source: 'human',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        files: {
          ptm_enrichment: [{
            filename: 'ptm.txt',
            size: 1000,
            columns: [],
            tmt_channels: ['126', '127'],
            detected_modifications: [
              { name: 'DBIA', row_count: 10, occurrence_count: 10, sites: ['C2'] },
              { name: 'TMT6plex', row_count: 10, occurrence_count: 20, sites: ['N-Term'] },
            ],
          }],
          global_proteome: [],
          fasta: [],
        },
      }),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses library-selected TMT data and reports a complete setup', async () => {
    const onReadyChange = vi.fn();
    await act(async () => {
      root.render(<PTMFileSetup sessionId="session-id" onReadyChange={onReadyChange} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain('ptm.txt');
    expect(container.textContent).toContain('DBIA');
    expect(container.textContent).toContain('Protein and protein-adjusted volcano tabs will remain disabled.');
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(useAnalysisStore.getState().config.file_type).toBe('tmt');
    expect(useAnalysisStore.getState().config.resolve_shared_peptides).toBe(true);
  });

  it('clears a target modification that is absent from a replacement file', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        files: {
          ptm_enrichment: [{
            filename: 'replacement.txt',
            size: 1000,
            columns: [],
            tmt_channels: ['126', '127'],
            detected_modifications: [
              { name: 'Oxidation', row_count: 5, occurrence_count: 5, sites: ['M2'] },
            ],
          }],
          global_proteome: [],
          fasta: [],
        },
      }),
    });
    const onReadyChange = vi.fn();

    await act(async () => {
      root.render(<PTMFileSetup sessionId="session-id" onReadyChange={onReadyChange} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(useAnalysisStore.getState().config.ptm_target_modification).toBeUndefined();
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
  });
});
