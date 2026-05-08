/**
 * Minimal API client hook for backend communication.
 * Provides get/post methods that call the FastAPI backend.
 */

'use client';

import { useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<{ data: T }> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return { data };
}

export function useApi() {
  const get = useCallback(async <T>(path: string) => {
    return request<T>(path);
  }, []);

  const post = useCallback(async <T>(path: string, body?: unknown) => {
    return request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }, []);

  return { get, post };
}
