import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileLibraryPage } from '@/components/files/FileLibraryPage';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  listDirectory: vi.fn(),
  scan: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fileLibraryApi: {
    createFolder: vi.fn(),
    delete: vi.fn(),
    listDirectory: mocks.listDirectory,
    rename: vi.fn(),
    scan: mocks.scan,
    upload: vi.fn(),
  },
}));

vi.mock('@/stores/ui-store', () => ({
  useUIStore: (selector: (state: { addToast: typeof mocks.addToast }) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

describe('FileLibraryPage empty state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.listDirectory.mockResolvedValue({ path: '', entries: [] });
    mocks.scan.mockResolvedValue({ total: 0 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('keeps the upload control available when the root library is empty', async () => {
    await act(async () => {
      root.render(<FileLibraryPage />);
    });

    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(mocks.listDirectory).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(container.querySelector('[data-testid="files-page"]')).toBeInTheDocument();
    expect(container.querySelector('button[aria-label="Upload files"]')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"][multiple]')).toBeInTheDocument();
  });
});
