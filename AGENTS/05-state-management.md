# 05 - State Management (Zustand)

## Store Architecture

Separate stores by domain. Never create monolithic stores.

```
stores/
├── sessionStore.ts      # Session data (persisted to localStorage)
├── uiStore.ts           # UI state (modals, toasts, selections)
├── analysisStore.ts     # Cached analysis results
├── analysis-store.ts    # Additional analysis state
├── processing-store.ts  # Real-time processing status
└── ui-store.ts          # Additional UI state
```

## Patterns

### Select only what you need
```typescript
// Correct - only re-renders when sessions change
const sessions = useSessionStore((state) => state.sessions);

// Wrong - re-renders on any store change
const state = useSessionStore();
```

### Immer for immutable updates
```typescript
set((state) => {
  state.nested.count += 1;  // Mutable syntax, immutable result
});
```

### Never mutate directly
```typescript
// Wrong
const state = useSessionStore.getState();
state.session.name = 'New Name';

// Correct
updateSession({ name: 'New Name' });
```

### Compose hooks for actions
```typescript
export const useSessionActions = () => {
  const { addSession, setError } = useSessionStore();

  const createSession = async (config) => {
    try {
      const session = await api.sessions.create(config);
      addSession(session);
      return session;
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  return { createSession };
};
```

## Anti-Patterns

- Getting entire store instead of selecting specific fields
- Storing derived/computed data (compute on demand instead)
- Mutating state outside store actions
- Mixing domain state in one store (sessions + UI + analysis)

## Shared report scope

Visualization components are reused through `ApiProvider`. Session pages use a
session API prefix and may persist markers/filters. Shared report pages use the
capability API prefix with `scope="shared-report"`; they load the report's initial
state but keep each viewer's later markers and filters local. Do not infer this
permission from URL text inside visualization componentsâ€”use
`canPersistVisualizationState` from `useApi()`.
