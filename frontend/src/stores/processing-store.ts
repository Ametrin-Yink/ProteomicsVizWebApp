/**
 * Processing store using Zustand
 * Manages processing pipeline state with real-time updates
 * Following AGENTS/05-state-management.md - NEVER mutate state directly
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ProcessingStep,
  LogEntry,
  ProcessingError,
  PROCESSING_STEPS,
  ProgressMessage,
  LogMessage,
  ErrorMessage,
  CompleteMessage,
} from '@/types/processing';

interface ProcessingStore {
  // State
  steps: ProcessingStep[];
  logs: LogEntry[];
  overallProgress: number;
  isConnected: boolean;
  isComplete: boolean;
  isCancelled: boolean;
  error: ProcessingError | null;
  sessionId: string | null;
  outputs: CompleteMessage['payload']['outputs'] | null;
  processingDuration: number | null;
  estimatedTimeRemaining: number | null;

  // Actions
  initializeSteps: (removeRazor: boolean) => void;
  setSessionId: (sessionId: string) => void;
  updateStepProgress: (message: ProgressMessage['payload']) => void;
  addLog: (message: LogMessage['payload']) => void;
  setError: (message: ErrorMessage['payload']) => void;
  setComplete: (message: CompleteMessage['payload']) => void;
  setConnected: (connected: boolean) => void;
  setCancelled: (cancelled: boolean) => void;
  reset: () => void;
  retry: () => void;
}

const generateLogId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const createInitialSteps = (removeRazor: boolean = true): ProcessingStep[] => {
  return PROCESSING_STEPS
    .filter((step) => step.id !== 3 || removeRazor)
    .map((step) => ({
      ...step,
      status: 'not_started' as const,
      progress: 0,
    }));
};

export const useProcessingStore = create<ProcessingStore>()(
  immer((set) => ({
    // Initial state
    steps: [],
    logs: [],
    overallProgress: 0,
    isConnected: false,
    isComplete: false,
    isCancelled: false,
    error: null,
    sessionId: null,
    outputs: null,
    processingDuration: null,
    estimatedTimeRemaining: null,

    // Initialize steps based on configuration
    initializeSteps: (removeRazor: boolean) => {
      set((state) => {
        state.steps = createInitialSteps(removeRazor);
        state.logs = [];
        state.overallProgress = 0;
        state.isComplete = false;
        state.isCancelled = false;
        state.error = null;
        state.outputs = null;
        state.processingDuration = null;
      });
    },

    // Set session ID
    setSessionId: (sessionId: string) => {
      set((state) => {
        state.sessionId = sessionId;
      });
    },

    // Update step progress from WebSocket message
    updateStepProgress: (message: ProgressMessage['payload']) => {
      set((state) => {
        const stepIndex = state.steps.findIndex((step: ProcessingStep) => step.id === message.step);
        if (stepIndex === -1) return;

        const step = state.steps[stepIndex];
        step.status = message.status === 'completed' ? 'completed' : 
                      message.status === 'started' ? 'in_progress' : 
                      message.status as 'in_progress' | 'completed' | 'not_started' | 'error';
        step.progress = message.progress;
        if (message.message) {
          step.message = message.message;
        }

        // Update overall progress
        state.overallProgress = message.overall_progress;
      });
    },

    // Add log entry from WebSocket message
    addLog: (message: LogMessage['payload']) => {
      set((state) => {
        const logEntry: LogEntry = {
          id: generateLogId(),
          level: message.level,
          message: message.message,
          timestamp: message.timestamp,
          step: message.step,
        };
        state.logs.push(logEntry);
      });
    },

    // Set error state from WebSocket message
    setError: (message: ErrorMessage['payload']) => {
      set((state) => {
        state.error = {
          step: message.step,
          stepName: message.step_name,
          message: message.error,
          recoverable: message.recoverable,
          suggestion: message.suggestion,
        };

        // Update step status to error
        const stepIndex = state.steps.findIndex((step: ProcessingStep) => step.id === message.step);
        if (stepIndex !== -1) {
          state.steps[stepIndex].status = 'error';
        }
      });
    },

    // Set completion state from WebSocket message
    setComplete: (message: CompleteMessage['payload']) => {
      set((state) => {
        state.isComplete = true;
        state.outputs = message.outputs;
        state.processingDuration = message.duration;

        // Mark all steps as completed
        state.steps.forEach((step: ProcessingStep) => {
          if (step.status !== 'error') {
            step.status = 'completed';
            step.progress = 100;
          }
        });

        state.overallProgress = 100;
      });
    },

    // Set connection status
    setConnected: (connected: boolean) => {
      set((state) => {
        state.isConnected = connected;
      });
    },

    // Set cancelled status
    setCancelled: (cancelled: boolean) => {
      set((state) => {
        state.isCancelled = cancelled;
      });
    },

    // Reset store to initial state
    reset: () => {
      set((state) => {
        state.steps = [];
        state.logs = [];
        state.overallProgress = 0;
        state.isConnected = false;
        state.isComplete = false;
        state.isCancelled = false;
        state.error = null;
        state.sessionId = null;
        state.outputs = null;
        state.processingDuration = null;
      });
    },

    // Retry processing - reset error state but keep session
    retry: () => {
      set((state) => {
        state.error = null;
        state.isComplete = false;
        state.isCancelled = false;
        state.steps.forEach((step: ProcessingStep) => {
          step.status = 'not_started';
          step.progress = 0;
          step.message = undefined;
        });
        state.overallProgress = 0;
        state.logs = [];
      });
    },
  }))
);
