/**
 * Analysis store for managing data input and configuration state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type {
  ParsedFilename,
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

  // Selection state
  selectedFiles: Set<string>;

  // Template selection
  selectedTemplate: 'protein' | 'ptm';

  // PTM-specific state
  ptmLabelingType: 'LF' | 'TMT';
  ptmDetectedMods: string[];
  ptmSelectedMods: string[];
  ptmFastaFile: string | null;
  ptmGlobalProteomeFiles: number;

  // Pipeline selection
  selectedPipeline: 'msqrob2' | 'msstats' | 'ptm' | null;

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
  toggleFileSelection: (filename: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  updateFileMetadata: (filename: string, updates: Partial<Pick<ParsedFilename, 'experiment' | 'conditions'>>) => void;
  setTemplate: (template: 'protein' | 'ptm') => void;
  setPipeline: (pipeline: 'msqrob2' | 'msstats' | 'ptm') => void;
  setConfig: (config: Partial<SessionConfig>) => void;
  setAvailableOrganisms: (organisms: Organism[]) => void;
  setIsUploading: (isUploading: boolean) => void;
  setIsLoadingOrganisms: (isLoading: boolean) => void;
  setUploadError: (error: string | null) => void;
  setPtmLabelingType: (labelingType: 'LF' | 'TMT') => void;
  setPtmDetectedMods: (mods: string[]) => void;
  togglePtmMod: (mod: string) => void;
  setPtmFastaFile: (filename: string | null) => void;
  setPtmGlobalProteomeFiles: (count: number) => void;
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
  msstats_n_cores: undefined,
  condition_column: 'condition',
  covariate_columns: [],
  msqrob2_batch_column: 'batch',
};

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    // Initial state
    uploadedFiles: [],
    uploadProgress: [],
    selectedFiles: new Set<string>(),
    selectedTemplate: 'protein',
    ptmLabelingType: 'LF',
    ptmDetectedMods: [],
    ptmSelectedMods: [],
    ptmFastaFile: null,
    ptmGlobalProteomeFiles: 0,
    selectedPipeline: null,
    config: { ...defaultConfig },
    availableOrganisms: [],
    isUploading: false,
    isLoadingOrganisms: false,
    uploadError: null,

    // Actions
    setTemplate: (template) => {
      set((state) => {
        state.selectedTemplate = template;
        if (template === 'ptm') {
          state.selectedPipeline = null;
          state.config.pipeline = undefined;
        }
      });
    },

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
          // Initialize metadata_columns for this file so addColumn works immediately.
          if (!state.config.metadata_columns) state.config.metadata_columns = {};
          if (!state.config.metadata_columns[file.filename]) {
            const entry: Record<string, string> = {
              experiment: file.experiment,
              replicate: String(file.replicate),
            };
            file.conditions.forEach((cond, i) => {
              entry[`condition_${i + 1}`] = cond;
            });
            entry["batch"] = file.experiment;
            state.config.metadata_columns[file.filename] = entry;
          }
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

    updateFileMetadata: (filename, updates) => {
      set((state) => {
        const file = state.uploadedFiles.find((f: ParsedFilename) => f.filename === filename);
        if (file) {
          if (updates.experiment !== undefined) file.experiment = updates.experiment;
          if (updates.conditions !== undefined) file.conditions = updates.conditions;
          // Sync to metadata_columns so the unified panel and downstream consumers stay consistent
          const mc = state.config.metadata_columns;
          if (!mc) {
            state.config.metadata_columns = {};
          }
          const meta = state.config.metadata_columns!;
          if (!meta[filename]) meta[filename] = {};
          if (updates.experiment !== undefined) {
            const oldExperiment = meta[filename].experiment;
            meta[filename].experiment = updates.experiment;
            if (meta[filename].batch === oldExperiment) {
              meta[filename].batch = updates.experiment;
            }
          }
          if (updates.conditions !== undefined) {
            updates.conditions.forEach((cond, i) => {
              meta[filename][`condition_${i + 1}`] = cond;
            });
          }
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
        const keys = Object.keys(configUpdate) as (keyof SessionConfig)[];
        for (const key of keys) {
          (state.config as Record<string, unknown>)[key] = (configUpdate as Record<string, unknown>)[key];
        }
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

    setPtmLabelingType: (labelingType) => {
      set((state) => {
        state.ptmLabelingType = labelingType;
      });
    },

    setPtmDetectedMods: (mods) => {
      set((state) => {
        state.ptmDetectedMods = mods;
      });
    },

    togglePtmMod: (mod) => {
      set((state) => {
        const idx = state.ptmSelectedMods.indexOf(mod);
        if (idx >= 0) {
          state.ptmSelectedMods.splice(idx, 1);
        } else {
          state.ptmSelectedMods.push(mod);
        }
      });
    },

    setPtmFastaFile: (filename) => {
      set((state) => {
        state.ptmFastaFile = filename;
      });
    },

    setPtmGlobalProteomeFiles: (count) => {
      set((state) => {
        state.ptmGlobalProteomeFiles = count;
      });
    },

    reset: () => {
      set((state) => {
        state.uploadedFiles = [];
        state.uploadProgress = [];
        state.selectedFiles.clear();
        state.selectedTemplate = 'protein';
        state.ptmLabelingType = 'LF';
        state.ptmDetectedMods = [];
        state.ptmSelectedMods = [];
        state.ptmFastaFile = null;
        state.ptmGlobalProteomeFiles = 0;
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

function getConditionColumnNames(state: AnalysisState): string[] {
  const maxConditions = state.uploadedFiles.reduce(
    (max, f) => Math.max(max, f.conditions.length),
    0,
  );
  const cols: string[] = [];
  for (let i = 1; i <= maxConditions; i++) {
    cols.push(`condition_${i}`);
  }
  return cols;
}

export const getConditions = (state: AnalysisState): string[] => {
  const selected = getSelectedFiles(state);
  const metadataColumns = state.config.metadata_columns || {};
  const condCols = getConditionColumnNames(state);
  const combined = selected.map((f) => {
    const meta = metadataColumns[f.filename] || {};
    return condCols.map((col) => meta[col] || '').join('+');
  });
  return Array.from(new Set(combined));
};

/**
 * Generate all pairwise comparisons from conditions.
 * Returns array of { group1: {Condition: ...}, group2: {Condition: ...} } pairs.
 */
