import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExportButton from './ExportButton';

describe('ExportButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ state: 'completed', name: 'PTM session' }),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('downloads the generated PTM archive instead of opening protein reports', async () => {
    await act(async () => {
      root.render(<ExportButton sessionId="session id" pipeline="ptm" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const download = container.querySelector('[data-testid="download-ptm-results-btn"]');
    expect(download?.textContent).toContain('Download Results');
    expect(download?.getAttribute('href')).toBe('/api/sessions/session%20id/ptm/results/download');
    expect(container.querySelector('[data-testid="export-report-btn"]')).toBeNull();
  });
});
