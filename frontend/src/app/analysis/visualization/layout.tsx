'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { VISUALIZATION_MODULES, getActiveModuleId } from '@/config/visualization-modules';
import { SessionManager } from '@/components/session/SessionManager';
import ExportButton from '@/components/visualization/ExportButton';
import { ApiProvider } from '@/lib/api-context';
import { sessionApiPrefix } from '@/lib/api';

function Navigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const activeTab = getActiveModuleId(pathname);

  return (
    <div className="bg-background border-b border-border sticky top-0 z-10">
      <div className="mx-auto px-6">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            {VISUALIZATION_MODULES.map((mod) => {
              const Icon = mod.icon;
              const isActive = activeTab === mod.id;

              return (
                <Link
                  key={mod.id}
                  href={`${mod.href}?session_id=${sessionId}`}
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
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const apiPrefix = sessionId ? sessionApiPrefix(sessionId) : '';

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <Navigation />
      {children}
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
