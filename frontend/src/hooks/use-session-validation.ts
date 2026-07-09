'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/ui-store';

/**
 * Validates that a session exists on the backend.
 * On 404: shows error toast and redirects to home.
 * Must be used inside a Suspense boundary (uses useSearchParams internally or accepts sessionId).
 */
export function useSessionValidation(sessionId: string | null | undefined) {
  const router = useRouter();
  const { addToast } = useUIStore();

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const controller = new AbortController();

    fetch(`/api/sessions/${sessionId}`, { signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 404) {
          addToast('error', 'Session not found.');
          router.push('/');
        }
      })
      .catch(() => {
        // Network errors are handled by data-fetching components
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, router, addToast]);
}
