import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ReprocessButton from './ReprocessButton';

const push = vi.fn();
const reprocess = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api-client', () => ({
  processingApi: { reprocess: (...args: unknown[]) => reprocess(...args) },
}));

describe('ReprocessButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    push.mockReset();
    reprocess.mockReset();
    reprocess.mockResolvedValue({ status: 'started' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('warns about replacement and report-link consequences before starting', async () => {
    act(() => root.render(<ReprocessButton sessionId="session-1" />));
    act(() => (container.querySelector('[data-testid="reprocess-btn"]') as HTMLButtonElement).click());

    expect(container.textContent).toContain('permanently replaces');
    expect(container.textContent).toContain('Existing report links keep the same URL');

    const confirm = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reprocess and Replace Results')
    );
    await act(async () => confirm?.click());

    expect(reprocess).toHaveBeenCalledWith('session-1');
    expect(push).toHaveBeenCalledWith('/analysis/processing?session_id=session-1&reprocess=1');
  });
});
