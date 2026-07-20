'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { VisualizationManifest } from '@/types/api';

export type VisualizationManifestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; manifest: VisualizationManifest }
  | { status: 'error'; message: string };

const VisualizationManifestContext = createContext<VisualizationManifestState>({
  status: 'idle',
});

export function VisualizationManifestProvider({
  state,
  children,
}: {
  state: VisualizationManifestState;
  children: ReactNode;
}) {
  return (
    <VisualizationManifestContext.Provider value={state}>
      {children}
    </VisualizationManifestContext.Provider>
  );
}

export function useVisualizationManifest(): VisualizationManifest | null {
  const state = useContext(VisualizationManifestContext);
  return state.status === 'ready' ? state.manifest : null;
}

export function useVisualizationManifestState(): VisualizationManifestState {
  return useContext(VisualizationManifestContext);
}
