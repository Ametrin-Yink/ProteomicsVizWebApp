# 05 - State Management (Zustand)

**Purpose:** Define patterns for managing application state

---

## Store Architecture

### Store Separation

**MUST separate stores by domain:**

```typescript
// stores/
├── session-store.ts    # Session data
├── ui-store.ts         # UI state (modals, toasts)
├── data-store.ts       # Analysis data (cached results)
└── processing-store.ts # Processing status
```

**NEVER create monolithic stores:**
```typescript
// WRONG ❌ - Everything in one store
const useAppStore = create((set, get) => ({
  sessions: [],
  currentSession: null,
  isModalOpen: false,
  toastMessage: null,
  volcanoPlotData: null,
  processingStatus: null,
  // ... everything mixed together
}));

// CORRECT ✅ - Separate by domain
const useSessionStore = create(...);  // Session data
const useUIStore = create(...);       // UI state
const useDataStore = create(...);     // Cached data
```

---

## Session Store

```typescript
// stores/session-store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';

interface SessionState {
  // State
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setSessions: (sessions: Session[]) => void;
  setCurrentSession: (session: Session | null) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useSessionStore = create<SessionState>()(
  immer(
    persist(
      (set, get) => ({
        // Initial state
        sessions: [],
        currentSession: null,
        isLoading: false,
        error: null,
        
        // Actions
        setSessions: (sessions) => {
          set({ sessions });
        },
        
        setCurrentSession: (session) => {
          set({ currentSession: session });
        },
        
        addSession: (session) => {
          set((state) => ({
            sessions: [...state.sessions, session],
          }));
        },
        
        updateSession: (id, updates) => {
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === id ? { ...s, ...updates } : s
            ),
          }));
        },
        
        removeSession: (id) => {
          set((state) => ({
            sessions: state.sessions.filter((s) => s.id !== id),
            currentSession:
              state.currentSession?.id === id
                ? null
                : state.currentSession,
          }));
        },
        
        setLoading: (isLoading) => {
          set({ isLoading });
        },
        
        setError: (error) => {
          set({ error });
        },
      }),
      {
        name: 'session-storage',
        partialize: (state) => ({ sessions: state.sessions }), // Only persist sessions
      }
    )
  )
);
```

---

## UI Store

```typescript
// stores/ui-store.ts
interface UIState {
  // Modals
  isUploadModalOpen: boolean;
  isConfigModalOpen: boolean;
  isHelpModalOpen: boolean;
  
  // Toasts
  toasts: Toast[];
  
  // Selection
  selectedProteins: string[];
  selectedPathway: string | null;
  
  // Actions
  openUploadModal: () => void;
  closeUploadModal: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  selectProteins: (proteins: string[]) => void;
  clearProteinSelection: () => void;
  selectPathway: (pathway: string | null) => void;
}

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export const useUIStore = create<UIState>()(
  immer((set, get) => ({
    isUploadModalOpen: false,
    isConfigModalOpen: false,
    isHelpModalOpen: false,
    toasts: [],
    selectedProteins: [],
    selectedPathway: null,
    
    openUploadModal: () => set({ isUploadModalOpen: true }),
    closeUploadModal: () => set({ isUploadModalOpen: false }),
    
    addToast: (toast) => {
      const id = crypto.randomUUID();
      set((state) => ({
        toasts: [...state.toasts, { ...toast, id }],
      }));
      
      // Auto-remove after duration
      setTimeout(() => {
        get().removeToast(id);
      }, toast.duration || 5000);
    },
    
    removeToast: (id) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },
    
    selectProteins: (proteins) => {
      set({ selectedProteins: proteins });
    },
    
    clearProteinSelection: () => {
      set({ selectedProteins: [] });
    },
    
    selectPathway: (pathway) => {
      set({ selectedPathway: pathway });
    },
  }))
);
```

---

## Processing Store

```typescript
// stores/processing-store.ts
interface ProcessingState {
  status: ProcessingStatus | null;
  logs: ProcessingLog[];
  isConnected: boolean;
  
  // Actions
  setStatus: (status: ProcessingStatus) => void;
  addLog: (log: ProcessingLog) => void;
  clearLogs: () => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

interface ProcessingStatus {
  state: 'idle' | 'running' | 'completed' | 'error';
  currentStep: number;
  stepName: string;
  progress: number;
  steps: StepStatus[];
  error?: string;
}

interface StepStatus {
  step: number;
  name: string;
  status: 'pending' | 'started' | 'in_progress' | 'completed' | 'error';
  progress?: number;
}

interface ProcessingLog {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  step?: number;
}

export const useProcessingStore = create<ProcessingState>()(
  immer((set) => ({
    status: null,
    logs: [],
    isConnected: false,
    
    setStatus: (status) => {
      set({ status });
    },
    
    addLog: (log) => {
      set((state) => ({
        logs: [...state.logs, log],
      }));
    },
    
    clearLogs: () => {
      set({ logs: [] });
    },
    
    setConnected: (connected) => {
      set({ isConnected: connected });
    },
    
    reset: () => {
      set({
        status: null,
        logs: [],
        isConnected: false,
      });
    },
  }))
);
```

---

## Data Store (Cached Results)

