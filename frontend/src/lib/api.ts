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
  CompareRunStatus,
  ProteinCorrelationData,
  ComparisonCorrelationData,
  VennData,
  ProteinListEntry,
  ClusterMethod,
  BioNetRunRequest,
  BioNetRunStatus,
  BioNetSubnetwork,
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
export async function getDataSource(
  apiPrefix: string
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
  const response = await fetch(`${API_BASE_URL}${apiPrefix}`, {
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
  apiPrefix: string,
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
  return fetchApi<DEResultsData>(`${apiPrefix}/results${query ? `?${query}` : ''}`);
}

// QC API
export async function getQCData(apiPrefix: string): Promise<QCData> {
  return fetchApi<QCData>(`${apiPrefix}/qc/plots`);
}

// GSEA API
export async function getGSEAData(
  apiPrefix: string,
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
  return fetchApi<GSEAData>(`${apiPrefix}/gsea/${database}${query ? `?${query}` : ''}`);
}

// Encode term for URL query parameter
function encodeTerm(term: string): string {
  return encodeURIComponent(term);
}

// GSEA Plot Data (on-demand)
export async function getGSEAPlotData(
  apiPrefix: string,
  database: GSEADatabase,
  term: string,
  comparison?: string
): Promise<GSEAPlotData> {
  const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<GSEAPlotData>(`${apiPrefix}/gsea/${database}/plot?term=${encodeTerm(term)}${compParam}`);
}

// GSEA Heatmap Data (on-demand)
export async function getGSEAHeatmapData(
  apiPrefix: string,
  database: GSEADatabase,
  term: string,
  comparison?: string
): Promise<GSEAHeatmapData> {
  const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<GSEAHeatmapData>(`${apiPrefix}/gsea/${database}/heatmap?term=${encodeTerm(term)}${compParam}`);
}

// GSEA On-Demand Run
export async function runGSEA(
  apiPrefix: string,
  body: {
    comparison: string;
    databases: string[];
    min_size?: number;
    max_size?: number;
    permutations?: number;
  }
): Promise<{ comparison: string; databases: string[]; summary: Record<string, { total_pathways: number; significant_pathways: number }> }> {
  return fetchApi(`${apiPrefix}/gsea/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// GSEA Run Status
export async function getGSEAStatus(apiPrefix: string): Promise<GSEARunStatus> {
  return fetchApi<GSEARunStatus>(`${apiPrefix}/gsea/status`);
}

// Protein Abundance API
export async function getProteinAbundance(
  apiPrefix: string,
  proteinId: string,
  comparison?: string
): Promise<ProteinAbundance> {
  const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<ProteinAbundance>(`${apiPrefix}/protein/${proteinId}/abundance${compParam}`);
}

// Peptide Abundance API
export async function getPeptideAbundance(
  apiPrefix: string,
  proteinId: string,
  comparison?: string
): Promise<PeptideAbundanceData> {
  const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
  return fetchApi<PeptideAbundanceData>(`${apiPrefix}/protein/${proteinId}/peptide${compParam}`);
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
export async function updateVisualizationState(
  apiPrefix: string,
  data: {
    markers?: Record<string, string[]>;
    volcano_filters?: {
      foldChange: number;
      pValue: number;
      adjPValue: number;
      s0: number;
    };
  }
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}${apiPrefix}/visualization-state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      console.warn(`Failed to save visualization state: ${response.status} ${response.statusText}`);
      // Fall back to localStorage so markers/filters survive page refresh
      try {
        localStorage.setItem(`viz_state_${apiPrefix}`, JSON.stringify(data));
      } catch { /* localStorage may be full or unavailable */ }
    }
  } catch (err) {
    console.warn('Failed to save visualization state:', err);
    try {
      localStorage.setItem(`viz_state_${apiPrefix}`, JSON.stringify(data));
    } catch { /* localStorage unavailable */ }
  }
}

// Compare API

/** Trigger on-demand protein correlation computation */
export async function runProteinCorrelation(
  apiPrefix: string,
  body: {
    protein_id: string;
    cluster_method: ClusterMethod;
    color_comparison: string;
  }
): Promise<{ status: string }> {
  return fetchApi(`${apiPrefix}/compare/protein-correlation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Poll protein correlation compute status */
export async function getProteinCorrelationStatus(apiPrefix: string): Promise<CompareRunStatus> {
  return fetchApi<CompareRunStatus>(`${apiPrefix}/compare/protein-correlation/status`);
}

/** Get cached protein correlation results */
export async function getProteinCorrelationData(apiPrefix: string): Promise<ProteinCorrelationData> {
  return fetchApi<ProteinCorrelationData>(`${apiPrefix}/compare/protein-correlation`);
}

/** Trigger on-demand comparison correlation computation */
export async function runComparisonCorrelation(
  apiPrefix: string,
  body: {
    primary_comparison: string;
    selected_comparisons: string[];
    marked_proteins: Record<string, string[]>;
    cluster_method: ClusterMethod;
  }
): Promise<{ status: string }> {
  return fetchApi(`${apiPrefix}/compare/comparison-correlation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Poll comparison correlation compute status */
export async function getComparisonCorrelationStatus(apiPrefix: string): Promise<CompareRunStatus> {
  return fetchApi<CompareRunStatus>(`${apiPrefix}/compare/comparison-correlation/status`);
}

/** Get cached comparison correlation results */
export async function getComparisonCorrelationData(apiPrefix: string): Promise<ComparisonCorrelationData> {
  return fetchApi<ComparisonCorrelationData>(`${apiPrefix}/compare/comparison-correlation`);
}

/** Compute Venn diagram data (synchronous, returns result directly) */
export async function computeVennData(
  apiPrefix: string,
  body: {
    comparisons: string[];
    pvalue_threshold: number;
    logfc_threshold: number;
  }
): Promise<VennData> {
  return fetchApi<VennData>(`${apiPrefix}/compare/venn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** List all proteins across all comparisons for selector dropdowns */
export async function listProteins(apiPrefix: string): Promise<ProteinListEntry[]> {
  return fetchApi<ProteinListEntry[]>(`${apiPrefix}/compare/proteins`);
}

// BioNet API

export async function runBioNet(
  apiPrefix: string,
  body: BioNetRunRequest
): Promise<{ status: string; comparison: string }> {
  return fetchApi(`${apiPrefix}/bionet/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getBioNetStatus(
  apiPrefix: string
): Promise<BioNetRunStatus> {
  return fetchApi<BioNetRunStatus>(
    `${apiPrefix}/bionet/status`
  );
}

export async function getBioNetSubnetwork(
  apiPrefix: string
): Promise<BioNetSubnetwork> {
  return fetchApi<BioNetSubnetwork>(
    `${apiPrefix}/bionet/subnetwork`
  );
}

// Helper functions to construct apiPrefix strings

export function sessionApiPrefix(sessionId: string): string {
  return `/api/sessions/${sessionId}`;
}

export function reportApiPrefix(reportId: string): string {
  return `/api/reports/${reportId}`;
}
