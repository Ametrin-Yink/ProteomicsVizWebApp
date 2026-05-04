/**
 * Core TypeScript types for the Proteomics Visualization Web App
 */

// ============================================================================
// API Types
// ============================================================================

export interface ApiResponse<T> {
  data: T;
  meta: {
    timestamp: string;
    request_id: string;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    request_id: string;
  };
}

// ============================================================================
// Session Types
// ============================================================================

export interface Session {
  id: string;
  name: string;
  description: string;
  status: string;
  currentStep: string | null;
  progress: number;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  uploadedFiles: unknown[];
  compoundFile: unknown | null;
  results: unknown;
}

export interface SessionConfig {
  treatment: string;
  control: string;
  organism: string;
  remove_razor: boolean;
  strict_filtering: boolean;
  // Multi-condition
  comparisons?: Array<{ treatment: string; control: string }>;
  metadata_columns?: Record<string, Record<string, string>>;
  // MSstats
  msstats_normalization?: string;
  msstats_feature_selection?: string;
  msstats_summary_method?: string;
  msstats_impute?: boolean;
  msstats_log_base?: number;
  msstats_censored_int?: string;
  msstats_max_quantile?: number;
  msstats_remove50missing?: boolean;
  deqms_fit_method?: string;
}

export interface SessionFiles {
  proteomics: string[];
  compound?: string;
}

// ============================================================================
// File Upload Types
// ============================================================================

export interface ParsedFilename {
  filename: string;
  experiment: string;
  condition: string;
  replicate: number;
  size: number;
  columns?: string[];
}

export interface UploadedFile {
  filename: string;
  experiment: string;
  condition: string;
  replicate: number;
  size: number;
  columns: string[];
}

export interface UploadProgress {
  filename: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface CompoundInfo {
  corp_id: string;
  smiles: string;
}

export interface CompoundFileData {
  filename: string;
  size: number;
  compounds: CompoundInfo[];
}

// ============================================================================
// Processing Types
// ============================================================================

export interface ProcessingStatus {
  state: 'idle' | 'running' | 'completed' | 'error';
  currentStep: number;
  stepName: string;
  progress: number;
  steps: StepStatus[];
  error?: string;
}

export interface StepStatus {
  step: number;
  name: string;
  status: 'pending' | 'started' | 'in_progress' | 'completed' | 'error';
  progress?: number;
}

export interface ProcessingLog {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  step?: number;
}

// ============================================================================
// Data Types
// ============================================================================

export interface DiffExpressionResult {
  master_protein_accessions: string;
  gene_name: string;
  log_fc: number;
  pval: number;
  adj_pval: number;
  significant: boolean;
}

export interface QCData {
  pca?: {
    samples: string[];
    pc1: number[];
    pc2: number[];
    conditions: string[];
    pc1_variance: number;
    pc2_variance: number;
  };
  pvalue_distribution?: {
    bins: number[];
    counts: number[];
  };
  psm_cv?: Record<string, number[]>;
  intensity_distributions?: {
    psm: Record<string, Record<string, number[]>>;
    protein: Record<string, number[]>;
  };
  data_completeness?: Record<string, { missing: number; present: number }>;
}

export interface PCAPoint {
  sample: string;
  pc1: number;
  pc2: number;
  condition: string;
}

export interface GSEAResult {
  term: string;
  name: string;
  es: number;
  nes: number;
  pval: number;
  fdr: number;
  lead_genes: string[];
  matched_genes: number;
}

// ============================================================================
// Organism Types
// ============================================================================

export interface Organism {
  id: string;
  name: string;
  display_name: string;
  available: boolean;
}

// ============================================================================
// UI Types
// ============================================================================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface ValidationWarning {
  type: 'error' | 'warning';
  message: string;
  code: string;
}

// ============================================================================
// Analysis Configuration Types
// ============================================================================

export interface AnalysisConfig {
  treatment: string;
  control: string;
  organism: string;
  remove_razor: boolean;
  strict_filtering: boolean;
}

export interface ExperimentValidation {
  isValid: boolean;
  warnings: ValidationWarning[];
  selectedFiles: ParsedFilename[];
  experiments: string[];
  conditions: string[];
  replicatesByCondition: Record<string, number>;
}
