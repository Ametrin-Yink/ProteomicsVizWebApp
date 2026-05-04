/**
 * ToastProvider — subscribes to the zustand ui-store and renders toasts.
 * Add to any layout that needs toast notifications.
 */

'use client';

import React from 'react';
import { useUIStore } from '@/stores/ui-store';
import { ToastContainer } from './Toast';

export const ToastProvider: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  return (
    <ToastContainer
      toasts={toasts.map((t) => ({
        id: t.id,
        type: t.type as 'success' | 'error' | 'warning' | 'info',
        message: t.message,
        duration: t.duration ?? 5000,
      }))}
      onClose={removeToast}
      position="top-right"
    />
  );
};
