/**
 * UI store for managing UI state (modals, toasts, sidebar, etc.)
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Toast } from '@/types';
import { generateId } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface SidebarState {
  isOpen: boolean;
  width: number;
  isCollapsed: boolean;
}

interface UIState {
  // Modals
  isUploadModalOpen: boolean;
  isConfigModalOpen: boolean;
  isHelpModalOpen: boolean;

  // Toasts
  toasts: Toast[];

  // Theme
  theme: 'light' | 'dark';

  // Sidebar
  sidebar: SidebarState;

  // Actions
  toggleTheme: () => void;
  openUploadModal: () => void;
  closeUploadModal: () => void;
  openConfigModal: () => void;
  closeConfigModal: () => void;
  openHelpModal: () => void;
  closeHelpModal: () => void;
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarCollapsed: (isCollapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

export const useUIStore = create<UIState>()(
  immer((set, get) => ({
    // Initial state
    isUploadModalOpen: false,
    isConfigModalOpen: false,
    isHelpModalOpen: false,
    toasts: [],

    // Sidebar
    sidebar: {
      isOpen: true,
      width: 280,
      isCollapsed: false,
    },

    // Theme
    theme: 'light' as const,

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

    // Toast actions
    addToast: (type: ToastType, message: string, duration?: number) => {
      const id = generateId();
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

    // Sidebar actions
    toggleSidebar: () => {
      set((state) => {
        state.sidebar.isOpen = !state.sidebar.isOpen;
      });
    },

    // Theme actions
    toggleTheme: () => {
      set((state) => {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
      });
      // Apply theme changes to DOM
      if (typeof document !== 'undefined') {
        const isDark = document.documentElement.classList.toggle('dark');
        document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      }
    },

    setSidebarOpen: (isOpen: boolean) => {
      set((state) => {
        state.sidebar.isOpen = isOpen;
      });
    },

    setSidebarCollapsed: (isCollapsed: boolean) => {
      set((state) => {
        state.sidebar.isCollapsed = isCollapsed;
      });
    },

    setSidebarWidth: (width: number) => {
      set((state) => {
        state.sidebar.width = Math.max(200, Math.min(400, width));
      });
    },
  }))
);
