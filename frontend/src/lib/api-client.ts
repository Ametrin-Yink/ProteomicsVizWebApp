/**
 * Unified API client for backend communication
 * Merged from api-client.ts + api.ts — all API surfaces live here.
 *
 * Namespace guide:
 *  - sessionsApi      : session CRUD
 *  - uploadApi         : file upload
 *  - processingApi     : pipeline start/status/retry/cancel/logs
 *  - visualizationApi  : DE results, QC, GSEA, protein/peptide abundance,
 *                        BioNet, Compare, Task status
 *  - organismsApi      : organism listing
 *  - exportApi         : report list/delete
 *  - getDataSource     : fetch full session config (legacy)
 *  - updateVisualizationState : persist markers/filters
 *  - sessionApiPrefix / reportApiPrefix : URL prefix helpers
 */

import type {
  ApiResponse,
  ApiError,
  SessionConfig,
  UploadedFileInfo,
  Organism,
} from '@/types';
import type { Session, SessionStatus, AnalysisConfig } from '@/types/session';
import type {
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
  PTMUploadResponse,
} from '@/types/api';

// ---- File Library Types ----

export interface FileLibraryEntry {
  name: string;
  path: string;
  type: 'txt' | 'csv' | 'folder';
  size: number;
  modified_at: string | null;
}

export interface SelectedFileInfo {
  filename: string;
  size: number;
  columns: string[];
  file_type: 'tmt' | 'dia';
  tmt_channels?: string[];
  has_quan_value?: boolean;
}

// Use empty base URL to go through Next.js proxy (avoids CORS)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '/api';  // Backend routes are at /api

// Helper to build API URLs
const apiUrl = (path: string) => `${API_BASE_URL}${API_PREFIX}${path}`;

/**
 * Thin axios-like wrapper using fetch (no axios dependency).
 * Methods return { data: T } to match the axios .data accessor pattern.
 */
const api = {
  get: async <T>(url: string, config?: { responseType?: string; signal?: AbortSignal }): Promise<{ data: T }> => {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${url}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: config?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    if (config?.responseType === 'text') {
      return { data: (await response.text()) as unknown as T };
    }
    return { data: (await response.json()) as T };
  },

  post: async <T>(url: string, data?: unknown, config?: { signal?: AbortSignal }): Promise<{ data: T }> => {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: config?.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    return { data: (await response.json()) as T };
  },

  put: async <T>(url: string, data?: unknown): Promise<{ data: T }> => {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    return { data: (await response.json()) as T };
  },

  delete: async <T>(url: string, config?: { data?: unknown }): Promise<{ data: T }> => {
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${url}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: config?.data !== undefined ? JSON.stringify(config.data) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    return { data: (await response.json()) as T };
  },
};

// Backend session format (different from frontend Session type)
interface BackendSession {
  id: string;
  session_id?: string;  // Some endpoints may use this
  name: string;
  template: string;
  state: string;
  status?: string;  // Alias for state
  pipeline?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  config: {
    experiment_name?: string;
    conditions?: string[];
    replicates?: number;
    keep_razor?: boolean;
    strict_filtering?: boolean;
  } | null;
  error_message: string | null;
  files?: {
    proteomics: unknown[];
  };
}

// Map backend status to frontend status
function mapBackendStatus(status: string): SessionStatus {
  const statusMap: Record<string, SessionStatus> = {
    'created': 'created',
    'configuring': 'created',
    'uploading': 'uploading',
    'uploaded': 'uploaded',
    'queued': 'queued',
    'processing': 'processing',
    'completed': 'completed',
    'error': 'error',
    'cancelled': 'cancelled',
  };
  return statusMap[status] || 'created';
}

/** Map backend file metadata to UploadedFileInfo format for the analysis store */
export function mapBackendFiles(files: BackendSession['files']): UploadedFileInfo[] {
  if (!files?.proteomics) return [];
  return (files.proteomics as Array<{
    filename: string;
    size: number;
    experiment?: string;
    replicate?: number;
    batch?: string;
    file_type?: 'tmt' | 'dia' | null;
    tmt_channels?: string[];
    columns?: string[];
  }>).map(f => ({
    filename: f.filename,
    experiment: f.experiment || '',
    replicate: f.replicate || 0,
    batch: f.batch || '',
    file_type: f.file_type || null,
    tmt_channels: f.tmt_channels,
    size: f.size,
    columns: f.columns || [],
  }));
}

