'use client';

import React, { createContext, useContext } from 'react';

interface ApiContextValue {
  /** Base path for API calls. */
  apiPrefix: string;
  scope: 'session' | 'shared-report';
  canPersistVisualizationState: boolean;
}

const ApiContext = createContext<ApiContextValue>({
  apiPrefix: '/api/sessions',
  scope: 'session',
  canPersistVisualizationState: true,
});

export function ApiProvider({
  apiPrefix,
  scope = 'session',
  children,
}: {
  apiPrefix: string;
  scope?: ApiContextValue['scope'];
  children: React.ReactNode;
}) {
  return (
    <ApiContext.Provider value={{
      apiPrefix,
      scope,
      canPersistVisualizationState: scope === 'session',
    }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi(): ApiContextValue {
  return useContext(ApiContext);
}
