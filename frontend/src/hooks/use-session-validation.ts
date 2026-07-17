'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, APIError } from '@/lib/api-client';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Validates that a session exists on the backend.
 * On 404: retries up to MAX_RETRIES with RETRY_DELAY delay, then redirects to home.
 * On network error: shows warning toast instead of redirecting.
 * Must be used inside a Suspense boundary.
 */
export function useSessionValidation(sessionId: string | null | undefined) {
  const router = useRouter();
  const addToast = useUIStore((state) => state.addToast);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    attemptsRef.current = 0;

    const validate = async () => {
      while (attemptsRef.current < MAX_RETRIES) {
        if (cancelled) return;

        try {
          await sessionsApi.get(sessionId);
          return; // Success — session exists
        } catch (err) {
          if (cancelled) return;

          // Check if it's a 404
          const is404 = err instanceof APIError && err.status === 404;

          if (is404) {
            attemptsRef.current += 1;
            if (attemptsRef.current >= MAX_RETRIES) {
              addToast('error', 'Session not found.');
              router.push('/');
              return;
            }
            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Network error — show warning, don't redirect
            addToast('warning', `Connection issue validating session: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return;
          }
        }
      }
    };

    validate();

    return () => {
      cancelled = true;
    };
  }, [sessionId, router, addToast]);
}
