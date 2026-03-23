/**
 * StepTracker Component
 * Displays 9-step processing pipeline with visual progress
 */

import React from 'react';
import { ProcessingStep } from '@/types/processing';
import { StatusIndicator } from './StatusIndicator';
import { ProgressBar } from './ProgressBar';
import { cn } from '@/lib/utils';
import { ChevronRight, Terminal, Database, Filter, Calculator, BarChart3, Dna } from 'lucide-react';

interface StepTrackerProps {
  steps: ProcessingStep[];
  className?: string;
}

// Step icons based on step type
const getStepIcon = (stepId: number): React.ReactNode => {
  switch (stepId) {
    case 1:
      return <Database className="w-4 h-4" />;
    case 2:
      return <Dna className="w-4 h-4" />;
    case 3:
    case 4:
    case 5:
      return <Filter className="w-4 h-4" />;
    case 6:
    case 7:
      return <Calculator className="w-4 h-4" />;
    case 8:
      return <BarChart3 className="w-4 h-4" />;
    case 9:
      return <Terminal className="w-4 h-4" />;
    default:
      return <ChevronRight className="w-4 h-4" />;
  }
};

const StepCard: React.FC<{ step: ProcessingStep; isLast: boolean }> = ({
  step,
  isLast,
}) => {
  const isActive = step.status === 'in_progress';
  const isCompleted = step.status === 'completed';
  const isError = step.status === 'error';

  return (
    <div
      data-testid={`step-${step.id}`}
      className={cn(
        'relative flex items-start gap-4 p-4 rounded-xl transition-all duration-300',
        isActive && 'bg-cyan-50/50 dark:bg-cyan-950/20 ring-1 ring-cyan-200 dark:ring-cyan-800 in-progress',
        isCompleted && 'opacity-70 completed',
        isError && 'bg-rose-50/50 dark:bg-rose-950/20 ring-1 ring-rose-200 dark:ring-rose-800 error',
        step.status === 'not_started' && 'opacity-50 not-started'
      )}
    >
      {/* Step number and status */}
      <div className="flex flex-col items-center gap-2">
        <StatusIndicator data-testid="status-icon" status={step.status} size="md" />
        <span
          className={cn(
            'text-xs font-medium tabular-nums',
            isActive && 'text-cyan-600 dark:text-cyan-400',
            isCompleted && 'text-emerald-600 dark:text-emerald-400',
            isError && 'text-rose-600 dark:text-rose-400',
            step.status === 'not_started' && 'text-zinc-400'
          )}
        >
          {step.id}
        </span>
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={cn(
              'p-1.5 rounded-md',
              isActive
                ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            )}
          >
            {getStepIcon(step.id)}
          </span>
          <h3
            className={cn(
              'font-semibold text-sm',
              isActive && 'text-cyan-900 dark:text-cyan-100',
              isError && 'text-rose-900 dark:text-rose-100',
              'text-zinc-900 dark:text-zinc-100'
            )}
          >
            {step.name}
          </h3>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 line-clamp-2">
          {step.description}
        </p>

        {/* Package/Function info */}
        <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
            {step.package}
          </span>
          <span className="font-mono">{step.function}</span>
        </div>

        {/* Progress bar for in-progress steps */}
        {isActive && step.progress > 0 && (
          <div className="mt-3">
            <ProgressBar progress={step.progress} size="sm" showPercentage />
          </div>
        )}

        {/* Status message */}
        {step.message && (
          <p
            className={cn(
              'mt-2 text-xs',
              isError ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'
            )}
          >
            {step.message}
          </p>
        )}
      </div>

      {/* Connector line */}
      {!isLast && (
        <div
          className={cn(
            'absolute left-[2.25rem] top-14 w-px h-8',
            isCompleted
              ? 'bg-emerald-300 dark:bg-emerald-700'
              : 'bg-zinc-200 dark:bg-zinc-700'
          )}
        />
      )}
    </div>
  );
};

export const StepTracker: React.FC<StepTrackerProps> = ({ steps, className }) => {
  if (steps.length === 0) {
    return (
      <div className={cn('p-8 text-center text-zinc-500', className)}>
        <div className="animate-pulse">Loading steps...</div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {steps.map((step, index) => (
        <StepCard key={step.id} step={step} isLast={index === steps.length - 1} />
      ))}
    </div>
  );
};

export default StepTracker;
