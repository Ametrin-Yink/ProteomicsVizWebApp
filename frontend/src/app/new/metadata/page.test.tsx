import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    addToast: vi.fn(),
    push,
    replace,
    router: { push, replace },
    search: '',
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/stores/ui-store', () => ({
  useUIStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));
vi.mock('@/hooks/use-session-validation', () => ({
  useSessionValidation: vi.fn(),
}));
vi.mock('@/hooks/use-auto-save', () => ({
  useAutoSave: () => ({ saveError: null }),
}));
vi.mock('@/hooks/use-beforeunload', () => ({
  useBeforeUnload: () => ({ dismiss: vi.fn() }),
}));
vi.mock('@/components/analysis/TmtChannelMapping', () => ({
  default: () => null,
}));
vi.mock('@/components/analysis/DiaMetadataTable', () => ({
  default: () => null,
}));
vi.mock('@/components/files/FileLibraryPicker', () => ({
  FileLibraryPicker: () => null,
}));

import MetadataPage from '@/app/new/metadata/page';
import { useAnalysisStore } from '@/stores/analysis-store';

describe('metadata route validation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    useAnalysisStore.getState().reset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('redirects instead of remaining in the restoring state without a session', async () => {
    await act(async () => {
      root.render(<MetadataPage />);
      await Promise.resolve();
    });

    expect(mocks.push).toHaveBeenCalledWith('/');
    expect(mocks.addToast).toHaveBeenCalledWith(
      'error',
      'No session found. Please start a new analysis.'
    );
  });

  it('restores the complete PTM configuration after the page resets local state', async () => {
    mocks.search = 'session=session-id';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        pipeline: 'ptm',
        config: {
          file_type: 'tmt',
          ptm_target_modification: 'DBIA',
          ptm_fasta_source: 'human',
          ptm_normalization_method: 'centered_median',
          ptm_background_normalization: false,
          ptm_imputation: false,
          resolve_shared_peptides: false,
          tmt_channel_mapping: {
            'ptm.txt::126': { condition: 'Drug', replicate: 1, role: 'Sample' },
            'ptm.txt::127': { condition: 'DMSO', replicate: 1, role: 'Sample' },
          },
        },
        files: {
          proteomics: [],
          ptm_enrichment: [{
            filename: 'ptm.txt',
            size: 100,
            columns: [],
            tmt_channels: ['126', '127'],
          }],
        },
      }),
    });

    await act(async () => {
      root.render(<MetadataPage />);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const state = useAnalysisStore.getState();
    expect(state.analysisType).toBe('ptm');
    expect(state.config.ptm_target_modification).toBe('DBIA');
    expect(state.config.ptm_normalization_method).toBe('centered_median');
    expect(state.config.ptm_imputation).toBe(false);
    expect(state.config.resolve_shared_peptides).toBe(false);
  });
});
