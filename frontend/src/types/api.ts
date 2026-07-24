// API Types for Proteomics Visualization Web App

// Re-export canonical types from types/index.ts
export type { ApiResponse, ApiError, SessionConfig } from './index';

// Session types

export interface SessionFiles {
  proteomics: string[];
}

export type VisualizationDataScope = 'ptm' | 'protein' | 'adjusted_ptm';

export interface VisualizationModuleCapability {
  id: string;
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  data_scopes: VisualizationDataScope[];
}

export interface VisualizationManifest {
  pipeline: string;
  default_module: string;
  modules: VisualizationModuleCapability[];
  schema_version: number | null;
  current_schema_version: number;
  supported: boolean;
  requires_reprocessing: boolean;
  normalization_method: string | null;
  imputation_method: string | null;
  abundance_scale: 'log2' | null;
}

export type PTMResultLayer = 'ptm' | 'protein' | 'adjusted';

export interface PTMComparisonData {
  label: string;
  ptm_model: Record<string, unknown>[];
  protein_model: Record<string, unknown>[];
  adjusted_model: Record<string, unknown>[];
}

export interface PTMComparisonSummary {
  comparisons: string[];
  matrix: Array<Array<number | null>>;
  pairs: Array<{
    left: string;
    right: string;
    matched: number;
    correlation: number | null;
  }>;
  available_for_all: boolean;
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
  protein_accessions: string[];
  samples: string[];
  conditions: string[];
  replicates: Array<string | null>;
  z_scores: Array<Array<number | null>>;
  log2_abundances: Array<Array<number | null>>;
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

export interface AbundanceGroup {
  condition: string;
  observation_count: number;
  q1: number;
  median: number;
  q3: number;
  lower_fence: number;
  upper_fence: number;
  observed_count: number;
  imputed_count: number;
  model_estimated_count: number;
  imputation_fraction: number;
}

export interface VisualizationComparisonCatalogItem {
  comparison_id: string;
  display_label: string;
  group1_label: string;
  group2_label: string;
  group1_sample_count: number;
  group2_sample_count: number;
  result_status: string;
  tested_count: number;
  significant_count: number;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

/**
 * Group-level QC summary from qc_group_metrics.parquet.
 *
 * Artifact: qc_group_metrics.parquet
 * Each row is a group (condition or batch) with abundance quartiles, CV
 * distribution summary, and IQR-based fences for boxplot whiskers.
 */
export interface QCGroupSummary {
  /** Grouping dimension: 'condition' | 'batch' */
  group_by: string;
  /** Group value (e.g. condition name or batch label) */
  group_value: string;
  /** Number of samples in this group */
  sample_count: number;
  /** Total abundance observations (may include repeats across features) */
  observation_count: number;
  /** First quartile of log2 abundances */
  q1: number;
  /** Median log2 abundance */
  median: number;
  /** Third quartile of log2 abundances */
  q3: number;
  /** Number of observed (non-imputed) feature counts across samples */
  observed_count: number;
  /** Number of imputed feature counts across samples */
  imputed_count: number;
  /** Number of missing feature counts across samples */
  missing_count: number;
  /** Number of proteins with >=2 observations used for CV calculation */
  protein_cv_count?: number | null;
  /** First quartile of protein-level CV values (%) */
  protein_cv_q1?: number | null;
  /** Median protein-level CV (%) */
  protein_cv_median?: number | null;
  /** Third quartile of protein-level CV values (%) */
  protein_cv_q3?: number | null;
  /** Number of peptides with >=2 observations used for CV calculation */
  peptide_cv_count?: number | null;
  /** First quartile of peptide/PSM-level CV values (%) */
  peptide_cv_q1?: number | null;
  /** Median peptide/PSM-level CV (%) */
  peptide_cv_median?: number | null;
  /** Third quartile of peptide/PSM-level CV values (%) */
  peptide_cv_q3?: number | null;
  /** Clamped IQR-based lower fence for abundance boxplots (from qc_group_metrics.parquet). */
  lowerfence?: number | null;
  /** Clamped IQR-based upper fence for abundance boxplots (from qc_group_metrics.parquet). */
  upperfence?: number | null;
}

export interface QCOverviewData {
  group_by: string;
  groups: QCGroupSummary[];
  next_cursor: string | null;
  group_count: number;
  matching_group_count: number;
  pca: Array<{
    sample_id: string;
    pc1: number;
    pc2: number;
    condition: string;
  }>;
  normalization_method: string;
  imputation_method: string;
  abundance_scale: 'log2';
  pca_method?: 'exact' | 'incremental' | 'unavailable' | null;
  pc1_variance?: number | null;
  pc2_variance?: number | null;
}

export interface QCSampleMetric {
  sample_id: string;
  condition: string;
  replicate: string | null;
  batch: string | null;
  total_feature_count: number;
  present_count: number;
  missing_count: number;
  observed_feature_count: number;
  imputed_feature_count: number;
  imputation_fraction: number | null;
  median_log2_abundance: number | null;
}

export interface QCDifferentialData {
  comparison_id: string;
  tested_count: number;
  significant_count: number;
  failed_count: number;
  pvalue_distribution: PValueDistribution;
}

/**
 * Per-sample protein intensity boxplot statistics.
 *
 * Artifact: qc_sample_metrics.parquet
 * Computed from protein_abundance_long.parquet grouped by sample_id.
 */
export interface QCProteinIntensity {
  /** Sample identifier */
  sample_id: string;
  /** Condition this sample belongs to */
  condition: string;
  /**
   * First quartile of protein log2 abundances (NULL if no data).
   *
   * Uses the ``abundance_*`` prefix (instead of bare ``q1``/``median``/``q3``)
   * to disambiguate from {@link QCPSMIntensity}, which uses the same Parquet
   * column names (``q1``, ``median``, ``q3``) but sources them from a different
   * artifact (``qc_psm_intensity.parquet`` vs ``qc_sample_metrics.parquet``).
   * The frontend {@link buildIntensityBoxTraces} normalises both shapes into a
   * common ``{ condition, q1, median, q3 }`` interface at the call site.
   */
  abundance_q1: number | null;
  /** Median protein log2 abundance (NULL if no data) */
  abundance_median: number | null;
  /** Third quartile of protein log2 abundances (NULL if no data) */
  abundance_q3: number | null;
}

/**
 * Per-(condition, replicate, result_layer) PSM intensity boxplot statistics.
 *
 * Artifact: qc_psm_intensity.parquet
 * Computed from peptide_abundance_long.parquet grouped by
 * (result_layer, condition, replicate).
 */
export interface QCPSMIntensity {
  /** Condition name */
  condition: string;
  /** Replicate identifier within the condition */
  replicate: string;
  /** Pipeline data layer: 'protein' | 'ptm' | 'adjusted_ptm' */
  result_layer: string;
  /** Number of samples contributing to this group */
  sample_count: number;
  /** First quartile of PSM log2 intensities (NULL if no data) */
  q1: number | null;
  /** Median PSM log2 intensity (NULL if no data) */
  median: number | null;
  /** Third quartile of PSM log2 intensities (NULL if no data) */
  q3: number | null;
}

/**
 * Per-sample completeness row.
 *
 * Artifact: qc_sample_metrics.parquet (protein-level) or
 *           qc_psm_completeness.parquet (PSM-level).
 *
 * For protein completeness, total/present/missing refer to the
 * number of distinct protein accessions. For PSM completeness,
 * they refer to distinct peptide IDs.
 */
export interface QCCompletenessRow {
  /** Sample identifier */
  sample_id: string;
  /** Condition this sample belongs to */
  condition: string;
  /** Total number of features expected */
  total: number;
  /** Number of features with non-null abundance */
  present: number;
  /** Number of features with null abundance (total - present) */
  missing: number;
}

/**
 * Aggregated per-sample QC data from /visualization/qc/per-sample.
 *
 * Combines four arrays sourced from two Parquet artifacts:
 * - protein_intensity:   qc_sample_metrics.parquet (per-sample abundance quartiles)
 * - protein_completeness: qc_sample_metrics.parquet (per-sample protein detection)
 * - psm_completeness:    qc_psm_completeness.parquet (per-sample PSM detection)
 * - psm_intensity:       qc_psm_intensity.parquet (per-group PSM boxplot stats)
 */
export interface QCPerSampleData {
  /** Per-sample protein intensity quartiles (from qc_sample_metrics.parquet) */
  protein_intensity: QCProteinIntensity[];
  /** Per-sample protein completeness counts (from qc_sample_metrics.parquet) */
  protein_completeness: QCCompletenessRow[];
  /** Per-sample PSM completeness counts (from qc_psm_completeness.parquet) */
  psm_completeness: QCCompletenessRow[];
  /** Per-(condition, replicate) PSM intensity stats (from qc_psm_intensity.parquet) */
  psm_intensity: QCPSMIntensity[];
}

/** Box-plot statistics shape (matches backend QCCalculator._compute_box_stats). */
export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  lowerfence: number;
  upperfence: number;
  outliers?: number[];
}

export interface AbundancePoint {
  sample_id: string;
  condition: string;
  replicate: string | null;
  batch: string | null;
  peptide_id?: string;
  processed_log2_abundance: number;
  provenance: 'observed' | 'imputed' | 'model_estimated';
}

export interface ProcessedAbundanceData {
  protein_accession: string;
  comparison_id: string;
  result_layer: string;
  scale: 'log2';
  normalization_method: string;
  imputation_method: string;
  groups: AbundanceGroup[];
  points: AbundancePoint[];
  point_count: number;
  points_truncated: boolean;
}

export type ProteinAbundance = ProcessedAbundanceData;
export type PeptideAbundanceData = ProcessedAbundanceData;

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
  status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled';
  error?: string;
  started_at?: string;
  completed_at?: string;
  progress?: { completed: number; total: number };
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

export interface ComparisonCorrelationMetadata {
  schema_version: number;
  cache_key: string;
  status: 'completed';
  method: 'pearson';
  min_support: number;
  comparison_count: number;
  feature_count: number;
  block_size: number;
  tile_size: number;
  max_level: number;
  embedding: Array<{ comparison_id: string; x: number; y: number }>;
}

export interface ComparisonCorrelationTile {
  level: number;
  row: number;
  column: number;
  factor: number;
  aggregation: 'exact' | 'mean';
  row_start: number;
  column_start: number;
  correlations: Array<Array<number | null>>;
  support_counts: number[][];
}

export interface ComparisonCorrelationLookupItem {
  comparison_id: string;
  correlation: number;
  support_count: number;
}

export interface ComparisonCorrelationLookup {
  comparison_id: string;
  nearest: ComparisonCorrelationLookupItem[];
  least_correlated: ComparisonCorrelationLookupItem[];
}

export interface ComparisonSpearmanResult {
  left_comparison: string;
  right_comparison: string;
  method: 'spearman';
  correlation: number | null;
  support_count: number;
  sufficient_support: boolean;
}

export interface ComparisonFoldChangeDetail {
  proteins: Array<{ accession: string; gene_name: string | null }>;
  comparisons: string[];
  fold_changes: Array<Array<number | null>>;
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
  type?: 'ptm_enrichment' | 'global_proteome' | 'fasta';
  columns?: string[];
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
