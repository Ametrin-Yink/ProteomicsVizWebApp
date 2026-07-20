'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  getActiveModuleId,
  getModulesForPipeline,
  getVisualizationUrl,
} from '@/config/visualization-modules';
import { SessionManager } from '@/components/session/SessionManager';
import ExportButton from '@/components/visualization/ExportButton';
import { ApiProvider } from '@/lib/api-context';
import { getDataSource, sessionApiPrefix } from '@/lib/api-client';
import { useSessionValidation } from '@/hooks/use-session-validation';

function buildTabHref(href: string, sessionId: string): string {
  const [path, qs] = href.split('?');
  const params = new URLSearchParams(qs || '');
  if (sessionId) params.set('session_id', sessionId);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

function Navigation({
  pipeline,
  hasProteinLayer,
  comparisonCount,
}: {
  pipeline: string | null;
  hasProteinLayer: boolean;
  comparisonCount: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const activeTab = pipeline === 'ptm'
    ? (searchParams.get('tab') || 'volcano')
    : getActiveModuleId(pathname);
  const modules = getModulesForPipeline(pipeline, hasProteinLayer);

  return (
    <div className="bg-background border-b border-border sticky top-0 z-10">
      <div className="mx-auto px-6">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            {modules.map((mod) => {
              const Icon = mod.icon;
              const isActive = activeTab === mod.id;
              const disabledReason = pipeline === 'ptm' && mod.id === 'compare' && comparisonCount < 2
                ? 'At least two comparisons are required'
                : null;

              if (disabledReason) {
                return (
                  <span
                    key={mod.id}
                    aria-disabled="true"
                    title={disabledReason}
                    data-testid={`${mod.id}-tab`}
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-text-muted opacity-45"
                  >
                    <Icon className="h-4 w-4" />
                    {mod.label}
                  </span>
                );
              }

              return (
                <Link
                  key={mod.id}
                  href={buildTabHref(mod.href, sessionId)}
                  data-testid={`${mod.id}-tab`}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/5 text-primary'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {mod.label}
                </Link>
              );
            })}
          </div>
          <ExportButton sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

function LayoutWithProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const apiPrefix = sessionId ? sessionApiPrefix(sessionId) : '';
  const pipelineParam = searchParams.get('pipeline');
  const [sessionContext, setSessionContext] = useState<{
    pipeline: string | null;
    hasProteinLayer: boolean;
    comparisonCount: number;
  }>({ pipeline: pipelineParam, hasProteinLayer: false, comparisonCount: 0 });

  useSessionValidation(sessionId || null);

  useEffect(() => {
    if (!apiPrefix) return;
    let cancelled = false;
    getDataSource(apiPrefix)
      .then((session) => {
        if (cancelled) return;
        setSessionContext({
          pipeline: pipelineParam || session.pipeline || null,
          hasProteinLayer: Boolean(session.files?.global_proteome?.length),
          comparisonCount: session.config?.comparisons?.length ?? 0,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSessionContext({ pipeline: pipelineParam, hasProteinLayer: false, comparisonCount: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiPrefix, pipelineParam]);

  useEffect(() => {
    if (
      sessionId &&
      sessionContext.pipeline === 'ptm' &&
      pathname === '/analysis/visualization'
    ) {
      router.replace(getVisualizationUrl(sessionId, 'ptm'));
    }
  }, [pathname, router, sessionContext.pipeline, sessionId]);

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <Navigation
        pipeline={sessionContext.pipeline}
        hasProteinLayer={sessionContext.hasProteinLayer}
        comparisonCount={sessionContext.comparisonCount}
      />
      <React.Fragment key={sessionId || 'no-session'}>
        {children}
      </React.Fragment>
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
