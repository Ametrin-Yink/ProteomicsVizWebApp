import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
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

describe('metadata route validation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
