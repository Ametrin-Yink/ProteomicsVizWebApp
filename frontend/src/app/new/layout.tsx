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

function getStepIndex(pathname: string): number {
  if (pathname.includes('/new/summary')) return 5;
  if (pathname.includes('/new/config')) return 4;
  if (pathname.includes('/new/comparisons')) return 3;
  if (pathname.includes('/new/upload')) return 2;
  if (pathname.includes('/new/pipeline')) return 1;
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
  const currentStep = getStepIndex(pathname);
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
          <WizardProgress currentStep={currentStep} sessionId={sessionId} />
        </div>

        {/* Page content */}
        <div className="px-8 pb-8">
          {children}
        </div>
      </main>
    </div>
  );
}