```typescript
// stores/data-store.ts
interface DataState {
  // Cached data
  diffExpression: DiffExpressionResult[] | null;
  qcData: QCData | null;
  gseaResults: Record<string, GSEAResult[]>; // by database
  
  // Loading states
  isLoadingDiffExpr: boolean;
  isLoadingQC: boolean;
  isLoadingGSEA: boolean;
  
  // Actions
  setDiffExpression: (data: DiffExpressionResult[]) => void;
  setQCData: (data: QCData) => void;
  setGSEAResults: (database: string, results: GSEAResult[]) => void;
  clearCache: () => void;
}

export const useDataStore = create<DataState>()(
  immer((set) => ({
    diffExpression: null,
    qcData: null,
    gseaResults: {},
    isLoadingDiffExpr: false,
    isLoadingQC: false,
    isLoadingGSEA: false,
    
    setDiffExpression: (data) => {
      set({ diffExpression: data, isLoadingDiffExpr: false });
    },
    
    setQCData: (data) => {
      set({ qcData: data, isLoadingQC: false });
    },
    
    setGSEAResults: (database, results) => {
      set((state) => ({
        gseaResults: { ...state.gseaResults, [database]: results },
        isLoadingGSEA: false,
      }));
    },
    
    clearCache: () => {
      set({
        diffExpression: null,
        qcData: null,
        gseaResults: {},
      });
    },
  }))
);
```

---

## Using Stores in Components

### Basic Usage
```typescript
// components/session-list.tsx
import { useSessionStore } from '@/stores/session-store';

const SessionList: React.FC = () => {
  // Select only what you need
  const sessions = useSessionStore((state) => state.sessions);
  const removeSession = useSessionStore((state) => state.removeSession);
  
  return (
    <ul>
      {sessions.map((session) => (
        <li key={session.id}>
          {session.name}
          <button onClick={() => removeSession(session.id)}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
};
```

### Multiple Stores
```typescript
// components/analysis-page.tsx
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useProcessingStore } from '@/stores/processing-store';

const AnalysisPage: React.FC = () => {
  const currentSession = useSessionStore((state) => state.currentSession);
  const selectedProteins = useUIStore((state) => state.selectedProteins);
  const processingStatus = useProcessingStore((state) => state.status);
  
  // Component logic
};
```

### Async Actions
```typescript
// hooks/use-session-actions.ts
import { useSessionStore } from '@/stores/session-store';
import { api } from '@/lib/api';

export const useSessionActions = () => {
  const { addSession, setCurrentSession, setError } = useSessionStore();
  
  const createSession = async (config: SessionConfig) => {
    try {
      const session = await api.sessions.create(config);
      addSession(session);
      setCurrentSession(session);
      return session;
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };
  
  return { createSession };
};
```

---

## Store Middleware

### immer (Immutable Updates)
```typescript
import { immer } from 'zustand/middleware/immer';

export const useStore = create<State>()(
  immer((set) => ({
    nested: { count: 0 },
    
    increment: () =>
      set((state) => {
        state.nested.count += 1; // Mutable syntax, immutable result
      }),
  }))
);
```

### persist (Local Storage)
```typescript
import { persist } from 'zustand/middleware';

export const useStore = create<State>()(
  persist(
    (set) => ({ ... }),
    {
      name: 'my-storage',
      partialize: (state) => ({ 
        onlyThisField: state.onlyThisField 
      }),
    }
  )
);
```

---

## Anti-Patterns

### ❌ DON'T: Get entire state
```typescript
// Bad - Re-renders on any state change
const state = useSessionStore();
return <div>{state.sessions[0]?.name}</div>;

// Good - Only re-renders when sessions change
const sessions = useSessionStore((state) => state.sessions);
return <div>{sessions[0]?.name}</div>;
```

### ❌ DON'T: Mutate outside actions
```typescript
// Bad - Direct mutation
const session = useSessionStore((state) => state.currentSession);
session.name = 'New Name'; // ❌ Mutating outside store

// Good - Use action
const updateSession = useSessionStore((state) => state.updateSession);
updateSession(session.id, { name: 'New Name' }); // ✅
```

### ❌ DON'T: Store derived data
```typescript
// Bad - Storing computed values
const useStore = create((set) => ({
  items: [],
  itemCount: 0, // ❌ Derived from items
  
  addItem: (item) => set((state) => ({
    items: [...state.items, item],
    itemCount: state.items.length + 1, // ❌ Manual sync
  })),
}));

// Good - Compute on demand
const useStore = create((set) => ({
  items: [],
}));

// Component
const itemCount = useStore((state) => state.items.length); // ✅
```

---

## Testing Stores

```typescript
// stores/__tests__/session-store.test.ts
import { useSessionStore } from '../session-store';

beforeEach(() => {
  // Reset store before each test
  useSessionStore.setState({
    sessions: [],
    currentSession: null,
    isLoading: false,
    error: null,
  });
});

test('adds session', () => {
  const session = { id: '1', name: 'Test' };
  
  useSessionStore.getState().addSession(session);
  
  expect(useSessionStore.getState().sessions).toContainEqual(session);
});

test('updates session', () => {
  useSessionStore.getState().addSession({ id: '1', name: 'Old' });
  
  useSessionStore.getState().updateSession('1', { name: 'New' });
  
  expect(useSessionStore.getState().sessions[0].name).toBe('New');
});
```

---

## Next Steps

See [06-error-handling.md](06-error-handling.md) for error handling patterns.
