'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { SidebarProvider } from '@/components/layout/SidebarContext';
import { TaskStatusBar } from '@/components/layout/TaskStatusBar';
import { TopNavigation } from '@/components/layout/TopNavigation';

function isSharedReportPath(pathname: string): boolean {
  return /^\/reports\/[^/]+\/?$/.test(pathname);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isSharedReportPath(pathname)) {
    return (
      <>
        <main id="main-content" className="h-screen bg-surface">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <ToastProvider />
      </>
    );
  }

  return (
    <SidebarProvider>
      <TopNavigation />
      <div id="main-content" className="flex h-screen pt-14">
        <ErrorBoundary>{children}</ErrorBoundary>
      </div>
      <TaskStatusBar />
      <ToastProvider />
    </SidebarProvider>
  );
}
