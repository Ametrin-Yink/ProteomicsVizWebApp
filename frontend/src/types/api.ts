// API Types for Proteomics Visualization Web App

// Base response
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

// Session types
export interface Session {
  id: string;
  name: string;
  template: string;
  state: 'created' | 'configuring' | 'processing' | 'completed' | 'error';
  config?: SessionConfig;
  files?: SessionFiles;
  created_at: string;
  updated_at: string;
  markers?: string[];
  volcano_filters?: {
    foldChange: number;
    pValue: number;
    adjPValue: number;
    s0: number;
  };
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

// Differential Expression Results
export interface DEResult {
  master_protein_accessions: string;
  gene_name: string;
  log_fc: number;
  pval: number;
  adj_pval: number;
  se?: number | null;
  t_statistic?: number | null;
  significant: boolean;
  psm_count?: number;
}

export interface DEResultsData {
  total_proteins: number;
  significant_proteins: number;
  upregulated: number;
  downregulated: number;
  results: DEResult[];
}

// QC Data Types
export interface PCAData {
  samples: string[];
  pc1: number[];
  pc2: number[];
  conditions: string[];
  pc1_variance: number;
  pc2_variance: number;
}

export interface PValueDistribution {
  bins: number[];
  counts: number[];
}

export interface PSMCV {
  [condition: string]: number[];
}

export interface IntensityDistributions {
  psm: {
    [condition: string]: {
      [replicate: string]: number[];
    };
  };
  protein: {
    [condition: string]: number[];
  };
}

export interface DataCompleteness {
  [sample: string]: {
    missing: number;
    present: number;
  };
}

export interface QCData {
  pca?: PCAData;
  pvalue_distribution?: PValueDistribution;
  psm_cv?: PSMCV;
  protein_cv?: PSMCV; // Protein CV variance
  intensity_distributions?: IntensityDistributions;
  data_completeness?: DataCompleteness;
  psm_completeness?: DataCompleteness; // PSM level completeness
  // Summary statistics
  total_psms?: number;
  avg_psms_per_sample?: number;
  total_proteins?: number;
  avg_proteins_per_sample?: number;
  average_cv?: number;
  average_protein_cv?: number;
  average_psm_cv?: number;
  completeness_rate?: number;
}

// Transformed row-based types for Plotly
export interface PCAPoint {
  sample: string;
  pc1: number;
  pc2: number;
  condition: string;
}

// GSEA Types
export interface GSEAResult {
  term: string;
  name: string;
  es: number;
  nes: number;
  pval: number;
  fdr: number;
  lead_genes: string[];
  matched_genes: number;
  pathway_gene_set_size?: number; // Total genes in GMT gene set (from plot endpoint)
  // Running enrichment score curve data for plotting
  running_es_curve?: Array<[number, number]>; // [rank, es] tuples
  rank_metric_positions?: Array<[string, number, number]>; // [gene_name, rank, metric_value]
  // CRIT-005: Heatmap data for leading edge genes
  heatmap_data?: {
    genes: string[];
    samples: string[];
    z_scores: number[][];
  };
}

export interface GSEAData {
  database: string;
  total_pathways: number;
  significant_pathways: number;
  overrepresented: number;
  underrepresented: number;
  results: GSEAResult[];
}

export interface GSEAPlotData {
  term: string;
  es: number;
  nes: number;
  running_es_curve: Array<[number, number]>;
  rank_metric_positions: Array<[string, number, number]>;
  pathway_gene_set_size?: number;
}

export interface GSEAHeatmapData {
  genes: string[];
  samples: string[];
  z_scores: number[][];
}

export type GSEADatabase = 'go_bp' | 'go_mf' | 'go_cc' | 'kegg' | 'reactome';

export const GSEADatabaseLabels: Record<GSEADatabase, string> = {
  go_bp: 'GO Biological Process',
  go_mf: 'GO Molecular Function',
  go_cc: 'GO Cellular Component',
  kegg: 'KEGG',
  reactome: 'Reactome',
};

// Protein Abundance
export interface ProteinAbundance {
  samples: string[];
  abundances: number[];
  conditions: string[];
}

// Peptide Abundance
export interface PeptideAbundance {
  peptide_id: string;
  sequence: string;
  abundances: number[];
  samples: string[];
}

export interface PeptideAbundanceData {
  peptides: PeptideAbundance[];
}

// Volcano Plot Filters
export interface VolcanoFilters {
  foldChange: number;
  pValue: number;
  adjPValue: number;
  s0: number; // Fraction of foldChange threshold (0-1). S0=0 → rectangular, S0>0 → hyperbolic.
}

// Table Sort Config
export interface SortConfig {
  key: string;
  direction: 'asc' | 'desc';
}

// Pagination Config
export interface PaginationConfig {
  page: number;
  perPage: number;
  total: number;
}

// WebSocket Types
export type WebSocketMessageType = 
  | 'session_update'
  | 'progress_update'
  | 'processing_complete'
  | 'processing_error'
  | 'upload_progress';

// Base WebSocket message
export interface WebSocketMessage {
  type: WebSocketMessageType;
  timestamp: string;
}

// Session update message
export interface SessionUpdateMessage extends WebSocketMessage {
  type: 'session_update';
  sessionId: string;
  status: string;
  currentStep: string | null;
  progress: number;
  message: string;
}

// Progress update message
export interface ProgressUpdateMessage extends WebSocketMessage {
  type: 'progress_update';
  sessionId: string;
  step: string;
  progress: number;
  details?: Record<string, unknown>;
}

// Processing complete message
export interface ProcessingCompleteMessage extends WebSocketMessage {
  type: 'processing_complete';
  sessionId: string;
  results: Record<string, unknown>;
}

// Processing error message
export interface ProcessingErrorMessage extends WebSocketMessage {
  type: 'processing_error';
  sessionId: string;
  error: string;
  step: string;
}

// Upload progress message
export interface UploadProgressMessage extends WebSocketMessage {
  type: 'upload_progress';
  fileId: string;
  sessionId: string;
  loaded: number;
  total: number;
  percentage: number;
}

// Union type for all WebSocket messages
export type WebSocketMessageUnion =
  | SessionUpdateMessage
  | ProgressUpdateMessage
  | ProcessingCompleteMessage
  | ProcessingErrorMessage
  | UploadProgressMessage;
