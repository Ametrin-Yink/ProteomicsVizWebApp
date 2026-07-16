'use client';
import { useEffect, useRef, useCallback } from 'react';

export function useBeforeUnload(enabled: boolean = true) {
  const handlerRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    handlerRef.current = handler;
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      handlerRef.current = null;
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    if (handlerRef.current) {
      window.removeEventListener('beforeunload', handlerRef.current);
      handlerRef.current = null;
    }
  }, []);

  return { dismiss };
}
