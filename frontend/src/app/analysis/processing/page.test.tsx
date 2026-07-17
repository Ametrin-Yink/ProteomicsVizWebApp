import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cancel: vi.fn(),
  getLogs: vi.fn(),
  getStatus: vi.fn(),
  retryApi: vi.fn(),
  resetStore: vi.fn(),
  initializeSteps: vi.fn(),
  setSessionId: vi.fn(),
  setFirstStepProcessing: vi.fn(),
  setCancelled: vi.fn(),
  setLogs: vi.fn(),
  setComplete: vi.fn(),
  setQueued: vi.fn(),
  clearQueued: vi.fn(),
  syncStepProgress: vi.fn(),
  retryStore: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(
    'session_id=session-1&pipeline=msqrob2'
  ),
}));

vi.mock('@/lib/api-client', () => ({
  processingApi: {
    cancel: mocks.cancel,
    getLogs: mocks.getLogs,
    getStatus: mocks.getStatus,
    retry: mocks.retryApi,
  },
}));

vi.mock('@/stores/processing-store', () => ({
  useProcessingStore: () => ({
    logs: [],
    isConnected: false,
    isComplete: false,
    isCancelled: false,
    isQueued: false,
    queuePosition: 0,
    queueLength: 0,
    error: null,
    processingDuration: null,
    sessionId: 'session-1',
    steps: [],
    initializeSteps: mocks.initializeSteps,
    setSessionId: mocks.setSessionId,
    setFirstStepProcessing: mocks.setFirstStepProcessing,
    setCancelled: mocks.setCancelled,
    setLogs: mocks.setLogs,
    setComplete: mocks.setComplete,
    setQueued: mocks.setQueued,
    clearQueued: mocks.clearQueued,
    syncStepProgress: mocks.syncStepProgress,
    retry: mocks.retryStore,
    reset: mocks.resetStore,
  }),
}));

vi.mock('@/hooks/use-websocket', () => ({ useWebSocket: vi.fn() }));
vi.mock('@/hooks/use-session-validation', () => ({
  useSessionValidation: vi.fn(),
}));
vi.mock('@/components/session/SessionManager', () => ({
  SessionManager: () => null,
}));
vi.mock('@/components/processing/LogPanel', () => ({ LogPanel: () => null }));

import { ProcessingContent } from '@/app/analysis/processing/page';

describe('processing recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLogs.mockResolvedValue({
      logs: [],
      completed_steps: [],
      current_step: 0,
      is_complete: false,
      outputs: null,
    });
    mocks.getStatus.mockResolvedValue({ state: 'processing' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lets the user leave when the cancellation request fails', async () => {
    mocks.cancel.mockRejectedValue(new Error('backend unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      root.render(<ProcessingContent />);
    });

    act(() => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="cancel-processing-btn"]'
      )!.click();
    });
    expect(
      container.querySelector('[data-testid="cancel-confirm-dialog"]')
    ).toBeInTheDocument();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-cancel-btn"]'
      )!.click();
    });

    expect(mocks.cancel).toHaveBeenCalledWith('session-1');
    expect(mocks.push).toHaveBeenCalledWith('/analysis');
    consoleError.mockRestore();
  });
});
