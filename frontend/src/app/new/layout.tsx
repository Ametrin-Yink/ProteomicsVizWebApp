/**
 * Wizard layout for the new analysis flow.
 * 4-step indicator: Upload & Setup → Pipeline → Comparisons → Configure
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Upload, GitBranch, GitCompare, Sliders } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SessionManager } from '@/components/session/SessionManager';

const steps = [
  { id: 'upload', label: 'Upload & Setup', icon: Upload, route: '/new/upload', testId: 'wizard-step-1' },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch, route: '/new/pipeline', testId: 'wizard-step-2' },
  { id: 'comparisons', label: 'Comparisons', icon: GitCompare, route: '/new/comparisons', testId: 'wizard-step-3' },
  { id: 'config', label: 'Configure', icon: Sliders, route: '/new/config', testId: 'wizard-step-4' },
];

function getStepIndex(pathname: string): number {
  if (pathname.includes('/new/comparisons')) return 2;
  if (pathname.includes('/new/config')) return 3;
  if (pathname.includes('/new/pipeline')) return 1;
  return 0;
}

export default function NewAnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentStep = getStepIndex(pathname);

  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Panel - Wizard Content */}
      <main className="flex-1 h-full overflow-y-auto bg-surface">
        {/* Back link */}
        <div className="px-8 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>

        {/* Step indicator */}
        <div className="px-8 pt-6 pb-8">
          <div className="flex items-center justify-center gap-2">
            {steps.map((step, idx) => {
              const isActive = idx === currentStep;
              const isCompleted = idx < currentStep;
              const Icon = step.icon;

              return (
                <React.Fragment key={step.id}>
                  <div className="flex flex-col items-center">
                    <div
                      data-testid={step.testId}
                      className={cn(
                        'flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-200',
                        isActive && 'border-primary bg-primary text-white shadow-[0_0_12px_rgba(231,53,100,0.3)]',
                        isCompleted && 'border-primary bg-primary/10 text-primary',
                        !isActive && !isCompleted && 'border-border bg-card text-text-muted'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span
                      className={cn(
                        'mt-2 text-xs font-medium whitespace-nowrap',
                        isActive && 'text-primary',
                        isCompleted && 'text-primary',
                        !isActive && !isCompleted && 'text-text-muted'
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={cn(
                        'flex-1 h-0.5 -mt-6 mx-1 rounded-full transition-colors duration-300',
                        idx < currentStep ? 'bg-primary' : 'bg-border'
                      )}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Page content */}
        <div className="px-8 pb-12">
          {children}
        </div>
      </main>
    </div>
  );
}
