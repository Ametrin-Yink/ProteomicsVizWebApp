/**
 * Extended API client for backend communication
 * Includes upload, session management, and processing APIs
 */

import type {
  ApiResponse,
  ApiError,
  Session,
  SessionConfig,
  UploadedFile,
  CompoundFileData,
  ProcessingStatus,
  Organism,
} from '@/types';

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
function mapBackendStatus(status: string): Session['status'] {
  const statusMap: Record<string, Session['status']> = {
    'created': 'created',
    'uploading': 'uploading',
    'uploaded': 'uploaded',
    'processing': 'processing',
    'completed': 'completed',
    'error': 'error',
    'cancelled': 'cancelled',
  };
  return statusMap[status] || 'created';
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
      description: '',
      status: mapBackendStatus(sessionStatus),
      currentStep: null,
      progress: sessionStatus === 'completed' ? 100 : 0,
      config: {
        name: backendSession.config?.experiment_name || name,
        description: '',
        template: template as any,
        conditions: backendSession.config?.conditions || [],
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
      },
      createdAt: backendSession.created_at,
      updatedAt: backendSession.updated_at,
      completedAt: backendSession.completed_at,
      errorMessage: backendSession.error_message,
      uploadedFiles: [],
      compoundFile: null,
      results: sessionStatus === 'completed' ? {} : null,
    };
  },

  /**
   * List all sessions
   */
  list: async (): Promise<Session[]> => {
    const response = await fetch(apiUrl('/sessions'));
    const data = await handleResponse<BackendSession[]>(response);
    
    // Map backend format to frontend format
    return (data || []).map(s => {
      const sessionId = s.id || s.session_id || '';
      const sessionStatus = s.state || s.status || 'created';
      return {
        id: sessionId,
        name: s.name || s.config?.experiment_name || `Analysis ${sessionId.slice(0, 8)}`,
        description: '',
        status: mapBackendStatus(sessionStatus),
        currentStep: null,
        progress: sessionStatus === 'completed' ? 100 : 0,
        config: {
          treatment: s.config?.conditions?.[1] || '',
          control: s.config?.conditions?.[0] || '',
          organism: 'human', // Default
          remove_razor: !s.config?.keep_razor,
          strict_filtering: s.config?.strict_filtering || false,
        },
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        completedAt: s.completed_at,
        errorMessage: s.error_message,
        uploadedFiles: [],
        compoundFile: null,
        results: sessionStatus === 'completed' ? {} : null,
      };
    });
  },

  /**
   * Get a specific session
   */
  get: async (sessionId: string): Promise<Session> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}`));
    const backendSession = await handleResponse<BackendSession>(response);
    
    // Use id or session_id (backend returns id)
    const sid = backendSession.id || backendSession.session_id || sessionId;
    const sessionStatus = backendSession.state || backendSession.status || 'created';
    
    // Map backend format to frontend format
    return {
      id: sid,
      name: backendSession.name || backendSession.config?.experiment_name || `Analysis ${sid.slice(0, 8)}`,
      description: '',
      status: mapBackendStatus(sessionStatus),
      currentStep: null,
      progress: sessionStatus === 'completed' ? 100 : 0,
      config: {
        name: backendSession.config?.experiment_name || '',
        description: '',
        template: 'protein-pairwise',
        conditions: backendSession.config?.conditions || [],
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
      },
      createdAt: backendSession.created_at,
      updatedAt: backendSession.updated_at,
      completedAt: backendSession.completed_at,
      errorMessage: backendSession.error_message,
      uploadedFiles: [],
      compoundFile: null,
      results: sessionStatus === 'completed' ? {} : null,
    };
  },

  /**
   * Update session configuration
   */
  updateConfig: async (sessionId: string, config: SessionConfig): Promise<Session> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/config?_t=${Date.now()}`), {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(config),
      credentials: 'omit',
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
      await handleResponse<never>(response);
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
      await handleResponse<never>(response);
    }
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
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
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
    const response = await fetch(apiUrl(`/sessions/${sessionId}/analysis/status`));
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
          { id: 'human', name: 'Human', display_name: 'Human (Homo sapiens)' },
          { id: 'mouse', name: 'Mouse', display_name: 'Mouse (Mus musculus)' },
          { id: 'rat', name: 'Rat', display_name: 'Rat (Rattus norvegicus)' },
          { id: 'zebrafish', name: 'Zebrafish', display_name: 'Zebrafish (Danio rerio)' },
          { id: 'fly', name: 'Fruit Fly', display_name: 'Fruit Fly (Drosophila melanogaster)' },
          { id: 'yeast', name: 'Yeast', display_name: 'Yeast (Saccharomyces cerevisiae)' },
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
    } catch (error) {
      // Fallback to default organisms on error
      return [
        { id: 'human', name: 'Human', display_name: 'Human (Homo sapiens)' },
        { id: 'mouse', name: 'Mouse', display_name: 'Mouse (Mus musculus)' },
        { id: 'rat', name: 'Rat', display_name: 'Rat (Rattus norvegicus)' },
        { id: 'zebrafish', name: 'Zebrafish', display_name: 'Zebrafish (Danio rerio)' },
        { id: 'fly', name: 'Fruit Fly', display_name: 'Fruit Fly (Drosophila melanogaster)' },
        { id: 'yeast', name: 'Yeast', display_name: 'Yeast (Saccharomyces cerevisiae)' },
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
  generate: async (sessionId: string): Promise<{ status: string; report_id: string }> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/export`), {
      method: 'POST',
    });
    return handleResponse<{ status: string; report_id: string }>(response);
  },

  /**
   * Download PDF report
   */
  download: async (sessionId: string, reportId: string): Promise<Blob> => {
    const response = await fetch(apiUrl(`/sessions/${sessionId}/download`));
    if (!response.ok) {
      await handleResponse<never>(response);
    }
    return response.blob();
  },
};
