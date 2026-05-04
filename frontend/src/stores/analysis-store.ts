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
  remove_razor: false,
  strict_filtering: false,
};

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    // Initial state
    uploadedFiles: [],
    uploadProgress: [],
    compoundFile: null,
    selectedFiles: new Set<string>(),
    config: { ...defaultConfig },
    availableOrganisms: [],
    isUploading: false,
    isLoadingOrganisms: false,
    uploadError: null,
    
    // Actions
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
 * Returns array of { treatment, control } pairs.
 */
export const getAllPairwiseComparisons = (state: AnalysisState): Array<{ treatment: string; control: string }> => {
  const conditions = getConditions(state);
  const comparisons: Array<{ treatment: string; control: string }> = [];
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      comparisons.push({ treatment: conditions[i], control: conditions[j] });
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
  
  // Check exactly 2 conditions
  if (conditions.length > 2) {
    warnings.push({
      type: 'error',
      message: 'Samples must be from 2 conditions for paired comparison.',
      code: 'TOO_MANY_CONDITIONS',
    });
  } else if (conditions.length < 2 && selected.length > 0) {
    warnings.push({
      type: 'warning',
      message: 'Need 2 conditions for paired comparison',
      code: 'INSUFFICIENT_CONDITIONS',
    });
  }
  
  // Check minimum replicates
  Object.entries(replicatesByCondition).forEach(([condition, count]) => {
    if (count < 3) {
      warnings.push({
        type: 'error',
        message: `At least 3 replicates per condition required! Condition '${condition}' has only ${count}.`,
        code: 'INSUFFICIENT_REPLICATES',
      });
    }
  });
  
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
    selected.length > 0 &&
    state.config.treatment !== '' &&
    state.config.control !== '' &&
    state.config.organism !== '';
  
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
  return validation.isValid;
};
