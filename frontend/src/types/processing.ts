/**
 * Processing pipeline types
 * Following AGENTS/11-websocket-protocol.md and AGENTS/10-processing-pipeline.md
 */

export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'error';
export type LogLevel = 'info' | 'warning' | 'error';
export type WSMessageType = 'subscribe' | 'progress' | 'complete' | 'error' | 'log' | 'ping' | 'pong';

export interface ProcessingStep {
  id: number;
  name: string;
  description: string;
  status: StepStatus;
  progress: number; // 0-100
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
  steps: ProcessingStep[];
  logs: LogEntry[];
  overallProgress: number;
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
  session_id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  current_step: number;
  overall_progress: number;
  steps: ProcessingStep[];
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

// Step definitions for the 9-step pipeline
export const PROCESSING_STEPS: Omit<ProcessingStep, 'status' | 'progress' | 'message'>[] = [
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
    description: 'Aggregate peptide abundances to protein level using msqrob2',
    package: 'R/msqrob2',
    function: 'aggregateFeatures()',
  },
  {
    id: 7,
    name: 'Differential Expression Analysis',
    description: 'Perform differential expression analysis using msqrob2',
    package: 'R/msqrob2',
    function: 'msqrob()',
  },
  {
    id: 8,
    name: 'Calculate QC Metrics',
    description: 'Compute quality control metrics and PCA',
    package: 'Python',
    function: 'sklearn.decomposition.PCA',
  },
  {
    id: 9,
    name: 'Perform GSEA Analysis',
    description: 'Run Gene Set Enrichment Analysis using gseapy',
    package: 'Python/gseapy',
    function: 'gp.prerank()',
  },
];
