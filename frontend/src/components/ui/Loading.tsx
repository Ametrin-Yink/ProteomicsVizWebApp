/**
 * Loading Component
 * 
 * Loading spinner and skeleton components.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Spinner props
export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'primary' | 'secondary' | 'white';
  className?: string;
}

/**
 * Loading Spinner component
 */
export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = 'primary',
  className,
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
    xl: 'w-12 h-12 border-4',
  };

  const colorClasses = {
    primary: 'border-[#E73564] border-t-transparent',
    secondary: 'border-[#00ADEF] border-t-transparent',
    white: 'border-white border-t-transparent',
  };

  return (
    <div
      className={cn(
        'animate-spin rounded-full',
        sizeClasses[size],
        colorClasses[color],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
};

// Loading overlay props
export interface LoadingOverlayProps {
  isLoading: boolean;
  message?: string;
  children: React.ReactNode;
  className?: string;
  blur?: boolean;
}

/**
 * Loading Overlay component
 */
export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  message = 'Loading...',
  children,
  className,
  blur = true,
}) => {
  return (
    <div className={cn('relative', className)}>
      {children}
      
      {isLoading && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-4',
            'bg-white/80 z-50',
            blur && 'backdrop-blur-sm'
          )}
        >
          <Spinner size="lg" />
          {message && (
            <p className="text-sm font-medium text-[#64748b]">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// Skeleton props
export interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
  width?: string | number;
  height?: string | number;
}

/**
 * Skeleton loading placeholder
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'text',
  width,
  height,
}) => {
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
    rounded: 'rounded-lg',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={cn(
        'animate-pulse bg-[#e2e8f0]',
        variantClasses[variant],
        className
      )}
      style={style}
      aria-hidden="true"
    />
  );
};

// Skeleton text props
export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/**
 * Skeleton text with multiple lines
 */
export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 3,
  className,
}) => {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          height={16}
          width={i === lines - 1 ? '75%' : '100%'}
        />
      ))}
    </div>
  );
};

// Skeleton card props
export interface SkeletonCardProps {
  className?: string;
}

/**
 * Skeleton card placeholder
 */
export const SkeletonCard: React.FC<SkeletonCardProps> = ({ className }) => {
  return (
    <div className={cn('p-6 rounded-xl border border-[#e2e8f0] bg-white', className)}>
      <div className="flex items-start gap-4">
        <Skeleton variant="circular" width={48} height={48} />
        <div className="flex-1 space-y-3">
          <Skeleton variant="text" height={20} width="60%" />
          <SkeletonText lines={2} />
        </div>
      </div>
    </div>
  );
};

// Page loading props
export interface PageLoadingProps {
  message?: string;
  className?: string;
}

/**
 * Full page loading component
 */
export const PageLoading: React.FC<PageLoadingProps> = ({
  message = 'Loading...',
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-[50vh] gap-6',
        className
      )}
    >
      <div className="relative">
        <Spinner size="xl" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 bg-[#E73564] rounded-full animate-pulse" />
        </div>
      </div>
      
      <div className="text-center space-y-2">
        <p className="text-lg font-semibold text-[#1a1a2e]">
          {message}
        </p>
        <p className="text-sm text-[#64748b]">
          Please wait while we prepare your data
        </p>
      </div>
      
      {/* Animated dots */}
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-[#E73564] animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
};

// Progress bar props
export interface ProgressBarProps {
  progress: number;
  className?: string;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
  color?: 'primary' | 'secondary' | 'success';
}

/**
 * Progress bar component
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className,
  showPercentage = true,
  size = 'md',
  color = 'primary',
}) => {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  
  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const colorClasses = {
    primary: 'bg-[#E73564]',
    secondary: 'bg-[#00ADEF]',
    success: 'bg-emerald-500',
  };

  return (
    <div className={cn('w-full', className)}>
      <div className="flex justify-between mb-1.5">
        <span className="text-xs font-medium text-[#64748b]">Progress</span>
        {showPercentage && (
          <span className="text-xs font-semibold text-[#1a1a2e]">
            {Math.round(clampedProgress)}%
          </span>
        )}
      </div>
      <div
        className={cn(
          'w-full bg-[#e2e8f0] rounded-full overflow-hidden',
          sizeClasses[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out',
            colorClasses[color]
          )}
          style={{ width: `${clampedProgress}%` }}
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
};

// Convenience exports
export default Spinner;
