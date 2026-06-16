// API Types for Proteomics Visualization Web App

// Re-export canonical types from types/index.ts
export type { ApiResponse, ApiError, SessionConfig } from './index';

// Session types

export interface SessionFiles {
  proteomics: string[];
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
  psm_boxplot: {
    [condition: string]: {
      [replicate: string]: number[];
    };
  };
  protein_boxplot: {
    [sample: string]: number[];
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
  pvalue_distributions?: Record<string, PValueDistribution>;
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
  total?: number;
  page?: number;
  page_size?: number;
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

export interface GSEARunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  comparison?: string;
  databases?: Record<string, 'pending' | 'running' | 'completed' | 'error'>;
  started_at?: string;
  error?: string | null;
}

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

// Compare Page Types

export type ClusterMethod = 'pca' | 'umap' | 'tsne';

export interface CompareRunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ProteinFCResult {
  comparison: string;
  log_fc: number;
  pval: number;
  adj_pval: number;
}

export interface SimilarProtein {
  accession: string;
  gene_name: string;
  similarity: number; // Euclidean distance (RMSD), lower = more similar
  fold_changes: Array<{ comparison: string; log_fc: number | null }>;
}

export interface ProteinClusterPoint {
  accession: string;
  gene_name: string;
  x: number;
  y: number;
  cluster_id?: number;
}

export interface ComparisonClusterPoint {
  comparison: string;
  x: number;
  y: number;
}

export interface ProteinCorrelationData {
  selected_protein_fc: ProteinFCResult[];
  similar_proteins: SimilarProtein[];
  cluster_coords: ProteinClusterPoint[];
  cluster_var_explained?: number[];
  color_fc_map?: Record<string, number>;
}

export interface VennOverlapDetail {
  accession: string;
  gene_name: string;
  [key: `log_fc_${string}`]: number | null | undefined;
  [key: `adj_pval_${string}`]: number | null | undefined;
}

export interface VennOverlap {
  region: string[];
  count: number;
  label: string;
  details: VennOverlapDetail[];
}

export interface VennData {
  sets: Record<string, string[]>;
  overlaps: VennOverlap[];
  set_sizes: Record<string, number>;
}

export interface ComparisonCorrelationData {
  similarity_matrix: {
    comparisons: string[];
    matrix: number[][];
  };
  heatmap_data: {
    proteins: Array<{ accession: string; gene_name: string }>;
    comparisons: string[];
    fold_changes: number[][];
  };
  comparison_similarities: Array<{ comparison: string; similarity: number }>;
  cluster_coords: ComparisonClusterPoint[];
  cluster_var_explained?: number[];
}

/** Protein list entry for selector dropdowns */
export interface ProteinListEntry {
  accession: string;
  gene_name: string;
}

// BioNet types
export interface BioNetRunRequest {
  comparison: string;
  pvalue_cutoff: number;       // NOTE: filters on adjusted p-value (adj.pvalue), not raw p-value
  logfc_cutoff: number;
  statement_types: string[];
  paper_count_cutoff: number;
  evidence_count_cutoff: number;
  correlation_cutoff: number | null;
  sources_filter: string[] | null;
}

export interface BioNetRunStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  comparison?: string;
  node_count?: number;
  edge_count?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface BioNetNode {
  id: string;         // UniProt accession (e.g. "P05023"), from Protein column
  logFC: number;
  pvalue: number;     // NOTE: this is the adjusted p-value (from adj.pvalue)
  hgncName: string;   // HGNC gene name for display labels
}

export interface BioNetEdge {
  source: string;     // UniProt accession of source node
  target: string;     // UniProt accession of target node
  interaction: string;
  evidenceCount: number;
  paperCount: number;
  evidenceLink: string;
  sourceCounts: Record<string, number>;
}

export interface BioNetSubnetwork {
  nodes: BioNetNode[];
  edges: BioNetEdge[];
}

// INDRA interaction statement types
export const INDRA_STATEMENT_TYPES = [
  'Activation',
  'Inhibition',
  'IncreaseAmount',
  'DecreaseAmount',
  'Complex',
  'Phosphorylation',
  'Dephosphorylation',
  'Ubiquitination',
  'Deubiquitination',
  'Acetylation',
  'Sumoylation',
  'Methylation',
  'Demethylation',
  'Hydroxylation',
  'Palmitoylation',
  'Myristoylation',
  'Farnesylation',
  'Geranylgeranylation',
  'GtpActivation',
  'GapActivation',
  'GefActivation',
  'Cleavage',
  'Degradation',
  'Translocation',
  'Transactivation',
  'SelfInteraction',
  'ActiveForm',
  'InactiveForm',
  'Binding',
] as const;

export type IndraStatementType = (typeof INDRA_STATEMENT_TYPES)[number];

// INDRA knowledge sources
export const INDRA_SOURCES = [
  'reach', 'medscan', 'sparser', 'trips',
  'rlimsp', 'geneways', 'tees', 'isi',
  'eidos', 'hume', 'sofia',
] as const;

export type IndraSource = (typeof INDRA_SOURCES)[number];

// PTM Types
export interface PTMUploadResponse {
  filename: string;
  size: number;
  type: 'ptm_enrichment' | 'global_proteome' | 'fasta';
}

export type PTMModelType = 'ptm' | 'protein' | 'adjusted';

export interface PTMDEResult {
  site: string;
  globalProtein: string;
  comparison: string;
  ptmLog2FC: number;
  ptmPvalue: number;
  ptmAdjPvalue: number;
  proteinLog2FC?: number;
  proteinPvalue?: number;
  proteinAdjPvalue?: number;
  adjustedLog2FC?: number;
  adjustedSE?: number;
  adjustedPvalue?: number;
  adjustedAdjPvalue?: number;
  isAdjusted: boolean;
}

export interface PTMSessionConfig {
  ptm_labeling_type: 'LF' | 'TMT';
  ptm_selected_mods: string[];
  ptm_fasta_file: string | null;
  ptm_global_proteome_files: string[];
}
