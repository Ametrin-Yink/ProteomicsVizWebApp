/**
 * Skeleton Component
 * Loading placeholder with subtle animation.
 */

import React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => (
  <div className={cn('bg-surface rounded animate-pulse', className)} />
);

export default Skeleton;
