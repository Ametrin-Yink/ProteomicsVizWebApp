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
  const savingRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const saveNow = useCallback(async () => {
    if (!sessionId || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, configRef.current);
      consecutiveFailuresRef.current = 0;
      setSaveError(null);
    } catch (err) {
      consecutiveFailuresRef.current++;
      const msg = err instanceof Error ? err.message : 'Save failed';
      setSaveError(consecutiveFailuresRef.current >= 3 ? `Save failed repeatedly: ${msg}` : null);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
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
