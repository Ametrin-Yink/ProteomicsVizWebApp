/**
 * Loading Component
 *
 * Loading skeleton components.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

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
        'animate-pulse bg-border',
        variantClasses[variant],
        className
      )}
      style={style}
      aria-hidden="true"
    />
  );
};

// Protein info skeleton (moved from Skeleton.tsx)
export function ProteinInfoSkeleton() {
  return (
    <div className="bg-background rounded-lg border border-border p-6 space-y-4">
      <Skeleton variant="text" height={24} width="50%" />
      <div className="space-y-2">
        <Skeleton variant="text" height={16} width="100%" />
        <Skeleton variant="text" height={16} width="75%" />
        <Skeleton variant="text" height={16} width="50%" />
      </div>
      <div className="pt-4 border-t border-border">
        <Skeleton variant="rounded" height={128} width="100%" />
      </div>
    </div>
  );
}
