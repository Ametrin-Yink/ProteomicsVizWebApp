'use client';

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { useVisualizationManifest } from '@/lib/visualization-context';

export function VisualizationPipelineWorkspace({
  children,
  renderPTM,
}: {
  children: ReactNode;
  renderPTM: (sessionId: string) => ReactNode;
}) {
  const manifest = useVisualizationManifest();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  if (sessionId && manifest?.pipeline === 'ptm') {
    return renderPTM(sessionId);
  }
  return children;
}
