/**
 * UI store for managing UI state (modals, toasts, etc.)
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Toast } from '@/types';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface UIState {
  // Modals
  isUploadModalOpen: boolean;
  isConfigModalOpen: boolean;
  isHelpModalOpen: boolean;

  // Toasts
  toasts: Toast[];

  // Actions
  openUploadModal: () => void;
  closeUploadModal: () => void;
  openConfigModal: () => void;
  closeConfigModal: () => void;
  openHelpModal: () => void;
  closeHelpModal: () => void;
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
}

export const useUIStore = create<UIState>()(
  immer((set, get) => ({
    // Initial state
    isUploadModalOpen: false,
    isConfigModalOpen: false,
    isHelpModalOpen: false,
    toasts: [],

    // Modal actions
    openUploadModal: () => {
      set((state) => {
        state.isUploadModalOpen = true;
      });
    },

    closeUploadModal: () => {
      set((state) => {
        state.isUploadModalOpen = false;
      });
    },

    openConfigModal: () => {
      set((state) => {
        state.isConfigModalOpen = true;
      });
    },

    closeConfigModal: () => {
      set((state) => {
        state.isConfigModalOpen = false;
      });
    },

    openHelpModal: () => {
      set((state) => {
        state.isHelpModalOpen = true;
      });
    },

    closeHelpModal: () => {
      set((state) => {
        state.isHelpModalOpen = false;
      });
    },

    // Toast actions - uses (type, message) signature for consistency with uiStore.ts
    addToast: (type: ToastType, message: string, duration?: number) => {
      const id = crypto.randomUUID();
      const toastDuration = duration ?? 5000;
      set((state) => {
        state.toasts.push({ id, type, message, duration: toastDuration });
      });

      // Auto-remove after duration
      setTimeout(() => {
        get().removeToast(id);
      }, toastDuration);
    },

    removeToast: (id) => {
      set((state) => {
        state.toasts = state.toasts.filter((t: Toast) => t.id !== id);
      });
    },

    clearAllToasts: () => {
      set((state) => {
        state.toasts = [];
      });
    },
  }))
);

/**
 * Helper function to show toast from anywhere
 */
export const showToast = (
  type: Toast['type'],
  message: string,
  duration?: number
): void => {
  const { addToast } = useUIStore.getState();
  addToast(type, message, duration);
};
