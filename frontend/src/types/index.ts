/**
 * Core TypeScript types for the Proteomics Visualization Web App
 */

// Re-export canonical Session type from session.ts
export type { Session } from './session';

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

export interface SessionConfig {
  treatment?: string;
  control?: string;
  organism: string;
  remove_razor: boolean;
  strict_filtering: boolean;
  // Pipeline derivation (deprecated — use file_type)
  pipeline?: 'msqrob2' | 'msstats' | 'ptm';
  // Analysis type
  file_type?: 'tmt' | 'dia';
  // TMT channel-to-condition mapping
  tmt_channel_mapping?: Record<string, Record<string, string | number>>;
  // Multi-condition
  comparisons?: Array<{
    group1: Record<string, string>;
    group2: Record<string, string>;
  }>;
  metadata_columns?: Record<string, Record<string, string>>;
  // Shared advanced params
  pvalue_threshold?: number;
  logfc_threshold?: number;
  min_peptides_per_protein?: number;
  // MSstats
  msstats_normalization?: string;
  msstats_feature_selection?: string;
  msstats_summary_method?: string;
  msstats_impute?: boolean;
  msstats_log_base?: number;
  msstats_censored_int?: string;
  msstats_max_quantile?: number;
  msstats_remove50missing?: boolean;
  // MSstats advanced
  msstats_n_top_feature?: number;
  msstats_min_feature_count?: number;
  msstats_remove_uninformative_feature_outlier?: boolean;
  msstats_equal_feature_var?: boolean;
  msstats_name_standards?: string;
  msstats_save_fitted_models?: boolean;
  msstats_n_cores?: number;
  // msqrob2
  msqrob2_normalization?: string;
  msqrob2_imputation?: string;
  msqrob2_aggregation?: string;
  msqrob2_model?: string;
  msqrob2_robust?: boolean;
  msqrob2_ridge?: boolean;
  msqrob2_adjust_method?: string;
  msqrob2_min_peptides?: number;
  msqrob2_n_cores?: number;
  // Condition column name (user-renamable, defaults to "condition")
  condition_column?: string;
  // Covariates
  covariate_columns?: string[];
  // Batch correction (msqrob2)
  msqrob2_batch_column?: string;
}

export interface SessionFiles {
  proteomics: string[];
}

// ============================================================================
// File Upload Types
// ============================================================================

export interface UploadedFileInfo {
  filename: string;
  size: number;
  columns?: string[];
  experiment: string;
  replicate: number;
  batch: string;
  file_type: 'tmt' | 'dia' | null;
  tmt_channels?: string[];
}

export interface FileDetectionResult {
  file_type: 'tmt' | 'dia';
  columns: string[];
  tmt_channels?: string[];
  warnings: string[];
}

export type AnalysisType = 'tmt' | 'dia' | 'ptm';

export interface UploadProgress {
  filename: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
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
  selectedFiles: UploadedFileInfo[];
  experiments: string[];
  conditions: string[];
  replicatesByCondition: Record<string, number>;
}
