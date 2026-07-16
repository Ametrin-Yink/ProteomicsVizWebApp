/**
 * Wizard layout for the new analysis flow.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/layout/SidebarContext';
import { SessionManager } from '@/components/session/SessionManager';
import { WizardStepper } from '@/components/ui/WizardStepper';

function NewAnalysisLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isExpanded } = useSidebar();
  const searchParams = useSearchParams();
  const analysisType = searchParams.get('type') as 'tmt' | 'dia' | 'ptm' | null;

  return (
    <div className="flex w-full h-full relative">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Panel - Wizard Content */}
      <main className={cn(
        'absolute top-0 right-0 bottom-0 overflow-y-auto bg-surface transition-all duration-200',
        isExpanded ? 'left-80' : 'left-16'
      )}>
        {/* Back link */}
        <div className="px-8 pt-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>

        {/* Wizard step indicator */}
        <div className="border-b border-border bg-surface">
          <WizardStepper analysisType={analysisType ?? undefined} />
        </div>

        {/* Page content */}
        <div className="px-8 pb-8 pt-5">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function NewAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <React.Suspense fallback={<div className="flex-1 bg-surface" />}>
      <NewAnalysisLayoutContent>{children}</NewAnalysisLayoutContent>
    </React.Suspense>
  );
}
