'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { getActiveModuleId, getVisualizationUrl } from '@/config/visualization-modules';
import type { VisualizationManifestState } from '@/lib/visualization-context';

export function VisualizationModuleBoundary({
  state,
  pathname,
  sessionId,
  onRetry,
  children,
}: {
  state: VisualizationManifestState;
  pathname: string;
  sessionId: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (!sessionId || state.status === 'idle') return children;

  if (state.status === 'loading') {
    return <div data-testid="visualization-manifest-loading" className="m-8 h-96 animate-pulse rounded-lg bg-border/30" />;
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center p-8" data-testid="visualization-manifest-error">
        <div className="max-w-md rounded-lg border border-error/20 bg-error/5 p-6 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-error" />
          <h2 className="font-semibold text-error">Unable to load visualization</h2>
          <p className="mt-2 text-sm text-error/80">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const moduleId = getActiveModuleId(pathname);
  const capability = state.manifest.modules.find((module) => module.id === moduleId);
  if (!capability?.visible || !capability.enabled) {
    const reason = capability?.disabled_reason
      || 'This visualization is not available for the selected session.';
    return (
      <div className="flex flex-1 items-center justify-center p-8" data-testid="visualization-module-unavailable">
        <div className="max-w-md rounded-lg border border-border bg-background p-8 text-center">
          <h2 className="text-lg font-semibold text-text-primary">Visualization unavailable</h2>
          <p className="mt-2 text-sm text-text-muted">{reason}</p>
          <Link
            href={getVisualizationUrl(sessionId, state.manifest.pipeline)}
            className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Open {state.manifest.default_module === 'volcano' ? 'Volcano' : 'Results'}
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
