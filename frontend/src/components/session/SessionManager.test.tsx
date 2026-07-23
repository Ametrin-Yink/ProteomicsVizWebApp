import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/types/session';
import { SessionManager } from './SessionManager';

const setCurrentSession = vi.fn();
const loadSessions = vi.fn().mockResolvedValue(undefined);
const completedSession = {
  id: 'completed-id',
  name: 'Current completed analysis',
  pipeline: 'msstats',
  status: 'completed',
  createdAt: '2026-07-21T12:00:00Z',
  updatedAt: '2026-07-21T12:00:00Z',
  completedAt: '2026-07-21T13:00:00Z',
} as Session;
const activeSession = {
  ...completedSession,
  id: 'active-id',
  name: 'Other active analysis',
  status: 'processing',
  completedAt: null,
} as Session;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/layout/SidebarContext', () => ({
  useSidebar: () => ({ isExpanded: true }),
}));
vi.mock('@/stores/sessionStore', () => ({
  useSessions: () => [activeSession, completedSession],
  useCurrentSession: () => null,
  useSessionStore: (selector: (state: object) => unknown) => selector({
    error: null,
    setCurrentSession,
    loadSessions,
    deleteSession: vi.fn(),
    deleteSessions: vi.fn(),
    updateSession: vi.fn(),
  }),
}));
vi.mock('@/stores/ui-store', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));
vi.mock('@/lib/api-client', () => ({
  sessionsApi: { delete: vi.fn(), deleteMultiple: vi.fn(), rename: vi.fn() },
}));

describe('SessionManager', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '?session_id=completed-id');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    window.history.replaceState({}, '', '/');
    container.remove();
  });

  it('shows and selects the completed session identified by the current URL', async () => {
    await act(async () => {
      root.render(<SessionManager />);
      await Promise.resolve();
    });

    expect(setCurrentSession).toHaveBeenCalledWith(completedSession);
    expect(container.textContent).toContain('Current completed analysis');
    expect(container.textContent).not.toContain('Other active analysis');
  });
});
