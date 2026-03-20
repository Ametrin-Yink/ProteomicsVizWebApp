/**
 * UI Store using Zustand
 * 
 * Manages global UI state including loading states, toasts, modals, and theme.
 * NEVER mutate state directly - always use actions.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// Toast types and interface
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  createdAt: number;
}

// Modal types
export type ModalType = 
  | 'createSession' 
  | 'deleteConfirm' 
  | 'settings' 
  | 'help' 
  | 'export' 
  | null;

// Sidebar state
export interface SidebarState {
  isOpen: boolean;
  width: number;
  isCollapsed: boolean;
}

// UI State interface
interface UIState {
  // Global loading
  isLoading: boolean;
  loadingMessage: string;
  
  // Toasts
  toasts: Toast[];
  
  // Modals
  activeModal: ModalType;
  modalData: Record<string, unknown> | null;
  
  // Sidebar
  sidebar: SidebarState;
  
  // Theme
  theme: 'light' | 'dark' | 'system';
  
  // Navigation
  currentPage: string;
  breadcrumbs: Array<{ label: string; href: string }>;
  
  // Errors
  globalError: string | null;
  
  // Feature flags / UI preferences
  preferences: {
    showTooltips: boolean;
    autoSave: boolean;
    compactMode: boolean;
    animationsEnabled: boolean;
  };
}

// UI Actions interface
interface UIActions {
  // Loading actions
  setLoading: (isLoading: boolean, message?: string) => void;
  clearLoading: () => void;
  
  // Toast actions
  addToast: (type: ToastType, message: string, duration?: number) => string;
  removeToast: (id: string) => void;
  clearAllToasts: () => void;
  
  // Modal actions
  openModal: (type: ModalType, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setModalData: (data: Record<string, unknown>) => void;
  
  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarCollapsed: (isCollapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  
  // Theme actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleTheme: () => void;
  
  // Navigation actions
  setCurrentPage: (page: string) => void;
  setBreadcrumbs: (breadcrumbs: Array<{ label: string; href: string }>) => void;
  pushBreadcrumb: (crumb: { label: string; href: string }) => void;
  popBreadcrumb: () => void;
  
  // Error actions
  setGlobalError: (error: string | null) => void;
  clearGlobalError: () => void;
  
  // Preference actions
  setPreference: <K extends keyof UIState['preferences']>(
    key: K, 
    value: UIState['preferences'][K]
  ) => void;
  togglePreference: (key: keyof UIState['preferences']) => void;
  
  // Reset
  reset: () => void;
}

// Combined store interface
interface UIStore extends UIState, UIActions {}

// Toast duration defaults (ms)
const TOAST_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  warning: 6000,
  info: 5000,
};

// Generate unique toast ID
const generateToastId = (): string => {
  return `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// Initial state factory
const createInitialState = (): UIState => ({
  isLoading: false,
  loadingMessage: '',
  toasts: [],
  activeModal: null,
  modalData: null,
  sidebar: {
    isOpen: true,
    width: 280,
    isCollapsed: false,
  },
  theme: 'light',
  currentPage: '',
  breadcrumbs: [],
  globalError: null,
  preferences: {
    showTooltips: true,
    autoSave: true,
    compactMode: false,
    animationsEnabled: true,
  },
});

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    // Initial state
    ...createInitialState(),

    // ==================== Loading Actions ====================
    
    setLoading: (isLoading: boolean, message: string = '') => {
      set((state) => {
        state.isLoading = isLoading;
        state.loadingMessage = message;
      });
    },

    clearLoading: () => {
      set((state) => {
        state.isLoading = false;
        state.loadingMessage = '';
      });
    },

    // ==================== Toast Actions ====================

    addToast: (type: ToastType, message: string, duration?: number): string => {
      const id = generateToastId();
      const toastDuration = duration ?? TOAST_DURATIONS[type];
      
      set((state) => {
        const toast: Toast = {
          id,
          type,
          message,
          duration: toastDuration,
          createdAt: Date.now(),
        };
        state.toasts.push(toast);
        
        // Auto-remove toast after duration
        setTimeout(() => {
          useUIStore.getState().removeToast(id);
        }, toastDuration);
      });
      
      return id;
    },

    removeToast: (id: string) => {
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id);
      });
    },

    clearAllToasts: () => {
      set((state) => {
        state.toasts = [];
      });
    },

    // ==================== Modal Actions ====================

    openModal: (type: ModalType, data?: Record<string, unknown>) => {
      set((state) => {
        state.activeModal = type;
        state.modalData = data ?? null;
      });
    },

    closeModal: () => {
      set((state) => {
        state.activeModal = null;
        state.modalData = null;
      });
    },

    setModalData: (data: Record<string, unknown>) => {
      set((state) => {
        state.modalData = { ...state.modalData, ...data };
      });
    },

    // ==================== Sidebar Actions ====================

    toggleSidebar: () => {
      set((state) => {
        state.sidebar.isOpen = !state.sidebar.isOpen;
      });
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

    // ==================== Theme Actions ====================

    setTheme: (theme: 'light' | 'dark' | 'system') => {
      set((state) => {
        state.theme = theme;
      });
      
      // Apply theme to document
      if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    },

    toggleTheme: () => {
      set((state) => {
        const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
        const currentIndex = themes.indexOf(state.theme);
        state.theme = themes[(currentIndex + 1) % themes.length];
      });
    },

    // ==================== Navigation Actions ====================

    setCurrentPage: (page: string) => {
      set((state) => {
        state.currentPage = page;
      });
    },

    setBreadcrumbs: (breadcrumbs: Array<{ label: string; href: string }>) => {
      set((state) => {
        state.breadcrumbs = breadcrumbs;
      });
    },

    pushBreadcrumb: (crumb: { label: string; href: string }) => {
      set((state) => {
        state.breadcrumbs.push(crumb);
      });
    },

    popBreadcrumb: () => {
      set((state) => {
        state.breadcrumbs.pop();
      });
    },

    // ==================== Error Actions ====================

    setGlobalError: (error: string | null) => {
      set((state) => {
        state.globalError = error;
      });
    },

    clearGlobalError: () => {
      set((state) => {
        state.globalError = null;
      });
    },

    // ==================== Preference Actions ====================

    setPreference: <K extends keyof UIState['preferences']>(
      key: K, 
      value: UIState['preferences'][K]
    ) => {
      set((state) => {
        state.preferences[key] = value;
      });
    },

    togglePreference: (key: keyof UIState['preferences']) => {
      set((state) => {
        const currentValue = state.preferences[key];
        if (typeof currentValue === 'boolean') {
          (state.preferences[key] as boolean) = !currentValue;
        }
      });
    },

    // ==================== Reset ====================

    reset: () => {
      set(() => createInitialState());
    },
  }))
);

// ==================== Convenience Hooks ====================

// Toast helpers
export const useToast = () => {
  const addToast = useUIStore((state) => state.addToast);
  
  return {
    success: (message: string, duration?: number) => addToast('success', message, duration),
    error: (message: string, duration?: number) => addToast('error', message, duration),
    warning: (message: string, duration?: number) => addToast('warning', message, duration),
    info: (message: string, duration?: number) => addToast('info', message, duration),
  };
};

// Selector hooks
export const useLoading = () => useUIStore((state) => ({
  isLoading: state.isLoading,
  message: state.loadingMessage,
}));

export const useToasts = () => useUIStore((state) => state.toasts);
export const useActiveModal = () => useUIStore((state) => ({
  modal: state.activeModal,
  data: state.modalData,
}));
export const useSidebar = () => useUIStore((state) => state.sidebar);
export const useTheme = () => useUIStore((state) => state.theme);
export const useBreadcrumbs = () => useUIStore((state) => state.breadcrumbs);
export const useGlobalError = () => useUIStore((state) => state.globalError);
export const usePreferences = () => useUIStore((state) => state.preferences);
