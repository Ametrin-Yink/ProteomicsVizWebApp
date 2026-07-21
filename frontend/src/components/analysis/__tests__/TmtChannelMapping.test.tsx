import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TmtChannelMapping from '@/components/analysis/TmtChannelMapping';
import { useAnalysisStore } from '@/stores/analysis-store';
import type { UploadedFileInfo } from '@/types';

vi.mock('@/stores/ui-store', () => ({
  useUIStore: (selector: (state: { addToast: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const file: UploadedFileInfo = {
  filename: 'tmt.txt',
  size: 100,
  experiment: 'experiment',
  replicate: 0,
  batch: '',
  file_type: 'tmt',
  tmt_channels: ['126', '127N'],
};

describe('TmtChannelMapping column management', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAnalysisStore.getState().reset();
    useAnalysisStore.getState().setConfig({
      tmt_channel_mapping: {
        'tmt.txt::126': { 'Sample Name': 'sample-1', Treatment: 'Drug', replicate: 1 },
        'tmt.txt::127N': { 'Sample Name': 'sample-2', Treatment: 'Control', replicate: 1 },
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('removes an imported column from every channel without deleting other metadata', () => {
    act(() => root.render(<TmtChannelMapping file={file} />));

    const removeButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label='Remove column "Sample Name"']`
    );
    expect(removeButton).toBeInTheDocument();

    act(() => removeButton!.click());

    const mapping = useAnalysisStore.getState().config.tmt_channel_mapping!;
    expect(mapping['tmt.txt::126']).toEqual({ Treatment: 'Drug', replicate: 1 });
    expect(mapping['tmt.txt::127N']).toEqual({ Treatment: 'Control', replicate: 1 });
  });
});
