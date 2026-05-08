'use client';

import React, { createContext, useContext } from 'react';

interface ApiContextValue {
  /** Base path for API calls. e.g. "/api/sessions/abc123" or "/api/reports/rpt_xyz" */
  apiPrefix: string;
}

const ApiContext = createContext<ApiContextValue>({
  apiPrefix: '/api/sessions',
});

export function ApiProvider({
  apiPrefix,
  children,
}: {
  apiPrefix: string;
  children: React.ReactNode;
}) {
  return (
    <ApiContext.Provider value={{ apiPrefix }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi(): ApiContextValue {
  return useContext(ApiContext);
}