/**
 * Build a default AnalysisConfig to satisfy the Session type from @/types/session
 */
function defaultAnalysisConfig(override?: Partial<AnalysisConfig>): AnalysisConfig {
  return {
    name: '',
    description: '',
    template: 'multi_condition_comparison',
    conditions: [],
    replicates: {},
    parameters: {
      minPeptides: 2,
      minSamples: 2,
      log2FoldChangeThreshold: 1.0,
      pValueThreshold: 0.05,
      gseaDatabase: 'GO_Biological_Process_2021',
      gseaMinSize: 15,
      gseaMaxSize: 500,
      pcaComponents: 2,
      normalizationMethod: 'median',
      imputationMethod: 'knn',
    },
    ...override,
  };
}

/**
 * Default SessionResults for completed sessions
 */
function defaultSessionResults() {
  return {
    proteinAbundance: null,
    differentialExpression: null,
    qcMetrics: null,
    gsea: null,
  };
}

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Handle API response and parse JSON
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type');

  // Handle 204 No Content
  if (response.status === 204) {
    return null as T;
  }

  if (!contentType?.includes('application/json')) {
    throw new APIError(
      'Invalid response format',
      'INVALID_RESPONSE',
      response.status
    );
  }

  const data = await response.json();

  if (!response.ok) {
    // Handle both AppException format ({ error: { code, message } })
    // and FastAPI HTTPException format ({ detail: "..." })
    const appError = (data as ApiError)?.error;
    const detail = (data as { detail?: unknown })?.detail;
    if (appError) {
      throw new APIError(appError.message, appError.code, response.status, appError.details);
    }
    if (detail) {
      // FastAPI 422 validation errors return detail as an array of { loc, msg, type }
      const message = Array.isArray(detail)
        ? detail.map((d: { loc?: string[]; msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
        : String(detail);
      throw new APIError(message, 'HTTP_ERROR', response.status);
    }
    throw new APIError(`Request failed with status ${response.status}`, 'UNKNOWN_ERROR', response.status);
  }

  // Handle both wrapped ({ data: T }) and unwrapped (T) responses
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as ApiResponse<T>).data;
  }

  return data as T;
}

/**
 * Lightweight JSON fetch for endpoints that don't go through /api sessions.
 * Used by visualizationApi functions that receive an apiPrefix from context.
 */
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
    throw new APIError(
      error.error?.message || `HTTP ${response.status}`,
      'FETCH_ERROR',
      response.status
    );
  }

  const data: ApiResponse<T> = await response.json();
  // Handle both wrapped ({ data: T }) and unwrapped (T) responses
  return 'data' in data ? data.data : data as T;
}

// ═══════════════════════════════════════════════════════════════════════
//  URL prefix helpers
// ═══════════════════════════════════════════════════════════════════════

export function sessionApiPrefix(sessionId: string): string {
  return `/api/sessions/${sessionId}`;
}

export function reportApiPrefix(reportId: string): string {
  return `/api/reports/${reportId}`;
}

// ═══════════════════════════════════════════════════════════════════════
//  Sessions API
// ═══════════════════════════════════════════════════════════════════════

