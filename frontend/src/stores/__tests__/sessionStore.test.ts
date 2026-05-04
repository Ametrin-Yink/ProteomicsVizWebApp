import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '@/stores/sessionStore';
import type { Session } from '@/types/session';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `test-${Date.now()}-${Math.random()}`,
    name: 'Test Session',
    template: 'multi_condition_comparison',
    status: 'created',
    currentStep: null,
    progress: 0,
    config: {
      name: 'Test',
      description: '',
      template: 'multi_condition_comparison',
      conditions: [],
      replicates: {},
      parameters: {
        minPeptides: 2,
        minSamples: 3,
        log2FoldChangeThreshold: 1,
        pValueThreshold: 0.05,
        gseaDatabase: 'KEGG',
        gseaMinSize: 15,
        gseaMaxSize: 500,
        pcaComponents: 3,
        normalizationMethod: 'none',
        imputationMethod: 'none',
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    uploadedFiles: [],
    compoundFile: null,
    results: null,
    ...overrides,
  };
}

describe('Session Store', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it('starts with empty sessions', () => {
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.currentSession).toBeNull();
  });

  it('adds a session', () => {
    const session = makeSession({ name: 'New Session' });
    useSessionStore.getState().addSession(session);

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].name).toBe('New Session');
    expect(state.currentSession).toBe(session);
  });

  it('deletes a single session', () => {
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().addSession(s2);

    useSessionStore.getState().deleteSession('s1');

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe('s2');
  });

  it('deletes multiple sessions', () => {
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });
    const s3 = makeSession({ id: 's3' });
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().addSession(s2);
    useSessionStore.getState().addSession(s3);

    useSessionStore.getState().deleteSessions(['s1', 's3']);

    const state = useSessionStore.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe('s2');
  });

  it('clears currentSession when it is among deleted sessions', () => {
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().addSession(s2);
    useSessionStore.getState().setCurrentSession(s1);

    useSessionStore.getState().deleteSessions(['s1']);

    const state = useSessionStore.getState();
    expect(state.currentSession).toBeNull();
    expect(state.sessions).toHaveLength(1);
  });

  it('keeps currentSession when a different session is deleted', () => {
    const s1 = makeSession({ id: 's1' });
    const s2 = makeSession({ id: 's2' });
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().addSession(s2);
    useSessionStore.getState().setCurrentSession(s2);

    useSessionStore.getState().deleteSessions(['s1']);

    const state = useSessionStore.getState();
    expect(state.currentSession?.id).toBe('s2');
  });

  it('updates a session', () => {
    const s1 = makeSession({ id: 's1', name: 'Old Name' });
    useSessionStore.getState().addSession(s1);

    useSessionStore.getState().updateSession('s1', { name: 'New Name' });

    const state = useSessionStore.getState();
    expect(state.sessions[0].name).toBe('New Name');
  });

  it('resets to initial state', () => {
    const s1 = makeSession();
    useSessionStore.getState().addSession(s1);
    useSessionStore.getState().reset();

    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.currentSession).toBeNull();
  });
});
