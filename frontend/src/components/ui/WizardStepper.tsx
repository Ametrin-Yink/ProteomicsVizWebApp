'use client';

import { usePathname } from 'next/navigation';
import { Check } from 'lucide-react';

type AnalysisType = 'tmt' | 'dia' | 'ptm';

interface WizardStepperProps {
  analysisType?: AnalysisType;
}

const ALL_STEPS = [
  { path: '/new/upload', label: 'Upload' },
  { path: '/new/metadata', label: 'Metadata' },
  { path: '/new/comparisons', label: 'Comparisons' },
  { path: '/new/config', label: 'Config' },
  { path: '/new/summary', label: 'Summary' },
];

export function WizardStepper({ analysisType }: WizardStepperProps) {
  const pathname = usePathname();

  // PTM skips metadata step
  const steps = analysisType === 'ptm'
    ? ALL_STEPS.filter(s => s.path !== '/new/metadata')
    : ALL_STEPS;

  // Add step index for display
  const indexed = steps.map((s, i) => ({ ...s, index: i + 1 }));

  const currentIdx = indexed.findIndex(s => pathname.startsWith(s.path));

  return (
    <nav aria-label="Analysis wizard progress" className="w-full px-6 py-4">
      <ol className="flex items-center gap-2">
        {indexed.map((step, i) => {
          const isComplete = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFuture = i > currentIdx;

          return (
            <li key={step.path} className="flex items-center gap-2">
              {/* Step circle */}
              <span
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium
                  transition-colors duration-200
                  ${isComplete ? 'bg-primary text-white' : ''}
                  ${isCurrent ? 'bg-primary/20 text-primary border-2 border-primary' : ''}
                  ${isFuture ? 'bg-surface border-2 border-border text-text-muted' : ''}
                `}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isComplete ? <Check className="w-4 h-4" /> : step.index}
              </span>

              {/* Step label */}
              <span
                className={`
                  text-sm font-medium hidden sm:inline
                  ${isCurrent ? 'text-primary' : ''}
                  ${isComplete ? 'text-text-primary' : ''}
                  ${isFuture ? 'text-text-muted' : ''}
                `}
              >
                {step.label}
              </span>

              {/* Connector line */}
              {i < indexed.length - 1 && (
                <span
                  className={`
                    w-8 h-0.5 hidden sm:block
                    ${i < currentIdx ? 'bg-primary' : 'bg-border'}
                  `}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
