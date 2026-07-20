'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SessionManager } from '@/components/session/SessionManager';
import { VisualizationNavigation } from '@/components/visualization/VisualizationNavigation';
import { ApiProvider } from '@/lib/api-context';
import { sessionApiPrefix, visualizationApi } from '@/lib/api-client';
import { useSessionValidation } from '@/hooks/use-session-validation';
import type { VisualizationManifest } from '@/types/api';
import { VisualizationManifestProvider } from '@/lib/visualization-context';

function LayoutWithProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const apiPrefix = sessionId ? sessionApiPrefix(sessionId) : '';
  const [loadedManifest, setLoadedManifest] = useState<{
    apiPrefix: string;
    manifest: VisualizationManifest;
  } | null>(null);
  const manifest = loadedManifest?.apiPrefix === apiPrefix
    ? loadedManifest.manifest
    : null;

  useSessionValidation(sessionId || null);

  useEffect(() => {
    if (!apiPrefix) return;
    const controller = new AbortController();
    visualizationApi.getManifest(apiPrefix, controller.signal)
      .then((nextManifest) => {
        setLoadedManifest({ apiPrefix, manifest: nextManifest });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadedManifest(null);
        }
      });
    return () => controller.abort();
  }, [apiPrefix]);

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <VisualizationManifestProvider manifest={manifest}>
        {manifest && (
          <VisualizationNavigation manifest={manifest} sessionId={sessionId} />
        )}
        <React.Fragment key={sessionId || 'no-session'}>
          {children}
        </React.Fragment>
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
