'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={cn('animate-pulse bg-border rounded', className)}
    />
  );
}

// Preset skeleton layouts
export function ProteinInfoSkeleton() {
  return (
    <div className="bg-background rounded-lg border border-border p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="pt-4 border-t border-border">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
