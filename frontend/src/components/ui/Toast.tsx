/**
 * Toast Component
 * 
 * Toast notifications with auto-dismiss.
 * Uses design system colors.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { ToastType } from '@/stores/uiStore';

// Toast props
export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  onClose?: (id: string) => void;
}

// Toast icon mapping
const toastIcons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

// Toast color mapping
const toastColors: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'bg-success/5', border: 'border-success/20', icon: 'text-success' },
  error: { bg: 'bg-error/5', border: 'border-error/20', icon: 'text-error' },
  warning: { bg: 'bg-warning/5', border: 'border-warning/20', icon: 'text-warning' },
  info: { bg: 'bg-info/5', border: 'border-info/20', icon: 'text-info' },
};

/**
 * Individual Toast component
 */
export const Toast: React.FC<ToastProps> = ({
  id,
  type,
  message,
  duration = 5000,
  onClose,
}) => {
  const [isExiting, setIsExiting] = React.useState(false);
  const [progress, setProgress] = React.useState(100);
  const Icon = toastIcons[type];
  const colors = toastColors[type];

  const handleClose = React.useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose?.(id);
    }, 300);
  }, [onClose, id]);

  // Auto-dismiss logic
  React.useEffect(() => {
    const startTime = Date.now();
    const endTime = startTime + duration;

    const updateProgress = () => {
      const now = Date.now();
      const remaining = endTime - now;
      const newProgress = Math.max(0, (remaining / duration) * 100);
      setProgress(newProgress);

      if (newProgress > 0) {
        requestAnimationFrame(updateProgress);
      }
    };

    const progressAnimation = requestAnimationFrame(updateProgress);

    const timer = setTimeout(() => {
      handleClose();
    }, duration);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(progressAnimation);
    };
  }, [duration, handleClose]);

  return (
    <div
      className={cn(
        'relative flex items-start gap-3 p-4 rounded-lg border shadow-lg',
        'transform transition-all duration-300',
        'min-w-[320px] max-w-[480px]',
        colors.bg,
        colors.border,
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      )}
      role="alert"
      aria-live="polite"
    >
      {/* Icon */}
      <div className={cn('flex-shrink-0 mt-0.5', colors.icon)}>
        <Icon className="w-5 h-5" />
      </div>

      {/* Message */}
      <div className="flex-1 pr-2">
        <p className="text-sm font-medium text-text">
          {message}
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={handleClose}
        className="flex-shrink-0 text-text-muted hover:text-text-secondary transition-colors"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Progress bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 h-0.5 rounded-b-lg transition-all',
          colors.icon.replace('text-', 'bg-')
        )}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

// Toast container props
export interface ToastContainerProps {
  toasts: Array<{
    id: string;
    type: ToastType;
    message: string;
    duration: number;
  }>;
  onClose: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
}

/**
 * Toast Container component
 */
export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onClose,
  position = 'top-right',
}) => {
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  };

  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        'fixed z-50 flex flex-col gap-3',
        'pointer-events-none',
        positionClasses[position]
      )}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast
            id={toast.id}
            type={toast.type}
            message={toast.message}
            duration={toast.duration}
            onClose={onClose}
          />
        </div>
      ))}
    </div>
  );
};

// Hook for using toasts
export const useToast = () => {
  const [toasts, setToasts] = React.useState<ToastContainerProps['toasts']>([]);

  const addToast = React.useCallback(
    (type: ToastType, message: string, duration = 5000): string => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setToasts((prev) => [...prev, { id, type, message, duration }]);
      return id;
    },
    []
  );

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = React.useCallback(() => {
    setToasts([]);
  }, []);

  return {
    toasts,
    addToast,
    removeToast,
    clearAll,
    success: (message: string, duration?: number) => addToast('success', message, duration),
    error: (message: string, duration?: number) => addToast('error', message, duration),
    warning: (message: string, duration?: number) => addToast('warning', message, duration),
    info: (message: string, duration?: number) => addToast('info', message, duration),
  };
};

// Convenience exports
export default Toast;
