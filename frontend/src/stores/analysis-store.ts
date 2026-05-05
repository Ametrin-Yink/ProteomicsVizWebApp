/**
 * Analysis store for managing data input and configuration state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type {
  ParsedFilename,
  CompoundFileData,
  UploadProgress,
  SessionConfig,
  ValidationWarning,
  ExperimentValidation,
  Organism,
} from '@/types';

// Enable MapSet plugin for Immer (required for using Set in state)
enableMapSet();

interface AnalysisState {
  // File upload state
  uploadedFiles: ParsedFilename[];
  uploadProgress: UploadProgress[];
  compoundFile: CompoundFileData | null;

  // Selection state
  selectedFiles: Set<string>;

  // Pipeline selection
  selectedPipeline: 'msqrob2' | 'msstats' | null;

  // Configuration state
  config: SessionConfig;

  // Organisms
  availableOrganisms: Organism[];

  // Loading states
  isUploading: boolean;
  isLoadingOrganisms: boolean;

  // Errors
  uploadError: string | null;

  // Actions
  addUploadedFile: (file: ParsedFilename) => void;
  removeUploadedFile: (filename: string) => void;
  setUploadProgress: (filename: string, progress: number, status: UploadProgress['status']) => void;
  setCompoundFile: (data: CompoundFileData | null) => void;
  toggleFileSelection: (filename: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  updateFileMetadata: (filename: string, updates: Partial<Pick<ParsedFilename, 'experiment' | 'condition'>>) => void;
  setPipeline: (pipeline: 'msqrob2' | 'msstats') => void;
  setConfig: (config: Partial<SessionConfig>) => void;
  setAvailableOrganisms: (organisms: Organism[]) => void;
  setIsUploading: (isUploading: boolean) => void;
  setIsLoadingOrganisms: (isLoading: boolean) => void;
  setUploadError: (error: string | null) => void;
  reset: () => void;
}

const defaultConfig: SessionConfig = {
  treatment: '',
  control: '',
  organism: '',
  pipeline: undefined,
  remove_razor: false,
  strict_filtering: false,
  pvalue_threshold: 0.05,
  logfc_threshold: 1.0,
  min_peptides_per_protein: 1,
  comparisons: [],
  metadata_columns: {},
  msstats_normalization: 'equalizeMedians',
  msstats_feature_selection: 'all',
  msstats_summary_method: 'TMP',
  msstats_impute: true,
  msstats_log_base: 2,
  msstats_censored_int: 'NA',
  msstats_max_quantile: 0.999,
  msstats_remove50missing: false,
  msstats_n_top_feature: 3,
  msstats_min_feature_count: 2,
  msstats_remove_uninformative_feature_outlier: false,
  msstats_equal_feature_var: true,
  msstats_name_standards: undefined,
  msstats_save_fitted_models: true,
  msstats_n_cores: 32,
  covariate_columns: [],
};

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    // Initial state
    uploadedFiles: [],
    uploadProgress: [],
    compoundFile: null,
    selectedFiles: new Set<string>(),
    selectedPipeline: null,
    config: { ...defaultConfig },
    availableOrganisms: [],
    isUploading: false,
    isLoadingOrganisms: false,
    uploadError: null,

    // Actions
    setPipeline: (pipeline) => {
      set((state) => {
        state.selectedPipeline = pipeline;
        state.config.pipeline = pipeline;
      });
    },

    addUploadedFile: (file) => {
      set((state) => {
        const exists = state.uploadedFiles.some((f: ParsedFilename) => f.filename === file.filename);
        if (!exists) {
          state.uploadedFiles.push(file);
          state.selectedFiles.add(file.filename);
        }
      });
    },
    
    removeUploadedFile: (filename) => {
      set((state) => {
        state.uploadedFiles = state.uploadedFiles.filter((f: ParsedFilename) => f.filename !== filename);
        state.selectedFiles.delete(filename);
        state.uploadProgress = state.uploadProgress.filter((p: UploadProgress) => p.filename !== filename);
      });
    },
    
    setUploadProgress: (filename, progress, status) => {
      set((state) => {
        const existing = state.uploadProgress.find((p: UploadProgress) => p.filename === filename);
        if (existing) {
          existing.progress = progress;
          existing.status = status;
        } else {
          state.uploadProgress.push({ filename, progress, status });
        }
      });
    },
    
    setCompoundFile: (data) => {
      set((state) => {
        state.compoundFile = data;
      });
    },
    
    updateFileMetadata: (filename, updates) => {
      set((state) => {
        const file = state.uploadedFiles.find((f: ParsedFilename) => f.filename === filename);
        if (file) {
          if (updates.experiment !== undefined) file.experiment = updates.experiment;
          if (updates.condition !== undefined) file.condition = updates.condition;
          // Sync to metadata_columns so the unified panel and downstream consumers stay consistent
          if (!state.config.metadata_columns) state.config.metadata_columns = {};
          if (!state.config.metadata_columns[filename]) state.config.metadata_columns[filename] = {};
          if (updates.experiment !== undefined) state.config.metadata_columns[filename].experiment = updates.experiment;
          if (updates.condition !== undefined) state.config.metadata_columns[filename].condition = updates.condition;
        }
      });
    },

    toggleFileSelection: (filename) => {
      set((state) => {
        if (state.selectedFiles.has(filename)) {
          state.selectedFiles.delete(filename);
        } else {
          state.selectedFiles.add(filename);
        }
      });
    },
    
    selectAllFiles: () => {
      set((state) => {
        state.uploadedFiles.forEach((file: ParsedFilename) => {
          state.selectedFiles.add(file.filename);
        });
      });
    },
    
    deselectAllFiles: () => {
      set((state) => {
        state.selectedFiles.clear();
      });
    },
    
    setConfig: (configUpdate) => {
      set((state) => {
        Object.assign(state.config, configUpdate);
      });
    },
    
    setAvailableOrganisms: (organisms) => {
      set((state) => {
        state.availableOrganisms = organisms;
      });
    },
    
    setIsUploading: (isUploading) => {
      set((state) => {
        state.isUploading = isUploading;
      });
    },
    
    setIsLoadingOrganisms: (isLoading) => {
      set((state) => {
        state.isLoadingOrganisms = isLoading;
      });
    },
    
    setUploadError: (error) => {
      set((state) => {
        state.uploadError = error;
      });
    },
    
    reset: () => {
      set((state) => {
        state.uploadedFiles = [];
        state.uploadProgress = [];
        state.compoundFile = null;
        state.selectedFiles.clear();
        state.selectedPipeline = null;
        state.config = { ...defaultConfig };
        state.isUploading = false;
        state.uploadError = null;
      });
    },
  }))
);

/**
 * Validation selectors
 */
