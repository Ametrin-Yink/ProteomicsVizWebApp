/**
 * Session Store using Zustand
 * 
 * Manages session state with proper actions - NEVER mutate state directly.
 * Follows AGENTS/05-state-management.md patterns.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Session, SessionState, SessionActions } from '@/types/session';

// Extended store interface combining state and actions
interface SessionStore extends SessionState, SessionActions {}

// Initial state factory
const createInitialState = (): SessionState => ({
  sessions: [],
  currentSession: null,
  isLoading: false,
  error: null,
});

export const useSessionStore = create<SessionStore>()(
  immer((set) => ({
    // Initial state
    ...createInitialState(),

    /**
     * Set all sessions - replaces entire session list
     * Use this when loading sessions from API
     */
    setSessions: (sessions: Session[]) => {
      set((state) => {
        state.sessions = sessions;
      });
    },

    /**
     * Load sessions from backend API
     * Call this on app initialization
     */
    loadSessions: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const { sessionsApi } = await import('@/lib/api-client');
        const sessions = await sessionsApi.list();
        console.log(`Loaded ${sessions.length} sessions from backend`);
        set((state) => {
          state.sessions = sessions;
          state.isLoading = false;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load sessions';
        console.error('Session load failed:', error);
        set((state) => {
          state.error = message;
          state.isLoading = false;
        });
      }
    },

    /**
     * Add a single session to the list
     * Use this when creating a new session
     */
    addSession: (session: Session) => {
      set((state) => {
        state.sessions.unshift(session);
        state.currentSession = session;
      });
    },

    /**
     * Update a session by ID
     * Use this when session data changes
     */
    updateSession: (id: string, updates: Partial<Session>) => {
      set((state) => {
        const sessionIndex = state.sessions.findIndex((s) => s.id === id);
        if (sessionIndex === -1) return;

        // Update in sessions array
        state.sessions[sessionIndex] = {
          ...state.sessions[sessionIndex],
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        // Update current session if it's the same one
        if (state.currentSession?.id === id) {
          state.currentSession = {
            ...state.currentSession,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
      });
    },

    /**
     * Delete a session by ID
     * Use this when removing a session
     */
    deleteSession: (id: string) => {
      set((state) => {
        state.sessions = state.sessions.filter((s) => s.id !== id);
        
        // Clear current session if it was deleted
        if (state.currentSession?.id === id) {
          state.currentSession = null;
        }
      });
    },

    /**
     * Set the current active session
     * Use this when switching between sessions
     */
    setCurrentSession: (session: Session | null) => {
      set((state) => {
        state.currentSession = session;
      });
    },

    /**
     * Set loading state
     * Use this during async operations
     */
    setLoading: (isLoading: boolean) => {
      set((state) => {
        state.isLoading = isLoading;
      });
    },

    /**
     * Set error state
     * Use this when an error occurs
     */
    setError: (error: string | null) => {
      set((state) => {
        state.error = error;
      });
    },

    /**
     * Update session progress from WebSocket
     * Specialized action for real-time updates
     */
    updateSessionProgress: (sessionId: string, progress: number, currentStep: string | null) => {
      set((state) => {
        const sessionIndex = state.sessions.findIndex((s) => s.id === sessionId);
        if (sessionIndex === -1) return;

        state.sessions[sessionIndex].progress = progress;
        state.sessions[sessionIndex].currentStep = currentStep as import('@/types/session').ProcessingStep;

        if (state.currentSession?.id === sessionId) {
          state.currentSession.progress = progress;
          state.currentSession.currentStep = currentStep as import('@/types/session').ProcessingStep;
        }
      });
    },

    /**
     * Update session status from WebSocket
     * Specialized action for status changes
     */
    updateSessionStatus: (sessionId: string, status: Session['status']) => {
      set((state) => {
        const sessionIndex = state.sessions.findIndex((s) => s.id === sessionId);
        if (sessionIndex === -1) return;

        state.sessions[sessionIndex].status = status;
        
        if (status === 'completed') {
          state.sessions[sessionIndex].completedAt = new Date().toISOString();
        }

        if (state.currentSession?.id === sessionId) {
          state.currentSession.status = status;
          if (status === 'completed') {
            state.currentSession.completedAt = new Date().toISOString();
          }
        }
      });
    },

    /**
     * Reset store to initial state
     * Use this for logout or complete reset
     */
    reset: () => {
      set(() => createInitialState());
    },
  }))
);

// Selector hooks for common state slices
export const useSessions = () => useSessionStore((state) => state.sessions);
export const useCurrentSession = () => useSessionStore((state) => state.currentSession);
export const useSessionLoading = () => useSessionStore((state) => state.isLoading);
export const useSessionError = () => useSessionStore((state) => state.error);

// Get session by ID selector
export const useSessionById = (id: string | null) => 
  useSessionStore((state) => state.sessions.find((s) => s.id === id) ?? null);

// Get sessions by status selector
export const useSessionsByStatus = (status: Session['status']) =>
  useSessionStore((state) => state.sessions.filter((s) => s.status === status));

// Get recent sessions (last 5)
export const useRecentSessions = () =>
  useSessionStore((state) => state.sessions.slice(0, 5));