export const sessionsApi = {
  /**
   * Create a new session
   */
  create: async (name: string, template: string = 'protein_pairwise_comparison'): Promise<Session> => {
    const response = await fetch(apiUrl('/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, template }),
    });
    const backendSession = await handleResponse<BackendSession>(response);

    // Use id or session_id (backend returns id)
    const sessionId = backendSession.id || backendSession.session_id || '';
    const sessionStatus = backendSession.state || backendSession.status || 'created';

    // Map backend format to frontend format
    return {
      id: sessionId,
      name: backendSession.name || name || `Analysis ${sessionId.slice(0, 8)}`,
      template: backendSession.template || template,
      status: mapBackendStatus(sessionStatus),
      currentStep: null,
      progress: sessionStatus === 'completed' ? 100 : 0,
      config: defaultAnalysisConfig({
        name: backendSession.config?.experiment_name || name,
        conditions: backendSession.config?.conditions || [],
      }),
      createdAt: backendSession.created_at,
      updatedAt: backendSession.updated_at,
      completedAt: backendSession.completed_at ?? null,
      errorMessage: backendSession.error_message,
      uploadedFiles: [],
      results: sessionStatus === 'completed' ? defaultSessionResults() : null,
    };
  },

  /**
   * Get a specific session
   */
  get: async (sessionId: string): Promise<Session> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}`));
    const backendSession = await handleResponse<BackendSession>(response);

    const sid = backendSession.id || backendSession.session_id || sessionId;
    const sessionStatus = backendSession.state || backendSession.status || 'created';

    return {
      id: sid,
      name: backendSession.name || backendSession.config?.experiment_name || `Analysis ${sid.slice(0, 8)}`,
      template: backendSession.template || 'protein_pairwise_comparison',
      status: mapBackendStatus(sessionStatus),
      currentStep: null,
      progress: sessionStatus === 'completed' ? 100 : 0,
      config: defaultAnalysisConfig({
        name: backendSession.config?.experiment_name || '',
        conditions: backendSession.config?.conditions || [],
      }),
      createdAt: backendSession.created_at,
      updatedAt: backendSession.updated_at,
      completedAt: backendSession.completed_at ?? null,
      errorMessage: backendSession.error_message,
      uploadedFiles: [],
      results: sessionStatus === 'completed' ? defaultSessionResults() : null,
    };
  },

  /**
   * List all sessions
   */
  list: async (): Promise<Session[]> => {
    const response = await fetch(apiUrl('/sessions'));
    const data = await handleResponse<BackendSession[]>(response);

    return (data || []).map(s => {
      const sessionId = s.id || s.session_id || '';
      const sessionStatus = s.state || s.status || 'created';
      return {
        id: sessionId,
        name: s.name || s.config?.experiment_name || `Analysis ${sessionId.slice(0, 8)}`,
        template: s.template || 'protein_pairwise_comparison',
        status: mapBackendStatus(sessionStatus),
        currentStep: null,
        progress: sessionStatus === 'completed' ? 100 : 0,
        config: defaultAnalysisConfig({
          name: s.name || s.config?.experiment_name || '',
          conditions: s.config?.conditions || [],
        }),
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        completedAt: s.completed_at ?? null,
        errorMessage: s.error_message,
        uploadedFiles: [],
          results: sessionStatus === 'completed' ? defaultSessionResults() : null,
      };
    });
  },

  /**
   * Update session configuration
   */
  updateConfig: async (sessionId: string, config: SessionConfig): Promise<unknown> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/config?_t=${Date.now()}`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(config),
    });
    return handleResponse<Session>(response);
  },

  /**
   * Delete a session
   */
  delete: async (sessionId: string): Promise<void> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}`), {
      method: 'DELETE',
    });
    if (!response.ok) {
      // 204 No Content on success, so error responses may not have JSON body
      try {
        const data = await response.json();
        const message = data?.error?.message || data?.detail || `Delete failed (${response.status})`;
        throw new APIError(message, 'DELETE_FAILED', response.status);
      } catch {
        throw new APIError(`Delete failed (${response.status})`, 'DELETE_FAILED', response.status);
      }
    }
  },

  /**
   * Rename a session
   */
  rename: async (sessionId: string, newName: string): Promise<void> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!response.ok) {
      try {
        const data = await response.json();
        const message = data?.error?.message || data?.detail || `Rename failed (${response.status})`;
        throw new APIError(message, 'RENAME_FAILED', response.status);
      } catch {
        throw new APIError(`Rename failed (${response.status})`, 'RENAME_FAILED', response.status);
      }
    }
  },

  /**
   * Delete multiple sessions
   */
  deleteMultiple: async (sessionIds: string[]): Promise<{ succeeded: string[]; failed: { id: string; error: unknown }[] }> => {
    const results = await Promise.allSettled(sessionIds.map((id) => sessionsApi.delete(id)));
    const succeeded: string[] = [];
    const failed: { id: string; error: unknown }[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        succeeded.push(sessionIds[i]);
      } else {
        console.error(`Failed to delete session ${sessionIds[i]}:`, result.reason);
        failed.push({ id: sessionIds[i], error: result.reason });
      }
    });
    return { succeeded, failed };
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  File Upload API
// ═══════════════════════════════════════════════════════════════════════

export const uploadApi = {
  /**
   * Upload proteomics files in batches to avoid Next.js proxy limitations
   * Next.js dev server has issues proxying multipart uploads with 6+ files
   */
  uploadProteomics: async (
    sessionId: string,
    files: File[],
    onProgress?: (filename: string, progress: number) => void
  ): Promise<UploadedFileInfo[]> => {
    // Batch size of 5 to avoid Next.js proxy multipart issues
    const BATCH_SIZE = 5;
    const allResults: UploadedFileInfo[] = [];

    // Process files in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const formData = new FormData();

      // Add batch files to FormData
      for (const file of batch) {
        formData.append('files', file);
        onProgress?.(file.name, 0);
      }

      // Upload batch
      const response = await fetch(apiUrl(`/sessions/${sessionId}/upload/proteomics`), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new APIError(
          `Upload failed: ${response.status} ${errorText}`,
          'UPLOAD_FAILED',
          response.status
        );
      }

      // Mark batch files as complete
      for (const file of batch) {
        onProgress?.(file.name, 100);
      }

      // Parse response
      const responseData = await response.json();
      if (responseData.files && responseData.files.length > 0) {
        allResults.push(...responseData.files);
      }
    }

    return allResults;
  },

    /**
     * Upload PTM enrichment files
     */
    uploadPTMEnrichment: async (
      sessionId: string,
      files: File[],
      onProgress?: (filename: string, progress: number) => void
    ): Promise<PTMUploadResponse[]> => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
        onProgress?.(file.name, 0);
      }

      const response = await fetch(apiUrl(`/sessions/${sessionId}/upload/ptm-enrichment`), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new APIError(
          `PTM enrichment upload failed: ${response.status} ${errorText}`,
          'UPLOAD_FAILED',
          response.status
        );
      }

      for (const file of files) {
        onProgress?.(file.name, 100);
      }

      const responseData = await response.json();
      return responseData.files || [];
    },

    /**
     * Upload global proteome files
     */
    uploadGlobalProteome: async (
      sessionId: string,
      files: File[],
      onProgress?: (filename: string, progress: number) => void
    ): Promise<PTMUploadResponse[]> => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
        onProgress?.(file.name, 0);
      }

      const response = await fetch(apiUrl(`/sessions/${sessionId}/upload/global-proteome`), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new APIError(
          `Global proteome upload failed: ${response.status} ${errorText}`,
          'UPLOAD_FAILED',
          response.status
        );
      }

      for (const file of files) {
        onProgress?.(file.name, 100);
      }

      const responseData = await response.json();
      return responseData.files || [];
    },

    /**
     * Upload FASTA file (single file)
     */
    uploadFASTA: async (
      sessionId: string,
      file: File,
      onProgress?: (filename: string, progress: number) => void
    ): Promise<PTMUploadResponse> => {
      const formData = new FormData();
      formData.append('file', file);
      onProgress?.(file.name, 0);

      const response = await fetch(apiUrl(`/sessions/${sessionId}/upload/fasta`), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new APIError(
          `FASTA upload failed: ${response.status} ${errorText}`,
          'UPLOAD_FAILED',
          response.status
        );
      }

      onProgress?.(file.name, 100);

      const responseData = await response.json();
      return responseData.file || responseData;
    },

  };

// ═══════════════════════════════════════════════════════════════════════
//  Processing API  (pipeline lifecycle)
// ═══════════════════════════════════════════════════════════════════════

export const processingApi = {
  /**
   * Start processing
   */
  start: async (sessionId: string): Promise<{ status: string; websocket_url: string }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/process`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<{ status: string; websocket_url: string }>(response);
  },

  /**
   * Get processing status
   */
  getStatus: async (sessionId: string): Promise<{ queue_position?: number; queue_length?: number; state?: string; current_step?: number } & Record<string, unknown>> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/status`));
    return handleResponse(response);
  },

  /**
   * Retry processing after a failure
   */
  retry: async (sessionId: string): Promise<{ success: boolean; message: string }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/retry`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<{ success: boolean; message: string }>(response);
  },

  /**
   * Cancel processing
   */
  cancel: async (sessionId: string): Promise<{ success: boolean; message: string }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/cancel`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse<{ success: boolean; message: string }>(response);
  },

  /**
   * Get processing logs
   */
  getLogs: async (sessionId: string): Promise<{
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
    const response = await fetch(apiUrl(`/sessions/${sessionId}/logs`));
    return handleResponse(response);
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  Visualization API  (results, GSEA, BioNet, Compare, Tasks)
// ═══════════════════════════════════════════════════════════════════════

export const visualizationApi = {
  // ── DE Results ──

  getDEResults: (
    apiPrefix: string,
    params?: {
      significant_only?: boolean;
      page?: number;
      per_page?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      comparison?: string;
    },
    signal?: AbortSignal
  ): Promise<DEResultsData> => {
    const queryParams = new URLSearchParams();
    if (params?.significant_only) queryParams.append('significant_only', 'true');
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.per_page) queryParams.append('page_size', params.per_page.toString());
    if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
    if (params?.sort_order) queryParams.append('sort_order', params.sort_order);
    if (params?.comparison) queryParams.append('comparison', params.comparison);

    const query = queryParams.toString();
    return fetchApi<DEResultsData>(`${apiPrefix}/results${query ? `?${query}` : ''}`, { signal });
  },

  // ── QC ──

  getQCData: (apiPrefix: string, signal?: AbortSignal): Promise<QCData> => {
    return fetchApi<QCData>(`${apiPrefix}/qc/plots`, { signal });
  },

  // ── GSEA ──

  getGSEAData: (
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
    },
    signal?: AbortSignal
  ): Promise<GSEAData> => {
    const queryParams = new URLSearchParams();
    if (params?.significant_only) queryParams.append('significant_only', 'true');
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.per_page) queryParams.append('page_size', params.per_page.toString());
    if (params?.sort_by) queryParams.append('sort_by', params.sort_by);
    if (params?.sort_order) queryParams.append('sort_order', params.sort_order);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.comparison) queryParams.append('comparison', params.comparison);

    const query = queryParams.toString();
    return fetchApi<GSEAData>(`${apiPrefix}/gsea/${database}${query ? `?${query}` : ''}`, { signal });
  },

  /** GSEA plot data (on-demand) */
  getGSEAPlotData: (
    apiPrefix: string,
    database: GSEADatabase,
    term: string,
    comparison?: string,
    signal?: AbortSignal
  ): Promise<GSEAPlotData> => {
    const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
    return fetchApi<GSEAPlotData>(`${apiPrefix}/gsea/${database}/plot?term=${encodeURIComponent(term)}${compParam}`, { signal });
  },

  /** GSEA heatmap data (on-demand) */
  getGSEAHeatmapData: (
    apiPrefix: string,
    database: GSEADatabase,
    term: string,
    comparison?: string,
    _signal?: AbortSignal
  ): Promise<GSEAHeatmapData> => {
    const compParam = comparison ? `&comparison=${encodeURIComponent(comparison)}` : '';
    return fetchApi<GSEAHeatmapData>(`${apiPrefix}/gsea/${database}/heatmap?term=${encodeURIComponent(term)}${compParam}`);
  },

  /** Run GSEA on-demand */
  runGSEA: (
    apiPrefix: string,
    body: {
      comparison: string;
      databases: string[];
      min_size?: number;
      max_size?: number;
      permutations?: number;
    }
  ): Promise<{ comparison: string; databases: string[]; summary: Record<string, { total_pathways: number; significant_pathways: number }> }> => {
    return fetchApi(`${apiPrefix}/gsea/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** GSEA run status */
  getGSEAStatus: (apiPrefix: string, signal?: AbortSignal): Promise<GSEARunStatus> => {
    return fetchApi<GSEARunStatus>(`${apiPrefix}/gsea/status`, { signal });
  },

  // ── Protein Abundance ──

  getProteinAbundance: (
    apiPrefix: string,
    proteinId: string,
    comparison?: string,
    signal?: AbortSignal
  ): Promise<ProteinAbundance> => {
    const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
    return fetchApi<ProteinAbundance>(`${apiPrefix}/protein/${proteinId}/abundance${compParam}`, { signal });
  },

  /** Peptide abundance for a protein */
  getPeptideAbundance: (
    apiPrefix: string,
    proteinId: string,
    comparison?: string,
    signal?: AbortSignal
  ): Promise<PeptideAbundanceData> => {
    const compParam = comparison ? `?comparison=${encodeURIComponent(comparison)}` : '';
    return fetchApi<PeptideAbundanceData>(`${apiPrefix}/protein/${proteinId}/peptide${compParam}`, { signal });
  },

  // ── BioNet ──

  runBioNet: (apiPrefix: string, body: BioNetRunRequest): Promise<{ status: string; comparison: string }> => {
    return fetchApi(`${apiPrefix}/bionet/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  getBioNetStatus: (apiPrefix: string, signal?: AbortSignal): Promise<BioNetRunStatus> => {
    return fetchApi<BioNetRunStatus>(`${apiPrefix}/bionet/status`, { signal });
  },

  getBioNetSubnetwork: (apiPrefix: string, signal?: AbortSignal): Promise<BioNetSubnetwork> => {
    return fetchApi<BioNetSubnetwork>(`${apiPrefix}/bionet/subnetwork`, { signal });
  },

  // ── Compare (protein/comparison correlation, Venn) ──

  /** Trigger on-demand protein correlation computation */
  runProteinCorrelation: (
    apiPrefix: string,
    body: {
      protein_id: string;
      cluster_method: ClusterMethod;
      color_comparison: string;
    }
  ): Promise<{ status: string }> => {
    return fetchApi(`${apiPrefix}/compare/protein-correlation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** Poll protein correlation compute status */
  getProteinCorrelationStatus: (apiPrefix: string, signal?: AbortSignal): Promise<CompareRunStatus> => {
    return fetchApi<CompareRunStatus>(`${apiPrefix}/compare/protein-correlation/status`, { signal });
  },

  /** Get cached protein correlation results */
  getProteinCorrelationData: (apiPrefix: string, signal?: AbortSignal): Promise<ProteinCorrelationData> => {
    return fetchApi<ProteinCorrelationData>(`${apiPrefix}/compare/protein-correlation`, { signal });
  },

  /** Trigger on-demand comparison correlation computation */
  runComparisonCorrelation: (
    apiPrefix: string,
    body: {
      primary_comparison: string;
      selected_comparisons: string[];
      marked_proteins: Record<string, string[]>;
      cluster_method: ClusterMethod;
    }
  ): Promise<{ status: string }> => {
    return fetchApi(`${apiPrefix}/compare/comparison-correlation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** Poll comparison correlation compute status */
  getComparisonCorrelationStatus: (apiPrefix: string, signal?: AbortSignal): Promise<CompareRunStatus> => {
    return fetchApi<CompareRunStatus>(`${apiPrefix}/compare/comparison-correlation/status`, { signal });
  },

  /** Get cached comparison correlation results */
  getComparisonCorrelationData: (apiPrefix: string, signal?: AbortSignal): Promise<ComparisonCorrelationData> => {
    return fetchApi<ComparisonCorrelationData>(`${apiPrefix}/compare/comparison-correlation`, { signal });
  },

  /** Compute Venn diagram data (synchronous, returns result directly) */
  computeVennData: (
    apiPrefix: string,
    body: {
      comparisons: string[];
      pvalue_threshold: number;
      logfc_threshold: number;
    }
  ): Promise<VennData> => {
    return fetchApi<VennData>(`${apiPrefix}/compare/venn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** List all proteins across all comparisons for selector dropdowns */
  listProteins: (apiPrefix: string, signal?: AbortSignal): Promise<ProteinListEntry[]> => {
    return fetchApi<ProteinListEntry[]>(`${apiPrefix}/compare/proteins`, { signal });
  },

  // ── Task Status ──

  getTaskStatus: (sessionId: string, signal?: AbortSignal): Promise<{ tasks: Array<{ kind: string; label: string; status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled'; started_at: string | null; completed_at: string | null; error: string | null; progress: { completed: number; total: number } | null; queue_position: number | null }> }> => {
    return fetchApi(`/api/sessions/${sessionId}/tasks`, { signal });
  },

  cancelTasks: (sessionId: string): Promise<{ cancelled: boolean; status: string }> => {
    return fetchApi(`/api/sessions/${sessionId}/tasks/cancel`, { method: 'POST' });
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  Standalone visualization helpers (used by pages + config)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fetch full session config & metadata (includes comparisons, markers, filters).
 * Used by visualization pages to restore state.
 */
export async function getDataSource(
  apiPrefix: string,
  signal?: AbortSignal
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
    signal,
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

/**
 * Persist visualization state (markers + volcano filters) to the backend.
 * Falls back to localStorage on failure.
 */
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

// ═══════════════════════════════════════════════════════════════════════
//  Organisms API
// ═══════════════════════════════════════════════════════════════════════

export const organismsApi = {
  /**
   * List available organisms
   */
  list: async (): Promise<Organism[]> => {
    try {
      const response = await fetch(apiUrl('/organisms'));
      if (!response.ok) {
        // Fallback to default organisms if endpoint not available
        return [
          { id: 'human', name: 'Human', display_name: 'Human (Homo sapiens)', available: true },
          { id: 'mouse', name: 'Mouse', display_name: 'Mouse (Mus musculus)', available: true },
          { id: 'rat', name: 'Rat', display_name: 'Rat (Rattus norvegicus)', available: true },
          { id: 'zebrafish', name: 'Zebrafish', display_name: 'Zebrafish (Danio rerio)', available: true },
          { id: 'fly', name: 'Fruit Fly', display_name: 'Fruit Fly (Drosophila melanogaster)', available: true },
          { id: 'yeast', name: 'Yeast', display_name: 'Yeast (Saccharomyces cerevisiae)', available: true },
        ];
      }
      const data = await response.json();
      // Map backend organisms to include 'available' property
      return (data.organisms || []).map((org: {id: string, name: string}) => ({
        id: org.id,
        name: org.name,
        display_name: org.name.charAt(0).toUpperCase() + org.name.slice(1),
        available: true
      }));
    } catch {
      // Fallback to default organisms on error
      return [
        { id: 'human', name: 'Human', display_name: 'Human (Homo sapiens)', available: true },
        { id: 'mouse', name: 'Mouse', display_name: 'Mouse (Mus musculus)', available: true },
        { id: 'rat', name: 'Rat', display_name: 'Rat (Rattus norvegicus)', available: true },
        { id: 'zebrafish', name: 'Zebrafish', display_name: 'Zebrafish (Danio rerio)', available: true },
        { id: 'fly', name: 'Fruit Fly', display_name: 'Fruit Fly (Drosophila melanogaster)', available: true },
        { id: 'yeast', name: 'Yeast', display_name: 'Yeast (Saccharomyces cerevisiae)', available: true },
      ];
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  Export API — report management
// ═══════════════════════════════════════════════════════════════════════

export const exportApi = {
  /** List all reports across sessions */
  listAll: async (): Promise<{ reports: Array<{ report_id: string; name: string; session_id: string; session_name: string; created_at: string }> }> => {
    const response = await fetch(apiUrl('/reports'));
    return handleResponse<{ reports: Array<{ report_id: string; name: string; session_id: string; session_name: string; created_at: string }> }>(response);
  },

  /** Delete a report */
  delete: async (reportId: string): Promise<{ message: string }> => {
    const response = await fetch(apiUrl(`/reports/${reportId}`), { method: 'DELETE' });
    return handleResponse<{ message: string }>(response);
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  File Library API
// ═══════════════════════════════════════════════════════════════════════

export const fileLibraryApi = {
  listDirectory: (path: string): Promise<{ path: string; entries: FileLibraryEntry[] }> =>
    api.get(`/files/tree?path=${encodeURIComponent(path)}`).then(r => r.data),

  createFolder: (parentPath: string, name: string): Promise<{ path: string; name: string }> =>
    api.post(`/files/folders`, { parent_path: parentPath, name }).then(r => r.data),

  upload: async (
    files: File[],
    targetPath: string,
    onProgress?: (pct: number) => void,
  ): Promise<{ files: { name: string; size: number; type: string }[] }> => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    const response = await fetch(
      `${API_PREFIX}/files/upload?target_path=${encodeURIComponent(targetPath)}`,
      { method: 'POST', body: formData },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    return response.json();
  },

  rename: (path: string, newName: string): Promise<{ path: string; name: string }> =>
    api.put(`/files/rename`, { path, new_name: newName }).then(r => r.data),

  move: (sourcePath: string, targetParent: string): Promise<{ path: string; new_parent: string }> =>
    api.put(`/files/move`, { source_path: sourcePath, target_parent: targetParent }).then(r => r.data),

  delete: (path: string): Promise<{ deleted: string }> =>
    api.delete(`/files/delete`, { data: { path } }).then(r => r.data),

  scan: (): Promise<{ total: number; added: number; removed: number; updated: number }> =>
    api.post(`/files/scan`).then(r => r.data),

  search: (query: string): Promise<{ results: FileLibraryEntry[] }> =>
    api.get(`/files/search?q=${encodeURIComponent(query)}`).then(r => r.data),

  getContent: (path: string): Promise<string> =>
    api.get(`/files/content?path=${encodeURIComponent(path)}`, { responseType: 'text' }).then(r => r.data),

  selectForSession: (
    sessionId: string,
    paths: string[],
  ): Promise<{ files: SelectedFileInfo[] }> =>
    api.post(`/files/select`, { session_id: sessionId, paths }).then(r => r.data),
};
