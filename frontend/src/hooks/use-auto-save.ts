'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { sessionsApi } from '@/lib/api-client';
import type { SessionConfig } from '@/types';

interface UseAutoSaveOptions {
  debounceMs?: number;
  enabled?: boolean;
}

interface UseAutoSaveResult {
  isSaving: boolean;
  saveError: string | null;
  saveNow: () => Promise<void>;
}

export function useAutoSave(
  sessionId: string,
  config: SessionConfig,
  opts: UseAutoSaveOptions = {}
): UseAutoSaveResult {
  const { debounceMs = 800, enabled = true } = opts;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastRequestRef = useRef<{
    sessionId: string;
    config: SessionConfig;
    promise: Promise<void>;
  } | null>(null);
  const pendingSavesRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const saveNow = useCallback((): Promise<void> => {
    if (!sessionId) return Promise.resolve();

    const configToSave = configRef.current;
    const lastRequest = lastRequestRef.current;
    if (
      lastRequest?.sessionId === sessionId &&
      lastRequest.config === configToSave
    ) {
      return lastRequest.promise;
    }

    pendingSavesRef.current += 1;
    setIsSaving(true);

    const performSave = async () => {
      try {
        await sessionsApi.updateConfig(sessionId, configToSave);
        consecutiveFailuresRef.current = 0;
        setSaveError(null);
      } catch (err) {
        consecutiveFailuresRef.current += 1;
        const msg = err instanceof Error ? err.message : 'Save failed';
        setSaveError(consecutiveFailuresRef.current >= 3 ? `Save failed repeatedly: ${msg}` : null);
      } finally {
        pendingSavesRef.current -= 1;
        if (pendingSavesRef.current === 0) {
          setIsSaving(false);
        }
      }
    };

    const promise = saveQueueRef.current.then(performSave);
    saveQueueRef.current = promise;
    lastRequestRef.current = { sessionId, config: configToSave, promise };
    void promise.finally(() => {
      if (lastRequestRef.current?.promise === promise) {
        lastRequestRef.current = null;
      }
    });
    return promise;
  }, [sessionId]);

  // Debounced auto-save when config changes
  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveNow();
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [config, sessionId, debounceMs, enabled, saveNow]);

  return { isSaving, saveError, saveNow };
}
