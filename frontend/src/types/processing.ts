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
  package: string;
  function: string;
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

// Step definitions for the 8-step pipeline (GSEA is on-demand, not a pipeline step)
export const PROCESSING_STEPS: Omit<ProcessingStepDef, 'status' | 'progress' | 'message'>[] = [
  {
    id: 1,
    name: 'Combine Replicates',
    description: 'Merge replicate data files into a single dataset',
    package: 'Python/Pandas',
    function: 'pd.concat()',
  },
  {
    id: 2,
    name: 'Generate Unique PSM',
    description: 'Create unique identifiers for each peptide-spectrum match',
    package: 'Python/Pandas',
    function: 'String concat',
  },
  {
    id: 3,
    name: 'Remove Razor Information',
    description: 'Filter out razor peptide assignments',
    package: 'Python',
    function: 'Custom logic',
  },
  {
    id: 4,
    name: 'Remove Low Quality PSM',
    description: 'Filter low-quality peptide-spectrum matches',
    package: 'Python/Pandas',
    function: 'Filtering',
  },
  {
    id: 5,
    name: 'Filter Based on Configuration',
    description: 'Apply user-defined filtering criteria',
    package: 'Python/Pandas',
    function: 'df.dropna()',
  },
  {
    id: 6,
    name: 'Calculate Protein Abundance',
    description: 'Normalize, impute, and aggregate peptides to proteins via QFeatures',
    package: '',
    function: '',
  },
  {
    id: 7,
    name: 'Differential Expression Analysis',
    description: 'Robust statistical testing via msqrob2 (M-estimation with empirical Bayes)',
    package: '',
    function: '',
  },
  {
    id: 8,
    name: 'Calculate QC Metrics',
    description: 'Compute quality control metrics and PCA',
    package: 'Python',
    function: 'sklearn.decomposition.PCA',
  },
];
