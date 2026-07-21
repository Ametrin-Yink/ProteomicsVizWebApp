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

  it('opens the session report export for PTM analyses', async () => {
    await act(async () => {
      root.render(<ExportButton sessionId="session id" pipeline="ptm" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const exportButton = container.querySelector('[data-testid="export-report-btn"]');
    expect(exportButton?.textContent).toContain('Export');
    expect(container.querySelector('[data-testid="download-ptm-results-btn"]')).toBeNull();
  });
});
