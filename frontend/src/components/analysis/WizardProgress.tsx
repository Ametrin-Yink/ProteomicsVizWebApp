'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface WizardStep {
  /** 1-based step number */
  number: number;
  /** URL-friendly id */
  id: string;
  /** Display label */
  label: string;
  /** Route for completed steps */
  route: string;
}

const WIZARD_STEPS: WizardStep[] = [
  { number: 1, id: 'upload', label: 'Upload', route: '/new/upload' },
  { number: 2, id: 'pipeline', label: 'Pipeline', route: '/new/pipeline' },
  { number: 3, id: 'comparisons', label: 'Comparisons', route: '/new/comparisons' },
  { number: 4, id: 'config', label: 'Configure', route: '/new/config' },
  { number: 5, id: 'summary', label: 'Summary', route: '/new/summary' },
];

interface WizardProgressProps {
  currentStep: number;
  sessionId: string;
  className?: string;
}

export function WizardProgress({ currentStep, sessionId, className }: WizardProgressProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {WIZARD_STEPS.map((step, idx) => {
        const isActive = step.number === currentStep;
        const isCompleted = step.number < currentStep;
        const stepRoute = `${step.route}?session=${sessionId}`;

        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center">
              {isCompleted ? (
                <Link
                  href={stepRoute}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white text-xs font-bold shadow-sm transition-opacity hover:opacity-80"
                  aria-label={`Go to ${step.label} step`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </Link>
              ) : (
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all',
                    isActive
                      ? 'bg-primary text-white shadow-[0_4px_14px_0_rgba(231,53,100,0.39)]'
                      : 'bg-border text-text-muted'
                  )}
                >
                  {step.number}
                </div>
              )}
              <span
                className={cn(
                  'mt-1.5 text-[11px] font-medium whitespace-nowrap',
                  isActive && 'text-primary',
                  isCompleted && 'text-primary',
                  !isActive && !isCompleted && 'text-text-muted'
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < WIZARD_STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 -mt-6 mx-0.5 rounded-full transition-colors',
                  idx < currentStep - 1 ? 'bg-primary' : 'bg-border'
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default WizardProgress;
