/**
 * Session Types
 * 
 * Defines all TypeScript types related to analysis sessions.
 * Sessions represent a complete proteomics analysis workflow.
 */

// Session status in the processing pipeline
export type SessionStatus = 
  | 'created'
  | 'uploading'
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled';

// Processing step in the 9-step pipeline
export type ProcessingStep =
  | 'combine_replicates'
  | 'generate_unique_psm'
  | 'remove_razor'
  | 'remove_low_quality'
  | 'filter_criteria'
  | 'protein_abundance'
  | 'differential_expression'
  | 'qc_metrics'
  | 'gsea_analysis'
  | null;

// Analysis configuration for a session
export interface AnalysisConfig {
  name: string;
  description: string;
  template: AnalysisTemplate;
  conditions: string[];
  replicates: Record<string, string[]>; // condition -> replicate IDs
  parameters: AnalysisParameters;
}

// Available analysis templates
export type AnalysisTemplate =
  | 'pairwise_comparison'
  | 'time_series'
  | 'multi_condition'
  | 'custom';

// Analysis parameters
export interface AnalysisParameters {
  // Filtering parameters
  minPeptides: number;
  minSamples: number;
  
  // Statistical parameters
  log2FoldChangeThreshold: number;
  pValueThreshold: number;
  
  // GSEA parameters
  gseaDatabase: string;
  gseaMinSize: number;
  gseaMaxSize: number;
  
  // QC parameters
  pcaComponents: number;
  
  // Advanced parameters
  normalizationMethod: 'none' | 'median' | 'quantile';
  imputationMethod: 'none' | 'knn' | 'min';
}

// Session metadata
export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  currentStep: ProcessingStep;
  progress: number; // 0-100
  config: AnalysisConfig;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  
  // File references
  uploadedFiles: UploadedFile[];
  compoundFile: CompoundFile | null;
  
  // Results
  results: SessionResults | null;
}

// Uploaded file metadata
export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  mimeType: string;
  condition: string;
  replicate: number;
  uploadedAt: string;
}

// Compound file (combined replicates)
export interface CompoundFile {
  id: string;
  filename: string;
  size: number;
  rowCount: number;
  columnCount: number;
  createdAt: string;
}

// Session results
export interface SessionResults {
  proteinAbundance: ProteinAbundanceResult | null;
  differentialExpression: DifferentialExpressionResult | null;
  qcMetrics: QCMetricsResult | null;
  gsea: GSEAResult | null;
}

// Protein abundance result
export interface ProteinAbundanceResult {
  filePath: string;
  proteinCount: number;
  sampleCount: number;
  createdAt: string;
}

// Differential expression result
export interface DifferentialExpressionResult {
  comparisons: DEComparison[];
  totalProteins: number;
  significantProteins: number;
}

// DE comparison
export interface DEComparison {
  id: string;
  conditionA: string;
  conditionB: string;
  upregulated: number;
  downregulated: number;
  unchanged: number;
  filePath: string;
}

// QC metrics result
export interface QCMetricsResult {
  pcaPlot: string | null; // Base64 or URL
  correlationPlot: string | null;
  sampleQuality: SampleQuality[];
}

// Sample quality metrics
export interface SampleQuality {
  sampleId: string;
  condition: string;
  replicate: number;
  totalProteins: number;
  missingValues: number;
  correlationScore: number;
}

// GSEA result
export interface GSEAResult {
  database: string;
  pathways: GSEAPathway[];
  plot: string | null; // Base64 or URL
}

// GSEA pathway
export interface GSEAPathway {
  id: string;
  name: string;
  es: number; // Enrichment score
  nes: number; // Normalized enrichment score
  pvalue: number;
  fdr: number;
  leadingEdge: string[];
}

// Session creation request
export interface CreateSessionRequest {
  name: string;
  template: AnalysisTemplate;
}

// Session update request
export interface UpdateSessionRequest {
  name?: string;
  config?: Partial<AnalysisConfig>;
}

// Session list response
export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

// Session state for Zustand store
export interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
}

// Session actions for Zustand store
export interface SessionActions {
  setSessions: (sessions: Session[]) => void;
  loadSessions: () => Promise<void>;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  deleteSessions: (ids: string[]) => void;
  setCurrentSession: (session: Session | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  updateSessionProgress: (sessionId: string, progress: number, currentStep: string | null) => void;
  updateSessionStatus: (sessionId: string, status: Session['status']) => void;
  reset: () => void;
}

// WebSocket session update message
export interface SessionUpdateMessage {
  type: 'session_update';
  sessionId: string;
  status: SessionStatus;
  currentStep: ProcessingStep;
  progress: number;
  message: string;
}

// Condition group
export interface Condition {
  id: string;
  name: string;
  color: string;
  samples: Array<{
    id: string;
    name: string;
    condition: string;
    replicate: number;
    fileId: string;
  }>;
  replicateCount: number;
}
