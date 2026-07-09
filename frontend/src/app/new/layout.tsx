/**
 * Wizard layout for the new analysis flow.
 * 5-step indicator: Pipeline -> Upload -> Comparisons -> Configure -> Summary
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/layout/SidebarContext';
import { SessionManager } from '@/components/session/SessionManager';
import { WizardProgress } from '@/components/analysis/WizardProgress';
import { useAnalysisStore } from '@/stores/analysis-store';

function getStepIndex(pathname: string, analysisType: string | null): number {
  // PTM: 5 steps (skips metadata)
  if (analysisType === 'ptm') {
    if (pathname.includes('/new/summary')) return 5;
    if (pathname.includes('/new/config')) return 4;
    if (pathname.includes('/new/comparisons')) return 3;
    if (pathname.includes('/new/upload')) return 2;
    if (pathname.includes('/new/type')) return 1;
    return 1;
  }
  // Protein (TMT/DIA): 6 steps including metadata
  if (pathname.includes('/new/summary')) return 6;
  if (pathname.includes('/new/config')) return 5;
  if (pathname.includes('/new/comparisons')) return 4;
  if (pathname.includes('/new/metadata')) return 3;
  if (pathname.includes('/new/upload')) return 2;
  if (pathname.includes('/new/type')) return 1;
  return 1;
}

function getSessionIdFromURL(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || '';
}

export default function NewAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const sessionId = getSessionIdFromURL();
  const analysisType = useAnalysisStore((s) => s.analysisType);
  const currentStep = getStepIndex(pathname, analysisType);
  const { isExpanded } = useSidebar();

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

        {/* Step indicator */}
        <div className="px-8 pt-4 pb-5">
          <WizardProgress currentStep={currentStep} sessionId={sessionId} analysisType={analysisType} />
        </div>

        {/* Page content */}
        <div className="px-8 pb-8">
          {children}
        </div>
      </main>
    </div>
  );
}
