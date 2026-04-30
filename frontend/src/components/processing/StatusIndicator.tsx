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
    color: 'text-text-muted',
    bgColor: 'bg-border/20',
    label: 'Not Started',
  },
  in_progress: {
    icon: Loader2,
    color: 'text-warning',
    bgColor: 'bg-warning/5',
    label: 'In Progress',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-success',
    bgColor: 'bg-success/5',
    label: 'Completed',
  },
  error: {
    icon: XCircle,
    color: 'text-error',
    bgColor: 'bg-error/5',
    label: 'Error',
  },
  cancelled: {
    icon: XCircle,
    color: 'text-text-secondary',
    bgColor: 'bg-border/10',
    label: 'Cancelled',
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
