import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileSearch } from '@/hooks/use-file-search';

const entries = [
  { name: 'alpha.csv', path: '/alpha.csv', type: 'csv' },
  { name: 'beta.csv', path: '/beta.csv', type: 'csv' },
];

function HookHarness({
  capture,
}: {
  capture: (value: ReturnType<typeof useFileSearch<(typeof entries)[number]>>) => void;
}) {
  capture(useFileSearch({ entries }));
  return null;
}

describe('useFileSearch', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useFileSearch<(typeof entries)[number]>>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<HookHarness capture={(value) => { latest = value; }} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('does not restore a pending search after the query is cleared', () => {
    act(() => {
      latest.handleSearchChange({
        target: { value: 'alpha' },
      } as React.ChangeEvent<HTMLInputElement>);
      latest.setSearchQuery('');
      vi.advanceTimersByTime(300);
    });

    expect(latest.searchQuery).toBe('');
    expect(latest.filteredEntries).toEqual(entries);
  });
});
