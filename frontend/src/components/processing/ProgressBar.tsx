/**
 * ProgressBar Component
 * Displays overall processing progress with animated bar
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  progress: number; // 0-100
  className?: string;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

const sizeConfig = {
  sm: {
    container: 'h-2',
    text: 'text-xs',
  },
  md: {
    container: 'h-3',
    text: 'text-sm',
  },
  lg: {
    container: 'h-4',
    text: 'text-base',
  },
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className,
  showPercentage = true,
  size = 'md',
  animated = true,
}) => {
  // Clamp progress between 0 and 100
  const clampedProgress = Math.min(Math.max(progress, 0), 100);
  const sizes = sizeConfig[size];

  return (
    <div data-testid="progress-bar" data-value={clampedProgress} className={cn('w-full', className)}>
      <div className="flex items-center gap-3">
        <div
          data-testid="progress-bar"
          data-value={clampedProgress}
          className={cn(
            'flex-1 rounded-full bg-border overflow-hidden',
            sizes.container
          )}
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Processing progress"
        >
          <div
            className={cn(
              'h-full rounded-full bg-gradient-to-r from-primary to-primary-dark',
              'transition-all duration-500 ease-out',
              animated && 'animate-pulse'
            )}
            style={{
              width: `${clampedProgress}%`,
            }}
          />
        </div>
        {showPercentage && (
          <span
            className={cn(
              'font-medium text-text tabular-nums',
              sizes.text
            )}
          >
            {Math.round(clampedProgress)}%
          </span>
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
