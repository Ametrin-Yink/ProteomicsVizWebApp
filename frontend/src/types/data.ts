/**
 * Data Types
 * 
 * Defines all TypeScript types related to proteomics data structures.
 */

// PSM (Peptide-Spectrum Match) data row
export interface PSMData {
  // Required columns
  'File ID': string;
  'Peptide': string;
  'Protein': string;
  'Master Protein Accessions': string;
  'Gene': string;
  'Description': string;
  'Abundance F1 Sample': number;
  'Abundance F2 Sample': number;
  'Abundance F3 Sample': number;
  
  // Optional columns
  'Confidence': string;
  'Identifying Node': string;
  'PSM Ambiguity': string;
  'Isolation Interference [%]': number;
  'Ion Inject Time [ms]': number;
  'RT [min]': number;
  'Mass [Da]': number;
  'Charge': number;
  'DeltaMass [ppm]': number;
  
  // Additional abundance columns (dynamic)
  [key: `Abundance F${number} Sample`]: number | undefined;
}

// Protein data after aggregation
export interface ProteinData {
  proteinId: string;
  geneSymbol: string;
  proteinName: string;
  description: string;
  
  // Abundance values per sample
  abundances: Record<string, number>; // sampleId -> abundance
  
  // Statistics
  meanAbundance: number;
  stdAbundance: number;
  cv: number; // Coefficient of variation
}

// Sample information
export interface Sample {
  id: string;
  name: string;
  condition: string;
  replicate: number;
  fileId: string;
  totalPSMs: number;
  uniquePeptides: number;
}

// Condition group
export interface Condition {
  id: string;
  name: string;
  color: string;
  samples: Sample[];
  replicateCount: number;
}

// Volcano plot data point
export interface VolcanoPoint {
  proteinId: string;
  geneSymbol: string;
  log2FoldChange: number;
  pValue: number;
  negLog10PValue: number;
  significant: boolean;
  regulation: 'up' | 'down' | 'none';
}

// Differential expression result row
export interface DEResult {
  proteinId: string;
  geneSymbol: string;
  proteinName: string;
  log2FoldChange: number;
  pValue: number;
  adjustedPValue: number;
  significant: boolean;
  
  // Mean abundances per condition
  meanAbundanceA: number;
  meanAbundanceB: number;
  
  // Additional statistics
  tStatistic: number;
  bStatistic: number | null;
  seLog2FC: number;
  df: number;
}

// PCA result
export interface PCAResult {
  samples: PCASample[];
  components: PCAComponent[];
  explainedVariance: number[];
}

// PCA sample projection
export interface PCASample {
  sampleId: string;
  condition: string;
  replicate: number;
  pc1: number;
  pc2: number;
  pc3?: number;
}

// PCA component (eigenvector)
export interface PCAComponent {
  id: number;
  proteinContributions: Record<string, number>; // proteinId -> contribution
}

// Correlation matrix
export interface CorrelationMatrix {
  sampleIds: string[];
  matrix: number[][]; // correlation values
}

// GSEA result row
export interface GSEAResultRow {
  pathwayId: string;
  pathwayName: string;
  database: string;
  
  // Enrichment statistics
  es: number; // Enrichment score
  nes: number; // Normalized enrichment score
  pvalue: number;
  fdr: number;
  
  // Leading edge
  leadingEdgeSize: number;
  leadingEdgeGenes: string[];
  
  // Additional info
  matchedGenes: number;
  totalGenes: number;
}

// File validation result
export interface FileValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  parsedData?: PSMData[];
  metadata?: FileMetadata;
}

// Validation error
export interface ValidationError {
  code: string;
  message: string;
  row?: number;
  column?: string;
}

// Validation warning
export interface ValidationWarning {
  code: string;
  message: string;
  row?: number;
  column?: string;
}

// File metadata
export interface FileMetadata {
  filename: string;
  rowCount: number;
  columnCount: number;
  conditions: string[];
  replicates: number;
  sampleColumns: string[];
  hasRequiredColumns: boolean;
  missingColumns: string[];
}

// Upload progress
export interface UploadProgress {
  fileId: string;
  filename: string;
  loaded: number;
  total: number;
  percentage: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
}

// Data summary statistics
export interface DataSummary {
  totalProteins: number;
  totalPeptides: number;
  totalPSMs: number;
  conditionCount: number;
  replicateCount: number;
  sampleCount: number;
  
  // Quality metrics
  missingValuePercentage: number;
  averagePeptidesPerProtein: number;
  averagePSMsPerPeptide: number;
}

// Filter criteria
export interface FilterCriteria {
  minPeptides: number;
  minSamples: number;
  maxMissingPercentage: number;
  removeContaminants: boolean;
  removeReverse: boolean;
}

// Normalization method
export type NormalizationMethod = 
  | 'none'
  | 'median'
  | 'mean'
  | 'quantile'
  | 'vsn';

// Imputation method
export type ImputationMethod =
  | 'none'
  | 'knn'
  | 'min'
  | 'median'
  | 'zero';

// Statistical test
export type StatisticalTest =
  | 't-test'
  | 'limma'
  | 'welch'
  | 'paired';

// Multiple testing correction
export type MultipleTestingCorrection =
  | 'bonferroni'
  | 'fdr'
  | 'holm'
  | 'none';

// Plot data types
export interface PlotData {
  type: 'volcano' | 'pca' | 'heatmap' | 'boxplot' | 'gsea';
  title: string;
  data: unknown;
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

// Export format
export type ExportFormat = 'csv' | 'tsv' | 'xlsx' | 'pdf';

// Data export request
export interface DataExportRequest {
  sessionId: string;
  dataType: 'protein_abundance' | 'de_results' | 'qc_metrics' | 'gsea';
  format: ExportFormat;
  filters?: Record<string, unknown>;
}