export const getAllPairwiseComparisons = (state: AnalysisState): Array<{ group1: Record<string, string>; group2: Record<string, string> }> => {
  const selected = getSelectedFiles(state);
  const metadataColumns = state.config.metadata_columns || {};
  const condCols = getConditionColumnNames(state);

  const uniqueConditions: Record<string, string>[] = [];
  const seen = new Set<string>();
  selected.forEach((f) => {
    const meta = metadataColumns[f.filename] || {};
    const combined: Record<string, string> = {};
    condCols.forEach((col) => { combined[col] = meta[col] || ''; });
    const key = JSON.stringify(combined);
    if (!seen.has(key)) { seen.add(key); uniqueConditions.push(combined); }
  });

  const comparisons: Array<{ group1: Record<string, string>; group2: Record<string, string> }> = [];
  for (let i = 0; i < uniqueConditions.length; i++) {
    for (let j = i + 1; j < uniqueConditions.length; j++) {
      comparisons.push({ group1: uniqueConditions[i], group2: uniqueConditions[j] });
    }
  }
  return comparisons;
};

export const getReplicatesByCondition = (state: AnalysisState): Record<string, number> => {
  const selected = getSelectedFiles(state);
  const metadataColumns = state.config.metadata_columns || {};
  const condCols = getConditionColumnNames(state);
  const counts: Record<string, number> = {};
  selected.forEach((file) => {
    const meta = metadataColumns[file.filename] || {};
    const combined = condCols.map((col) => meta[col] || '').join('+');
    counts[combined] = (counts[combined] || 0) + 1;
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
  const hasComparisons = (state.config.comparisons?.length ?? 0) > 0;
  return validation.isValid && state.selectedFiles.size > 0 && hasComparisons;
};
