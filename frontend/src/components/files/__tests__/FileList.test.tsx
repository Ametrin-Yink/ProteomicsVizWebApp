import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileList } from '@/components/files/FileList';
import type { FileLibraryEntry } from '@/lib/api-client';

const defaultProps = {
  currentPath: '',
  selectedPaths: new Set<string>(),
  onToggleSelect: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  onNavigate: vi.fn(),
  onContextMenu: vi.fn(),
  sortBy: null,
  sortOrder: 'asc' as const,
  onSort: vi.fn(),
  filterType: 'all' as const,
};

describe('FileList search feedback', () => {
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

  it('shows a search-specific empty state and announces the result count', () => {
    act(() => root.render(<FileList {...defaultProps} entries={[]} searchQuery="missing" />));

    expect(container).toHaveTextContent('No files match “missing”.');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('0 results for ‘missing’');
  });

  it('highlights matching filename text', () => {
    const entry: FileLibraryEntry = {
      name: 'tmt_sample.txt',
      path: 'tmt_sample.txt',
      type: 'txt',
      size: 10,
      modified_at: null,
    };

    act(() => root.render(<FileList {...defaultProps} entries={[entry]} searchQuery="sample" />));

    expect(container.querySelector('mark')).toHaveTextContent('sample');
    expect(container.querySelector('tr[tabindex="0"]')).toBeInTheDocument();
    expect(container.querySelector('input[aria-label="Select tmt_sample.txt"]')).toBeInTheDocument();
  });
});
