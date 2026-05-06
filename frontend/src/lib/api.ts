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
  GSEARunStatus,
  ProteinAbundance,
  PeptideAbundanceData,
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
  // Handle both wrapped ({ data: T }) and unwrapped (T) responses
  return 'data' in data ? data.data : data as T;
}

// Session API
export async function getSession(
  sessionId: string
): Promise<{
  id: string;
  name: string;
  config?: {
    treatment?: string;
    control?: string;
    comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  };
  files?: { proteomics: Array<{ experiment: string }> };
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
}> {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: { message: 'Failed to fetch session', code: 'UNKNOWN_ERROR' },
    }));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }
  const wrapper = await response.json();
  // Backend wraps session responses in { data, meta }
  return wrapper.data || wrapper;
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
    comparison?: string;
  }
): Promise<DEResultsData> {
  const queryParams = new URLSearchParams();
  if (params?.significant_only) queryParams.append('significant_only', 'true');
  if (params?.page) queryParams.append('page', params.page.toString());
  // Backend uses 'page_size' not 'per_page'
  if (params?.per_page) queryParams.append('page_size', params.per_page.toString());
  if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
  if (params?.sort_order) queryParams.append('sort_order', params.sort_order);
  if (params?.comparison) queryParams.append('comparison', params.comparison);

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
    comparison?: string;
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
  if (params?.comparison) queryParams.append('comparison', params.comparison);

  const query = queryParams.toString();
  return fetchApi<GSEAData>(`/api/sessions/${sessionId}/gsea/${database}${query ? `?${query}` : ''}`);
}

// Encode term for URL query parameter
function encodeTerm(term: string): string {
  return encodeURIComponent(term);
}

// GSEA Plot Data (on-demand)
export async function getGSEAPlotData(
  sessionId: string,
  database: GSEADatabase,
  term: string,
  comparison?: string
): Promise<GSEAPlotData> {
  const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<GSEAPlotData>(`/api/sessions/${sessionId}/gsea/${database}/plot?term=${encodeTerm(term)}${compParam}`);
}

// GSEA Heatmap Data (on-demand)
export async function getGSEAHeatmapData(
  sessionId: string,
  database: GSEADatabase,
  term: string,
  comparison?: string
): Promise<GSEAHeatmapData> {
  const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<GSEAHeatmapData>(`/api/sessions/${sessionId}/gsea/${database}/heatmap?term=${encodeTerm(term)}${compParam}`);
}

// GSEA On-Demand Run
export async function runGSEA(
  sessionId: string,
  body: {
    comparison: string;
    databases: string[];
    min_size?: number;
    max_size?: number;
    permutations?: number;
  }
): Promise<{ comparison: string; databases: string[]; summary: Record<string, { total_pathways: number; significant_pathways: number }> }> {
  return fetchApi(`/api/sessions/${sessionId}/gsea/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// GSEA Run Status
export async function getGSEAStatus(sessionId: string): Promise<GSEARunStatus> {
  return fetchApi<GSEARunStatus>(`/api/sessions/${sessionId}/gsea/status`);
}

// Protein Abundance API
export async function getProteinAbundance(
  sessionId: string,
  proteinId: string,
  comparison?: string
): Promise<ProteinAbundance> {
  const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<ProteinAbundance>(`/api/sessions/${sessionId}/protein/${proteinId}/abundance${compParam}`);
}

// Peptide Abundance API
export async function getPeptideAbundance(
  sessionId: string,
  proteinId: string,
  comparison?: string
): Promise<PeptideAbundanceData> {
  const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<PeptideAbundanceData>(`/api/sessions/${sessionId}/protein/${proteinId}/peptide${compParam}`);
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
    return fetch(`${API_BASE_URL}/api/sessions/${sessionId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Visualization state (markers + volcano filters)
export async function updateSessionVisualizationState(
  sessionId: string,
  data: {
    markers?: string[];
    volcano_filters?: {
      foldChange: number;
      pValue: number;
      adjPValue: number;
      s0: number;
    };
  }
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/visualization-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      console.warn(`Failed to save visualization state: ${response.status} ${response.statusText}`);
      // Fall back to localStorage so markers/filters survive page refresh
      try {
        localStorage.setItem(`viz_state_${sessionId}`, JSON.stringify(data));
      } catch { /* localStorage may be full or unavailable */ }
    }
  } catch (err) {
    console.warn('Failed to save visualization state:', err);
    try {
      localStorage.setItem(`viz_state_${sessionId}`, JSON.stringify(data));
    } catch { /* localStorage unavailable */ }
  }
}
