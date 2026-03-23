/**
 * StatusIndicator Component
 * Displays step status with appropriate icons and colors
 */

import React from 'react';
import { 
  Circle, 
  Loader2, 
  CheckCircle2, 
  XCircle,
  type LucideIcon 
} from 'lucide-react';
import { StepStatus } from '@/types/processing';
import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: StepStatus;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const statusConfig: Record<StepStatus, {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}> = {
  not_started: {
    icon: Circle,
    color: 'text-zinc-400',
    bgColor: 'bg-zinc-100',
    label: 'Not Started',
  },
  in_progress: {
    icon: Loader2,
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-50',
    label: 'In Progress',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50',
    label: 'Completed',
  },
  error: {
    icon: XCircle,
    color: 'text-rose-500',
    bgColor: 'bg-rose-50',
    label: 'Error',
  },
};

const sizeConfig = {
  sm: {
    container: 'w-6 h-6',
    icon: 14,
  },
  md: {
    container: 'w-8 h-8',
    icon: 18,
  },
  lg: {
    container: 'w-10 h-10',
    icon: 22,
  },
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  size = 'md',
  className,
}) => {
  const config = statusConfig[status];
  const Icon = config.icon;
  const sizes = sizeConfig[size];

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full transition-all duration-300',
        config.bgColor,
        sizes.container,
        className
      )}
      title={config.label}
      role="status"
      aria-label={config.label}
    >
      <Icon
        size={sizes.icon}
        className={cn(
          config.color,
          status === 'in_progress' && 'animate-spin'
        )}
        aria-hidden="true"
      />
    </div>
  );
};

export default StatusIndicator;
