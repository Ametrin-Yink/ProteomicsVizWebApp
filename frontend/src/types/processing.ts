/**
 * Processing pipeline types
 * Following AGENTS/11-websocket-protocol.md and AGENTS/10-processing-pipeline.md
 */

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'error' | 'cancelled';
export type LogLevel = 'info' | 'warning' | 'error';
export type WSMessageType = 'subscribe' | 'progress' | 'complete' | 'error' | 'log' | 'ping' | 'pong';

export interface ProcessingStepDef {
  id: number;
  name: string;
  description: string;
  status: StepStatus;
  progress?: number; // 0-100 (legacy — no longer rendered by UI)
  message?: string;
  moduleName: string;
  method: string;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  step?: number;
}

export interface ProcessingState {
  steps: ProcessingStepDef[];
  logs: LogEntry[];
  isConnected: boolean;
  isComplete: boolean;
  error: ProcessingError | null;
  sessionId: string | null;
}

export interface ProcessingError {
  step: number;
  stepName: string;
  message: string;
  recoverable: boolean;
  suggestion?: string;
}

// WebSocket Message Types
export interface WSMessage {
  type: WSMessageType;
  timestamp: string;
  payload: unknown;
}

export interface SubscribeMessage {
  type: 'subscribe';
  payload: {
    session_id: string;
  };
}

export interface ProgressMessage {
  type: 'progress';
  payload: {
    step: number;
    step_name: string;
    status: 'started' | 'in_progress' | 'completed';
    progress: number;
    message?: string;
    overall_progress: number;
  };
}

export interface CompleteMessage {
  type: 'complete';
  payload: {
    session_id: string;
    outputs?: {
      psm_abundances: string;
      protein_abundances: string;
      diff_expression: string;
      qc_results: string;
      gsea_results: string;
    };
    duration: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  payload: {
    step: number;
    step_name: string;
    error: string;
    recoverable: boolean;
    suggestion?: string;
  };
}

export interface LogMessage {
  type: 'log';
  payload: {
    level: LogLevel;
    message: string;
    step?: number;
    timestamp: string;
  };
}

// API Types
export interface ProcessingStatusResponse {
  session_id?: string;
  state: 'created' | 'configuring' | 'queued' | 'processing' | 'completed' | 'error' | 'cancelled';
  current_step?: number;
  overall_progress?: number;
  steps?: ProcessingStepDef[];
  queue_position?: number;
  queue_length?: number;
}

export interface StartProcessingRequest {
  session_id: string;
}

export interface StartProcessingResponse {
  success: boolean;
  message: string;
}

// Step definitions for the 6-stage pipeline (GSEA is on-demand, not a pipeline step)
export const PROCESSING_STEPS: Omit<ProcessingStepDef, 'status' | 'progress' | 'message'>[] = [
  {
    id: 1,
    name: 'Prepare and Filter PSMs',
    description: 'Apply input quality filters, join the experimental design, and prepare PSM abundances',
    moduleName: 'Python/DuckDB',
    method: 'Streaming SQL',
  },
  {
    id: 2,
    name: 'Resolve Shared Peptides',
    description: 'Assign shared PSMs to the best-supported protein when enabled',
    moduleName: 'Python/DuckDB',
    method: 'Distinct PSM ranking',
  },
  {
    id: 3,
    name: 'Filter Coverage and Protein Eligibility',
    description: 'Apply per-condition missingness and minimum distinct-PSM thresholds',
    moduleName: 'Python/DuckDB',
    method: 'Coverage filtering',
  },
  {
    id: 4,
    name: 'Protein Abundance',
    description: 'Normalize, handle missing values, and aggregate peptides to proteins',
    moduleName: '',
    method: '',
  },
  {
    id: 5,
    name: 'Differential Expression',
    description: 'Perform pipeline-specific statistical testing',
    moduleName: '',
    method: '',
  },
  {
    id: 6,
    name: 'QC Metrics',
    description: 'Compute quality control metrics and PCA',
    moduleName: 'Python',
    method: 'sklearn.decomposition.PCA',
  },
];