export const getSelectedFiles = (state: AnalysisState): ParsedFilename[] => {
  return state.uploadedFiles.filter((file) => state.selectedFiles.has(file.filename));
};

export const getExperiments = (state: AnalysisState): string[] => {
  const selected = getSelectedFiles(state);
  return Array.from(new Set(selected.map((f) => f.experiment)));
};

export const getConditions = (state: AnalysisState): string[] => {
  const selected = getSelectedFiles(state);
  return Array.from(new Set(selected.map((f) => f.condition)));
};

/**
 * Generate all pairwise comparisons from conditions.
 * Returns array of { group1: {Condition: ...}, group2: {Condition: ...} } pairs.
 */
export const getAllPairwiseComparisons = (state: AnalysisState): Array<{ group1: Record<string, string>; group2: Record<string, string> }> => {
  const conditions = getConditions(state);
  const comparisons: Array<{ group1: Record<string, string>; group2: Record<string, string> }> = [];
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      comparisons.push({
        group1: { Condition: conditions[i] },
        group2: { Condition: conditions[j] },
      });
    }
  }
  return comparisons;
};

export const getReplicatesByCondition = (state: AnalysisState): Record<string, number> => {
  const selected = getSelectedFiles(state);
  const counts: Record<string, number> = {};
  selected.forEach((file) => {
    counts[file.condition] = (counts[file.condition] || 0) + 1;
  });
  return counts;
};

/**
 * Get validation state for the current analysis configuration.
 * NOTE: Callers should memoize with useMemo() to avoid unnecessary recalculations on every render.
 */
export const getValidation = (state: AnalysisState): ExperimentValidation => {
  const selected = getSelectedFiles(state);
  const experiments = getExperiments(state);
  const conditions = getConditions(state);
  const replicatesByCondition = getReplicatesByCondition(state);
  const warnings: ValidationWarning[] = [];
  
  // Check multiple experiments
  if (experiments.length > 1) {
    warnings.push({
      type: 'error',
      message: 'Samples must be from the same experiment.',
      code: 'MULTIPLE_EXPERIMENTS',
    });
  }
  
  // Check at least 2 conditions
  if (conditions.length < 2 && selected.length > 0) {
    warnings.push({
      type: 'warning',
      message: 'Need at least 2 conditions for comparison',
      code: 'INSUFFICIENT_CONDITIONS',
    });
  }
  
  // Check config validation
  if (state.config.treatment && state.config.control && state.config.treatment === state.config.control) {
    warnings.push({
      type: 'error',
      message: 'Treatment and Control must be different.',
      code: 'SAME_TREATMENT_CONTROL',
    });
  }
  
  if (selected.length > 0 && state.config.treatment && !conditions.includes(state.config.treatment)) {
    warnings.push({
      type: 'error',
      message: `Treatment condition '${state.config.treatment}' not found in selected files`,
      code: 'INVALID_TREATMENT',
    });
  }
  
  if (selected.length > 0 && state.config.control && !conditions.includes(state.config.control)) {
    warnings.push({
      type: 'error',
      message: `Control condition '${state.config.control}' not found in selected files`,
      code: 'INVALID_CONTROL',
    });
  }
  
  const isValid = warnings.filter((w) => w.type === 'error').length === 0 &&
    selected.length > 0;
  
  return {
    isValid,
    warnings,
    selectedFiles: selected,
    experiments,
    conditions,
    replicatesByCondition,
  };
};

export const canStartAnalysis = (state: AnalysisState): boolean => {
  const validation = getValidation(state);
  const hasRequiredConfig = state.config.organism !== '' &&
    state.selectedFiles.size > 0;
  const hasComparisons = (state.config.comparisons?.length ?? 0) > 0;
  return validation.isValid && hasRequiredConfig && hasComparisons;
};
