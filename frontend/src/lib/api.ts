/**
 * API client for proteomics visualization
 * Following AGENTS/04-api-contract.md
 */

import type {
  ApiResponse,
  DEResultsData,
  QCData,
  GSEAData,
  GSEADatabase,
  ProteinAbundance,
  PSMAbundanceData,
  GSEAPlotData,
  GSEAHeatmapData,
} from '@/types/api';
import {
  ProcessingStatusResponse,
  StartProcessingResponse,
} from '@/types/processing';

// Use empty base URL to go through Next.js proxy (avoids CORS)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// API endpoints follow the pattern: /api/sessions, /api/organisms, etc.
// WebSocket: /ws/sessions/{id}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: { message: 'Unknown error occurred', code: 'UNKNOWN_ERROR' },
    }));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  const data: ApiResponse<T> = await response.json();
  return data.data;
}

// Results API
export async function getDEResults(
  sessionId: string,
  params?: {
    significant_only?: boolean;
    page?: number;
    per_page?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
  }
): Promise<DEResultsData> {
  const queryParams = new URLSearchParams();
  if (params?.significant_only) queryParams.append('significant_only', 'true');
  if (params?.page) queryParams.append('page', params.page.toString());
  // Backend uses 'page_size' not 'per_page'
  if (params?.per_page) queryParams.append('page_size', params.per_page.toString());
  if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
  if (params?.sort_order) queryParams.append('sort_order', params.sort_order);

  const query = queryParams.toString();
  return fetchApi<DEResultsData>(`/api/sessions/${sessionId}/results${query ? `?${query}` : ''}`);
}

// QC API
export async function getQCData(sessionId: string): Promise<QCData> {
  return fetchApi<QCData>(`/api/sessions/${sessionId}/qc/plots`);
}

// GSEA API
export async function getGSEAData(
  sessionId: string,
  database: GSEADatabase,
  params?: {
    significant_only?: boolean;
    page?: number;
    per_page?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    search?: string;
  }
): Promise<GSEAData> {
  const queryParams = new URLSearchParams();
  if (params?.significant_only) queryParams.append('significant_only', 'true');
  if (params?.page) queryParams.append('page', params.page.toString());
  // Backend uses 'page_size' not 'per_page'
  if (params?.per_page) queryParams.append('page_size', params.per_page.toString());
  if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
  if (params?.sort_order) queryParams.append('sort_order', params.sort_order);
  if (params?.search) queryParams.append('search', params.search);

  const query = queryParams.toString();
  return fetchApi<GSEAData>(`/api/sessions/${sessionId}/gsea/${database}${query ? `?${query}` : ''}`);
}

// GSEA Plot Data (on-demand)
export async function getGSEAPlotData(
  sessionId: string,
  database: GSEADatabase,
  term: string
): Promise<GSEAPlotData> {
  return fetchApi<GSEAPlotData>(`/api/sessions/${sessionId}/gsea/${database}/${encodeURIComponent(term)}/plot`);
}

// GSEA Heatmap Data (on-demand)
export async function getGSEAHeatmapData(
  sessionId: string,
  database: GSEADatabase,
  term: string
): Promise<GSEAHeatmapData> {
  return fetchApi<GSEAHeatmapData>(`/api/sessions/${sessionId}/gsea/${database}/${encodeURIComponent(term)}/heatmap`);
}

// Protein Abundance API
export async function getProteinAbundance(
  sessionId: string,
  proteinId: string
): Promise<ProteinAbundance> {
  return fetchApi<ProteinAbundance>(`/api/sessions/${sessionId}/protein/${proteinId}/abundance`);
}

// PSM Abundance API
export async function getPSMAbundance(
  sessionId: string,
  proteinId: string
): Promise<PSMAbundanceData> {
  return fetchApi<PSMAbundanceData>(`/api/sessions/${sessionId}/protein/${proteinId}/psm`);
}

// Processing API - Following AGENTS/04-api-contract.md
export const processingAPI = {
  getStatus: (sessionId: string): Promise<ProcessingStatusResponse> => {
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/status`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || 'Failed to get processing status');
      }
      return response.json();
    });
  },

  startProcessing: (sessionId: string): Promise<StartProcessingResponse> => {
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || 'Failed to start processing');
      }
      return response.json();
    });
  },

  retryProcessing: (sessionId: string): Promise<StartProcessingResponse> => {
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, retry: true }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || 'Failed to retry processing');
      }
      return response.json();
    });
  },

  cancelProcessing: (sessionId: string): Promise<{ success: boolean; message: string }> => {
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || 'Failed to cancel processing');
      }
      return response.json();
    });
  },

  getLogs: (sessionId: string): Promise<{
    logs: Array<{
      level: 'info' | 'warning' | 'error';
      message: string;
      step?: number;
      timestamp: string;
    }>;
    completed_steps: number[];
    current_step: number;
    is_complete: boolean;
    outputs: Record<string, string> | null;
  }> => {
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/logs`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({
          detail: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw new Error(error.detail || 'Failed to get processing logs');
      }
      return response.json();
    });
  },
};
