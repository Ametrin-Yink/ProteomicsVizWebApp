'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { VisualizationManifest } from '@/types/api';

const VisualizationManifestContext = createContext<VisualizationManifest | null>(null);

export function VisualizationManifestProvider({
  manifest,
  children,
}: {
  manifest: VisualizationManifest | null;
  children: ReactNode;
}) {
  return (
    <VisualizationManifestContext.Provider value={manifest}>
      {children}
    </VisualizationManifestContext.Provider>
  );
}

export function useVisualizationManifest(): VisualizationManifest | null {
  return useContext(VisualizationManifestContext);
}
