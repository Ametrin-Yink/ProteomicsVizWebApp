/**
 * Extended API client for backend communication
 * Includes upload, session management, and processing APIs
 */

import type {
  ApiResponse,
  ApiError,
  SessionConfig,
  UploadedFile,
  CompoundFileData,
  ProcessingStatus,
  Organism,
} from '@/types';
import type { Session, SessionStatus, AnalysisConfig } from '@/types/session';

// Use empty base URL to go through Next.js proxy (avoids CORS)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '/api';  // Backend routes are at /api

// Helper to build API URLs
const apiUrl = (path: string) => `${API_BASE_URL}${API_PREFIX}${path}`;

// Backend session format (different from frontend Session type)
interface BackendSession {
  id: string;
  session_id?: string;  // Some endpoints may use this
  name: string;
  template: string;
  state: string;
  status?: string;  // Alias for state
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
    compound: unknown | null;
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

/** Map backend file metadata to ParsedFilename format for the analysis store */
export function mapBackendFiles(files: BackendSession['files']): Array<{
  filename: string;
  experiment: string;
  condition: string;
  replicate: number;
  size: number;
  columns?: string[];
}> {
  if (!files?.proteomics) return [];
  return (files.proteomics as Array<{
    filename: string;
    size: number;
    experiment?: string;
    condition?: string;
    replicate?: number;
    columns?: string[];
  }>).map(f => ({
    filename: f.filename,
    experiment: f.experiment || '',
    condition: f.condition || '',
    replicate: f.replicate || 0,
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
    const errorData = data as ApiError;
    throw new APIError(
      errorData.error.message,
      errorData.error.code,
      response.status,
      errorData.error.details
    );
  }

  // Handle both wrapped ({ data: T }) and unwrapped (T) responses
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as ApiResponse<T>).data;
  }
  
  return data as T;
}

/**
 * Sessions API
 */
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
      compoundFile: null,
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
      compoundFile: null,
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
        compoundFile: null,
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

/**
 * File Upload API
 */
export const uploadApi = {
  /**
   * Upload proteomics files in batches to avoid Next.js proxy limitations
   * Next.js dev server has issues proxying multipart uploads with 6+ files
   */
  uploadProteomics: async (
    sessionId: string,
    files: File[],
    onProgress?: (filename: string, progress: number) => void
  ): Promise<UploadedFile[]> => {
    // Batch size of 5 to avoid Next.js proxy multipart issues
    const BATCH_SIZE = 5;
    const allResults: UploadedFile[] = [];

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
   * Upload compound file
   */
  uploadCompound: async (sessionId: string, file: File): Promise<CompoundFileData> => {
    const formData = new FormData();
    formData.append('file', file);  // Compound endpoint expects 'file' (singular)

    const response = await fetch(apiUrl(`/sessions/${sessionId}/upload/compound`), {
      method: 'POST',
      body: formData,
    });

    // Backend returns { message, file: {...} }, extract the file field
    const responseData = await handleResponse<{ message: string; file: CompoundFileData }>(response);
    return responseData.file;
  },
};

/**
 * Processing API
 */
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
  getStatus: async (sessionId: string): Promise<ProcessingStatus> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/status`));
    return handleResponse<ProcessingStatus>(response);
  },
};

/**
 * Organisms API
 */
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

/**
 * Reports API
 */
export const reportsApi = {
  /**
   * Generate PDF report
   */
  generate: async (
    sessionId: string,
    opts?: {
      fold_change?: number; p_value?: number; adj_p_value?: number; s0?: number;
      images?: Record<string, string[]>;
    }
  ): Promise<{ report_id: string; status: string; progress: number; download_url: string }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/reports/generate`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    });
    return handleResponse<{ report_id: string; status: string; progress: number; download_url: string }>(response);
  },

  /**
   * Download PDF report
   */
  download: async (sessionId: string, reportId: string): Promise<Blob> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/reports/${reportId}/download`));
    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        throw new APIError(
          errorData.detail || 'Download failed',
          'DOWNLOAD_FAILED',
          response.status
        );
      }
      throw new APIError('Download failed', 'DOWNLOAD_FAILED', response.status);
    }
    return response.blob();
  },

  /**
   * List reports for a session
   */
  list: async (sessionId: string): Promise<{ reports: Array<{ report_id: string; filename: string; size_mb: number; created_at: string; download_url: string }> }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/reports`));
    return handleResponse<{ reports: Array<{ report_id: string; filename: string; size_mb: number; created_at: string; download_url: string }> }>(response);
  },
};
