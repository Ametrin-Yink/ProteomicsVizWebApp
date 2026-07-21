import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/reports/share-token' as string }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock('@/components/ui/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/ui/ToastProvider', () => ({
  ToastProvider: () => <div data-testid="toasts" />,
}));
vi.mock('@/components/layout/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/layout/TaskStatusBar', () => ({
  TaskStatusBar: () => <div data-testid="tasks" />,
}));
vi.mock('@/components/layout/TopNavigation', () => ({
  TopNavigation: () => <div data-testid="navigation" />,
}));

import { AppShell } from '@/components/layout/AppShell';

describe('AppShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.pathname = '/reports/share-token';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('isolates a shared report from the application navigation and task UI', () => {
    act(() => root.render(<AppShell><div>Report body</div></AppShell>));

    expect(container).toHaveTextContent('Report body');
    expect(container.querySelector('[data-testid="navigation"]')).toBeNull();
    expect(container.querySelector('[data-testid="tasks"]')).toBeNull();
  });

  it('keeps the normal shell on the report management page', () => {
    mocks.pathname = '/reports';
    act(() => root.render(<AppShell><div>Report list</div></AppShell>));

    expect(container.querySelector('[data-testid="navigation"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tasks"]')).not.toBeNull();
  });
});
