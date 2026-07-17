import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDirectory = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fileLibraryApi: { listDirectory },
}));

import { FolderTree } from '@/components/files/FolderTree';

function directory(path: string, folders: string[]) {
  return {
    path,
    entries: folders.map((name) => ({
      name,
      path: path ? `${path}/${name}` : name,
      type: 'folder',
      size: 0,
      modified_at: null,
    })),
  };
}

describe('FolderTree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listDirectory.mockReset();
    listDirectory.mockImplementation((path: string) => {
      if (path === '') return Promise.resolve(directory('', ['a']));
      if (path === 'a') return Promise.resolve(directory('a', ['b']));
      return Promise.resolve(directory(path, []));
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('expands a nested current path after root folders load', async () => {
    await act(async () => {
      root.render(
        <FolderTree
          currentPath="a/b"
          onNavigate={vi.fn()}
          onContextMenu={vi.fn()}
        />
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-path="a/b"]')).toBeInTheDocument();
    });
    expect(container.querySelector('[data-path="a"]')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});
