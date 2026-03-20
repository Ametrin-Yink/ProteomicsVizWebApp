/**
 * Analysis Store using Zustand
 * 
 * Manages analysis configuration and data state.
 * NEVER mutate state directly - always use actions.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { 
  AnalysisConfig, 
  AnalysisParameters,
  AnalysisTemplate,
  UploadedFile,
  CompoundFile,
  Condition 
} from '@/types/session';

// Analysis state interface
interface AnalysisState {
  // Configuration
  config: AnalysisConfig | null;
  
  // File data
  uploadedFiles: UploadedFile[];
  compoundFile: CompoundFile | null;
  
  // Parsed conditions from files
  conditions: Condition[];
  availableConditions: string[];
  
  // Selection state
  selectedConditions: string[];
  selectedReplicates: Record<string, string[]>; // condition -> replicate IDs
  
  // Validation
  isValid: boolean;
  validationErrors: string[];
  
  // UI state
  isUploading: boolean;
  uploadProgress: Record<string, number>; // fileId -> percentage
}

// Analysis actions interface
interface AnalysisActions {
  // Configuration actions
  setConfig: (config: AnalysisConfig) => void;
  updateConfig: (updates: Partial<AnalysisConfig>) => void;
  setTemplate: (template: AnalysisTemplate) => void;
  setParameters: (parameters: Partial<AnalysisParameters>) => void;
  
  // File actions
  addUploadedFile: (file: UploadedFile) => void;
  removeUploadedFile: (fileId: string) => void;
  setUploadedFiles: (files: UploadedFile[]) => void;
  setCompoundFile: (file: CompoundFile | null) => void;
  
  // Condition actions
  setConditions: (conditions: Condition[]) => void;
  setAvailableConditions: (conditions: string[]) => void;
  
  // Selection actions
  selectCondition: (condition: string) => void;
  deselectCondition: (condition: string) => void;
  selectReplicate: (condition: string, replicateId: string) => void;
  deselectReplicate: (condition: string, replicateId: string) => void;
  selectAllReplicates: (condition: string) => void;
  deselectAllReplicates: (condition: string) => void;
  
  // Validation actions
  setValid: (isValid: boolean) => void;
  setValidationErrors: (errors: string[]) => void;
  addValidationError: (error: string) => void;
  clearValidationErrors: () => void;
  
  // Upload actions
  setUploading: (isUploading: boolean) => void;
  setUploadProgress: (fileId: string, progress: number) => void;
  clearUploadProgress: () => void;
  
  // Reset
  reset: () => void;
}

// Combined store interface
interface AnalysisStore extends AnalysisState, AnalysisActions {}

// Default parameters
const defaultParameters: AnalysisParameters = {
  minPeptides: 2,
  minSamples: 2,
  log2FoldChangeThreshold: 1.0,
  pValueThreshold: 0.05,
  gseaDatabase: 'GO_Biological_Process_2021',
  gseaMinSize: 15,
  gseaMaxSize: 500,
  pcaComponents: 2,
  normalizationMethod: 'median',
  imputationMethod: 'knn',
};

// Initial state factory
const createInitialState = (): AnalysisState => ({
  config: null,
  uploadedFiles: [],
  compoundFile: null,
  conditions: [],
  availableConditions: [],
  selectedConditions: [],
  selectedReplicates: {},
  isValid: false,
  validationErrors: [],
  isUploading: false,
  uploadProgress: {},
});

export const useAnalysisStore = create<AnalysisStore>()(
  immer((set) => ({
    // Initial state
    ...createInitialState(),

    // ==================== Configuration Actions ====================
    
    setConfig: (config: AnalysisConfig) => {
      set((state) => {
        state.config = config;
      });
    },

    updateConfig: (updates: Partial<AnalysisConfig>) => {
      set((state) => {
        if (state.config) {
          state.config = { ...state.config, ...updates };
        }
      });
    },

    setTemplate: (template: AnalysisTemplate) => {
      set((state) => {
        if (state.config) {
          state.config.template = template;
        }
      });
    },

    setParameters: (parameters: Partial<AnalysisParameters>) => {
      set((state) => {
        if (state.config) {
          state.config.parameters = { ...state.config.parameters, ...parameters };
        }
      });
    },

    // ==================== File Actions ====================

    addUploadedFile: (file: UploadedFile) => {
      set((state) => {
        state.uploadedFiles.push(file);
      });
    },

    removeUploadedFile: (fileId: string) => {
      set((state) => {
        state.uploadedFiles = state.uploadedFiles.filter((f) => f.id !== fileId);
      });
    },

    setUploadedFiles: (files: UploadedFile[]) => {
      set((state) => {
        state.uploadedFiles = files;
      });
    },

    setCompoundFile: (file: CompoundFile | null) => {
      set((state) => {
        state.compoundFile = file;
      });
    },

    // ==================== Condition Actions ====================

    setConditions: (conditions: Condition[]) => {
      set((state) => {
        state.conditions = conditions;
      });
    },

    setAvailableConditions: (conditions: string[]) => {
      set((state) => {
        state.availableConditions = conditions;
      });
    },

    // ==================== Selection Actions ====================

    selectCondition: (condition: string) => {
      set((state) => {
        if (!state.selectedConditions.includes(condition)) {
          state.selectedConditions.push(condition);
        }
      });
    },

    deselectCondition: (condition: string) => {
      set((state) => {
        state.selectedConditions = state.selectedConditions.filter((c) => c !== condition);
        // Also clear replicates for this condition
        delete state.selectedReplicates[condition];
      });
    },

    selectReplicate: (condition: string, replicateId: string) => {
      set((state) => {
        if (!state.selectedReplicates[condition]) {
          state.selectedReplicates[condition] = [];
        }
        if (!state.selectedReplicates[condition].includes(replicateId)) {
          state.selectedReplicates[condition].push(replicateId);
        }
      });
    },

    deselectReplicate: (condition: string, replicateId: string) => {
      set((state) => {
        if (state.selectedReplicates[condition]) {
          state.selectedReplicates[condition] = state.selectedReplicates[condition].filter(
            (id) => id !== replicateId
          );
        }
      });
    },

    selectAllReplicates: (condition: string) => {
      set((state) => {
        const conditionData = state.conditions.find((c: { name: string }) => c.name === condition);
        if (conditionData) {
          state.selectedReplicates[condition] = conditionData.samples.map((s: { id: string }) => s.id);
        }
      });
    },

    deselectAllReplicates: (condition: string) => {
      set((state) => {
        state.selectedReplicates[condition] = [];
      });
    },

    // ==================== Validation Actions ====================

    setValid: (isValid: boolean) => {
      set((state) => {
        state.isValid = isValid;
      });
    },

    setValidationErrors: (errors: string[]) => {
      set((state) => {
        state.validationErrors = errors;
        state.isValid = errors.length === 0;
      });
    },

    addValidationError: (error: string) => {
      set((state) => {
        if (!state.validationErrors.includes(error)) {
          state.validationErrors.push(error);
        }
        state.isValid = false;
      });
    },

    clearValidationErrors: () => {
      set((state) => {
        state.validationErrors = [];
        state.isValid = true;
      });
    },

    // ==================== Upload Actions ====================

    setUploading: (isUploading: boolean) => {
      set((state) => {
        state.isUploading = isUploading;
      });
    },

    setUploadProgress: (fileId: string, progress: number) => {
      set((state) => {
        state.uploadProgress[fileId] = progress;
      });
    },

    clearUploadProgress: () => {
      set((state) => {
        state.uploadProgress = {};
      });
    },

    // ==================== Reset ====================

    reset: () => {
      set(() => createInitialState());
    },
  }))
);

// Selector hooks
export const useAnalysisConfig = () => useAnalysisStore((state) => state.config);
export const useUploadedFiles = () => useAnalysisStore((state) => state.uploadedFiles);
export const useCompoundFile = () => useAnalysisStore((state) => state.compoundFile);
export const useConditions = () => useAnalysisStore((state) => state.conditions);
export const useSelectedConditions = () => useAnalysisStore((state) => state.selectedConditions);
export const useSelectedReplicates = () => useAnalysisStore((state) => state.selectedReplicates);
export const useAnalysisValidation = () => useAnalysisStore((state) => ({
  isValid: state.isValid,
  errors: state.validationErrors,
}));
export const useUploadState = () => useAnalysisStore((state) => ({
  isUploading: state.isUploading,
  progress: state.uploadProgress,
}));
