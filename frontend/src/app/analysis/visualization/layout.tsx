'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SessionManager } from '@/components/session/SessionManager';
import { VisualizationModuleBoundary } from '@/components/visualization/VisualizationModuleBoundary';
import { VisualizationNavigation } from '@/components/visualization/VisualizationNavigation';
import { ApiProvider } from '@/lib/api-context';
import { sessionApiPrefix, visualizationApi } from '@/lib/api-client';
import { useSessionValidation } from '@/hooks/use-session-validation';
import {
  VisualizationManifestProvider,
  type VisualizationManifestState,
} from '@/lib/visualization-context';

function LayoutWithProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const apiPrefix = sessionId ? sessionApiPrefix(sessionId) : '';
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${apiPrefix}:${retryKey}`;
  const [loadedState, setLoadedState] = useState<{
    requestKey: string;
    state: VisualizationManifestState;
  }>({ requestKey: '', state: { status: 'idle' } });
  const state: VisualizationManifestState = !apiPrefix
    ? { status: 'idle' }
    : loadedState.requestKey === requestKey
      ? loadedState.state
      : { status: 'loading' };

  useSessionValidation(sessionId || null);

  useEffect(() => {
    if (!apiPrefix) return;
    const controller = new AbortController();
    visualizationApi.getManifest(apiPrefix, controller.signal)
      .then((nextManifest) => {
        setLoadedState({
          requestKey,
          state: { status: 'ready', manifest: nextManifest },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setLoadedState({
          requestKey,
          state: {
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to load visualization capabilities.',
          },
        });
      });
    return () => controller.abort();
  }, [apiPrefix, requestKey]);

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <VisualizationManifestProvider state={state}>
        {state.status === 'ready' && (
          <VisualizationNavigation manifest={state.manifest} sessionId={sessionId} />
        )}
        <VisualizationModuleBoundary
          state={state}
          pathname={pathname}
          sessionId={sessionId}
          onRetry={() => setRetryKey((current) => current + 1)}
        >
          <React.Fragment key={sessionId || 'no-session'}>
            {children}
          </React.Fragment>
        </VisualizationModuleBoundary>
      </VisualizationManifestProvider>
    </ApiProvider>
  );
}

export default function VisualizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface flex">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Navigation + Content */}
        <Suspense fallback={<div className="bg-background border-b border-border h-14" />}>
          <LayoutWithProvider>
            {children}
          </LayoutWithProvider>
        </Suspense>
      </div>
    </div>
  );
}
