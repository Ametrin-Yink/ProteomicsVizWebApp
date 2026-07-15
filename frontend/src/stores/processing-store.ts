/**
 * Processing store using Zustand
 * Manages processing pipeline state with real-time updates
 * Following AGENTS/05-state-management.md - NEVER mutate state directly
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { generateId } from '@/lib/utils';
import {
  ProcessingStepDef,
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
  steps: ProcessingStepDef[];
  logs: LogEntry[];
  previousLogs: LogEntry[];
  isConnected: boolean;
  isComplete: boolean;
  isCancelled: boolean;
  error: ProcessingError | null;
  sessionId: string | null;
  outputs: CompleteMessage['payload']['outputs'] | null;
  processingDuration: number | null;
  isQueued: boolean;
  queuePosition: number;
  queueLength: number;

  // Actions
  initializeSteps: (removeRazor: boolean, pipeline?: 'msqrob2' | 'msstats') => void;
  setSessionId: (sessionId: string) => void;
  setFirstStepProcessing: () => void;
  updateStepProgress: (message: ProgressMessage['payload']) => void;
  addLog: (message: LogMessage['payload']) => void;
  setLogs: (logs: LogEntry[]) => void;
  setError: (message: ErrorMessage['payload']) => void;
  setComplete: (message: CompleteMessage['payload']) => void;
  setConnected: (connected: boolean) => void;
  setCancelled: (cancelled: boolean) => void;
  syncStepProgress: (completedSteps: number[], currentStep: number) => void;
  setQueued: (position: number, length: number) => void;
  clearQueued: () => void;
  reset: () => void;
  retry: () => void;
}


const createInitialSteps = (
  removeRazor: boolean = true,
  pipeline: 'msqrob2' | 'msstats' = 'msqrob2'
): ProcessingStepDef[] => {
  return PROCESSING_STEPS
    .filter((step) => removeRazor || step.id !== 3)
    .map((step) => {
      const patched = { ...step };
      if (step.id === 6) {
        patched.moduleName = pipeline === 'msstats' ? 'R/MSstats' : 'R/msqrob2+QFeatures';
        patched.method = pipeline === 'msstats' ? 'dataProcess()' : 'dataProcess()';
      }
      if (step.id === 7) {
        patched.moduleName = pipeline === 'msstats' ? 'R/MSstats' : 'R/msqrob2';
        patched.method = pipeline === 'msstats' ? 'groupComparison()' : 'msqrobLm()';
      }
      return { ...patched, status: 'not_started' as const };
    });
};

export const useProcessingStore = create<ProcessingStore>()(
  immer((set) => ({
    // Initial state
    steps: [],
    logs: [],
    previousLogs: [],
    isConnected: false,
    isComplete: false,
    isCancelled: false,
    error: null,
    sessionId: null,
    outputs: null,
    processingDuration: null,
    isQueued: false,
    queuePosition: 0,
    queueLength: 0,

    // Initialize steps based on configuration
    initializeSteps: (removeRazor: boolean, pipeline?: 'msqrob2' | 'msstats') => {
      set((state) => {
        state.steps = createInitialSteps(removeRazor, pipeline);
        state.logs = [];
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
        const stepIndex = state.steps.findIndex((step: ProcessingStepDef) => step.id === message.step);
        if (stepIndex === -1) return;

        const step = state.steps[stepIndex];
        step.status = message.status === 'completed' ? 'completed' :
                      message.status === 'started' ? 'in_progress' :
                      message.status as 'in_progress' | 'completed' | 'not_started' | 'error';
        if (message.message) {
          step.message = message.message;
        }

        // Clear queued state when processing actually starts
        if (message.status === 'started' || message.status === 'in_progress') {
          state.isQueued = false;
        }
      });
    },

    // Set first step to in_progress (called when waiting for WebSocket)
    setFirstStepProcessing: () => {
      set((state) => {
        if (state.steps.length > 0 && state.steps[0].status === 'not_started') {
          state.steps[0].status = 'in_progress';
          state.steps[0].message = 'Waiting for connection...';
        }
      });
    },

    // Add log entry from WebSocket message
    addLog: (message: LogMessage['payload']) => {
      set((state) => {
        const logEntry: LogEntry = {
          id: generateId(),
          level: message.level,
          message: message.message,
          timestamp: message.timestamp,
          step: message.step,
        };
        state.logs.push(logEntry);
      });
    },

    // Set multiple logs (for loading historical logs) — ID-based dedup
    setLogs: (logs: LogEntry[]) => {
      set((state) => {
        const existingIds = new Set(state.logs.map(l => l.id));
        const newLogs = logs.filter(l => !existingIds.has(l.id));
        state.logs.push(...newLogs);
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
        const stepIndex = state.steps.findIndex((step: ProcessingStepDef) => step.id === message.step);
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
        state.steps.forEach((step: ProcessingStepDef) => {
          if (step.status !== 'error') {
            step.status = 'completed';
          }
        });
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

    // Sync step progress from polling data (fallback when WebSocket is unavailable)
    syncStepProgress: (completedSteps: number[], currentStep: number) => {
      set((state) => {
        // X-013: Don't update if already in terminal state
        if (state.isComplete || state.isCancelled || state.error) return;

        // Mark completed steps
        for (const stepNum of completedSteps) {
          const step = state.steps.find((s: ProcessingStepDef) => s.id === stepNum);
          if (step && step.status !== 'completed') {
            step.status = 'completed';
          }
        }
        // Mark current step as in_progress
        if (currentStep > 0) {
          const current = state.steps.find((s: ProcessingStepDef) => s.id === currentStep);
          if (current && current.status === 'not_started') {
            current.status = 'in_progress';
          }
        }
      });
    },

    // Set queued state from polling data
    setQueued: (position: number, length: number) => {
      set((state) => {
        state.isQueued = true;
        state.queuePosition = position;
        state.queueLength = length;
      });
    },

    // Clear queued state
    clearQueued: () => {
      set((state) => {
        state.isQueued = false;
      });
    },

    // Reset store to initial state
    reset: () => {
      set((state) => {
        state.steps = [];
        state.logs = [];
        state.isConnected = false;
        state.isComplete = false;
        state.isCancelled = false;
        state.error = null;
        state.sessionId = null;
        state.outputs = null;
        state.processingDuration = null;
        state.isQueued = false;
        state.queuePosition = 0;
        state.queueLength = 0;
      });
    },

    // Retry processing — archive logs before clearing
    retry: () => {
      set((state) => {
        state.previousLogs = state.logs;
        state.error = null;
        state.isComplete = false;
        state.isCancelled = false;
        state.isQueued = false;
        state.queuePosition = 0;
        state.queueLength = 0;
        state.steps.forEach((step: ProcessingStepDef) => {
          step.status = 'not_started';
          step.message = undefined;
        });
        state.logs = [];
      });
    },
  }))
);
