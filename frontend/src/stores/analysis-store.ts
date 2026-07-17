/**
 * Analysis store for managing data input and configuration state
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { parseCSVLine } from '@/lib/csv';
import type {
  UploadedFileInfo,
  UploadProgress,
  SessionConfig,
  ValidationWarning,
  ExperimentValidation,
  Organism,
  AnalysisType,
} from '@/types';

// Enable MapSet plugin for Immer (required for using Set in state)
enableMapSet();

/** Derive pipeline label from analysis type */
export function getPipelineFromType(analysisType: AnalysisType | null): 'msstats' | 'msqrob2' | 'ptm' | null {
  if (!analysisType) return null;
  switch (analysisType) {
    case 'tmt': return 'msstats';
    case 'dia': return 'msqrob2';
    case 'ptm': return 'ptm';
  }
}

export interface AnalysisState {
  // File upload state
  uploadedFiles: UploadedFileInfo[];
  uploadProgress: UploadProgress[];

  // Selection state
  selectedFiles: Set<string>;

  // Analysis type (replaces selectedTemplate + selectedPipeline)
  analysisType: AnalysisType | null;

  // PTM-specific state
  ptmLabelingType: 'LF' | 'TMT';
  ptmDetectedMods: string[];
  ptmSelectedMods: string[];
  ptmFastaFile: string | null;
  ptmGlobalProteomeFiles: number;

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
  addUploadedFile: (file: UploadedFileInfo) => void;
  removeUploadedFile: (filename: string) => void;
  setUploadProgress: (filename: string, progress: number, status: UploadProgress['status']) => void;
  toggleFileSelection: (filename: string) => void;
  selectAllFiles: () => void;
  deselectAllFiles: () => void;
  updateFileMetadata: (filename: string, updates: Partial<Pick<UploadedFileInfo, 'experiment' | 'batch' | 'file_type' | 'replicate'>>) => void;
  setAnalysisType: (analysisType: AnalysisType) => void;
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
  // TMT channel mapping actions
  updateChannelMapping: (filename: string, channel: string, groups: Record<string, string | number>) => void;
  importChannelMapping: (filename: string, csvData: string) => void;
  importMetadataColumns: (data: Record<string, Record<string, string>>) => void;
  reset: () => void;
}

export type AnalysisData = Pick<
  AnalysisState,
  'uploadedFiles' | 'selectedFiles' | 'analysisType' | 'config'
>;

const defaultConfig: SessionConfig = {
  treatment: '',
  control: '',
  organism: '',
  pipeline: undefined,
  file_type: undefined,
  tmt_channel_mapping: undefined,
  resolve_shared_peptides: false,
  max_missing_fraction_per_condition: 0.40,
  min_psms_per_protein: 1,
  pvalue_threshold: 0.05,
  logfc_threshold: 1.0,
  comparisons: [],
  metadata_columns: {},
  msstats_normalization: 'equalizeMedians',
  msstats_feature_selection: 'all',
  msstats_summary_method: 'TMP',
  msstats_impute: true,
  msstats_log_base: 2,
  msstats_censored_int: 'NA',
  msstats_max_quantile: 0.999,
  msstats_n_top_feature: 3,
  msstats_min_feature_count: 2,
  msstats_remove_uninformative_feature_outlier: false,
  msstats_equal_feature_var: true,
  msstats_name_standards: undefined,
  msstats_save_fitted_models: true,
  msstats_n_cores: undefined,
  covariate_columns: [],
  msqrob2_batch_column: 'batch',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Convert legacy filter flags to the explicit filter controls used by new sessions. */
export function migrateLegacyFilterConfig(configUpdate: Partial<SessionConfig>): Partial<SessionConfig> {
  const migrated = { ...configUpdate };

  if (migrated.resolve_shared_peptides === undefined && typeof migrated.remove_razor === 'boolean') {
    migrated.resolve_shared_peptides = migrated.remove_razor;
  }

  if (migrated.max_missing_fraction_per_condition === undefined && typeof migrated.strict_filtering === 'boolean') {
    migrated.max_missing_fraction_per_condition = migrated.strict_filtering ? 0.20 : 0.40;
  }

  if (
    migrated.min_psms_per_protein === undefined &&
    (typeof migrated.min_peptides_per_protein === 'number' || typeof migrated.strict_filtering === 'boolean')
  ) {
    const legacyMinimum = typeof migrated.min_peptides_per_protein === 'number'
      ? migrated.min_peptides_per_protein
      : 1;
    migrated.min_psms_per_protein = migrated.strict_filtering
      ? Math.max(2, legacyMinimum)
      : legacyMinimum;
  }

  if (typeof migrated.max_missing_fraction_per_condition === 'number') {
    migrated.max_missing_fraction_per_condition = clamp(migrated.max_missing_fraction_per_condition, 0, 1);
  }
  if (typeof migrated.min_psms_per_protein === 'number') {
    migrated.min_psms_per_protein = clamp(Math.round(migrated.min_psms_per_protein), 1, 10);
  }

  delete migrated.remove_razor;
  delete migrated.strict_filtering;
  delete migrated.min_peptides_per_protein;
  delete migrated.msstats_remove50missing;
  return migrated;
}

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    // Initial state
    uploadedFiles: [],
    uploadProgress: [],
    selectedFiles: new Set<string>(),
    analysisType: null,
    ptmLabelingType: 'LF',
    ptmDetectedMods: [],
    ptmSelectedMods: [],
    ptmFastaFile: null,
    ptmGlobalProteomeFiles: 0,
    config: { ...defaultConfig },
    availableOrganisms: [],
    isUploading: false,
    isLoadingOrganisms: false,
    uploadError: null,

    // Actions
    setAnalysisType: (analysisType) => {
      set((state) => {
        state.analysisType = analysisType;
        // Derive pipeline from analysis type
        if (analysisType === 'tmt') {
          state.config.pipeline = 'msstats';
          state.config.file_type = 'tmt';
        } else if (analysisType === 'dia') {
          state.config.pipeline = 'msqrob2';
          state.config.file_type = 'dia';
        } else if (analysisType === 'ptm') {
          state.config.pipeline = 'ptm';
          state.config.file_type = undefined;
        }
      });
    },

    addUploadedFile: (file) => {
      set((state) => {
        const exists = state.uploadedFiles.some((f: UploadedFileInfo) => f.filename === file.filename);
        if (!exists) {
          state.uploadedFiles.push(file);
          state.selectedFiles.add(file.filename);
          // Initialize metadata_columns for this file
          if (!state.config.metadata_columns) state.config.metadata_columns = {};
          if (!state.config.metadata_columns[file.filename]) {
            const entry: Record<string, string> = {
              experiment: file.experiment,
              replicate: String(file.replicate),
              batch: file.batch,
            };
            state.config.metadata_columns[file.filename] = entry;
          }
        }
      });
    },

    removeUploadedFile: (filename) => {
      set((state) => {
        state.uploadedFiles = state.uploadedFiles.filter((f: UploadedFileInfo) => f.filename !== filename);
        state.selectedFiles.delete(filename);
        state.uploadProgress = state.uploadProgress.filter((p: UploadProgress) => p.filename !== filename);
        // Clean up TMT channel mapping entries for this file
        if (state.config.tmt_channel_mapping) {
          const prefix = filename + '::';
          for (const key of Object.keys(state.config.tmt_channel_mapping)) {
            if (key.startsWith(prefix)) {
              delete state.config.tmt_channel_mapping[key];
            }
          }
        }
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
        const file = state.uploadedFiles.find((f: UploadedFileInfo) => f.filename === filename);
        if (file) {
          if (updates.experiment !== undefined) file.experiment = updates.experiment;
          if (updates.batch !== undefined) file.batch = updates.batch;
          if (updates.file_type !== undefined) file.file_type = updates.file_type;
          if (updates.replicate !== undefined) file.replicate = updates.replicate;
          // Sync to metadata_columns
          const mc = state.config.metadata_columns;
          if (!mc) {
            state.config.metadata_columns = {};
          }
          const meta = state.config.metadata_columns!;
          if (!meta[filename]) meta[filename] = {};
          if (updates.experiment !== undefined) {
            meta[filename].experiment = updates.experiment;
          }
          if (updates.batch !== undefined) {
            meta[filename].batch = updates.batch;
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
        state.uploadedFiles.forEach((file: UploadedFileInfo) => {
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
        const migratedUpdate = migrateLegacyFilterConfig(configUpdate);
        const keys = Object.keys(migratedUpdate) as (keyof SessionConfig)[];
        for (const key of keys) {
          (state.config as Record<string, unknown>)[key] = (migratedUpdate as Record<string, unknown>)[key];
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

    updateChannelMapping: (filename, channel, groups) => {
      set((state) => {
        const key = filename + '::' + channel;
        if (!state.config.tmt_channel_mapping) {
          state.config.tmt_channel_mapping = {};
        }
        state.config.tmt_channel_mapping[key] = { ...(state.config.tmt_channel_mapping[key] || {}), ...groups };
      });
    },

    importChannelMapping: (filename, csvData) => {
      set((state) => {
        const lines = csvData.split('\n').filter((l) => l.trim() && !l.startsWith('//'));
        if (lines.length < 2) return;
        const headers = parseCSVLine(lines[0]);
        const channelIdx = headers.indexOf('Channel');
        if (channelIdx === -1) return;
        const groupHeaders = headers.filter((h) => h !== 'Channel');
        if (!state.config.tmt_channel_mapping) {
          state.config.tmt_channel_mapping = {};
        }
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const channel = values[channelIdx];
          if (!channel) continue;
          const entry: Record<string, string | number> = {};
          groupHeaders.forEach((h) => {
            const idx = headers.indexOf(h);
            if (idx >= 0 && idx < values.length) {
              const val = values[idx];
              entry[h] = h === 'Replicate' ? parseInt(val, 10) || 0 : val;
            }
          });
          state.config.tmt_channel_mapping[`${filename}::${channel}`] = { ...entry };
        }
      });
    },

    importMetadataColumns: (data) => {
      set((state) => {
        if (!state.config.metadata_columns) {
          state.config.metadata_columns = {};
        }
        Object.assign(state.config.metadata_columns, data);
        // Sync to UploadedFileInfo for core fields
        Object.entries(data).forEach(([fn, entry]) => {
          const fi = state.uploadedFiles.find((f) => f.filename === fn);
          if (fi) {
            if (entry.experiment !== undefined) fi.experiment = entry.experiment;
            if (entry.replicate !== undefined) {
              fi.replicate = parseInt(entry.replicate, 10) || 0;
            }
          }
        });
      });
    },

    reset: () => {
      set((state) => {
        state.uploadedFiles = [];
        state.uploadProgress = [];
        state.selectedFiles.clear();
        state.analysisType = null;
        state.ptmLabelingType = 'LF';
        state.ptmDetectedMods = [];
        state.ptmSelectedMods = [];
        state.ptmFastaFile = null;
        state.ptmGlobalProteomeFiles = 0;
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
export const getSelectedFiles = (state: AnalysisData): UploadedFileInfo[] => {
  return state.uploadedFiles.filter((file) => state.selectedFiles.has(file.filename));
};

export const getExperiments = (state: AnalysisData): string[] => {
  const selected = getSelectedFiles(state);
  return Array.from(new Set(selected.map((f) => f.experiment)));
};

function getConditionColumnNames(state: AnalysisData): string[] {
  // Derive condition columns from metadata_columns (exclude core fields)
  if (!state.config.metadata_columns) return [];
  const cols = new Set<string>();
  Object.values(state.config.metadata_columns).forEach((row) => {
    Object.keys(row).forEach((k) => {
      if (k !== 'experiment' && k !== 'replicate' && k !== 'batch') {
        cols.add(k);
      }
    });
  });
  return Array.from(cols);
}

export const getConditions = (state: AnalysisData): string[] => {
  // TMT: derive conditions from tmt_channel_mapping
  if (state.analysisType === 'tmt') {
    const mapping = state.config.tmt_channel_mapping || {};
    const condCols = getTmtConditionColumns(state);
    const conditions = new Set<string>();
    Object.values(mapping).forEach((entry) => {
      const combined = condCols.map((col) => String(entry[col] || '')).join('+');
      if (combined) conditions.add(combined);
    });
    return Array.from(conditions);
  }

  // DIA: derive conditions from metadata_columns
  const selected = getSelectedFiles(state);
  const metadataColumns = state.config.metadata_columns || {};
  const condCols = getConditionColumnNames(state);
  const combined = selected.map((f) => {
    const meta = metadataColumns[f.filename] || {};
    return condCols.map((col) => meta[col] || '').join('+');
  });
  return Array.from(new Set(combined));
};

/** Get condition column names from TMT channel mapping */
function getTmtConditionColumns(state: AnalysisData): string[] {
  const mapping = state.config.tmt_channel_mapping || {};
  const cols = new Set<string>();
  Object.values(mapping).forEach((entry) => {
    Object.keys(entry).forEach((k) => {
      if (k !== 'replicate') cols.add(k);
    });
  });
  return Array.from(cols);
}

/**
 * Generate all pairwise comparisons from conditions.
 * Returns array of { group1: {Condition: ...}, group2: {Condition: ...} } pairs.
 */
export const getAllPairwiseComparisons = (state: AnalysisData): Array<{ group1: Record<string, string>; group2: Record<string, string> }> => {
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

export const getReplicatesByCondition = (state: AnalysisData): Record<string, number> => {
  // TMT: count replicates from tmt_channel_mapping
  if (state.analysisType === 'tmt') {
    const mapping = state.config.tmt_channel_mapping || {};
    const condCols = getTmtConditionColumns(state);
    const counts: Record<string, number> = {};
    Object.values(mapping).forEach((entry) => {
      const combined = condCols.map((col) => String(entry[col] || '')).join('+');
      if (combined) counts[combined] = (counts[combined] || 0) + 1;
    });
    return counts;
  }

  // DIA: count replicates from metadata_columns
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
export const getValidation = (state: AnalysisData): ExperimentValidation => {
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

  // Soft warning for <3 replicates per condition
  if (conditions.length >= 2) {
    Object.entries(replicatesByCondition).forEach(([condition, count]) => {
      if (count < 3) {
        warnings.push({
          type: 'warning',
          message: `"${condition}" has ${count} replicate(s). Minimum 3 recommended.`,
          code: 'FEW_REPLICATES',
        });
      }
    });
  }

  // TMT-specific: check all channels mapped
  if (state.analysisType === 'tmt' && state.config.tmt_channel_mapping && Object.keys(state.config.tmt_channel_mapping).length > 0) {
    // Count channels from uploaded TMT files
    const tmtFiles = selected.filter((f) => f.file_type === 'tmt');
    const totalChannels = tmtFiles.reduce((sum, f) => sum + (f.tmt_channels?.length || 0), 0);
    const mappedChannels = Object.keys(state.config.tmt_channel_mapping).length;

    if (mappedChannels < totalChannels) {
      warnings.push({
        type: 'warning',
        message: `${totalChannels - mappedChannels} TMT channel(s) not yet mapped. Complete mapping on the Metadata page.`,
        code: 'UNMAPPED_CHANNELS',
      });
    }
  }

  // DIA-specific: check min 2 files
  if (state.analysisType === 'dia' && selected.length > 0 && selected.length < 2) {
    warnings.push({
      type: 'error',
      message: 'DIA analysis requires at least 2 files',
      code: 'MIN_DIA_FILES',
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

export const canStartAnalysis = (state: AnalysisData): boolean => {
  const baseValid = state.selectedFiles.size > 0 && (state.config.comparisons?.length ?? 0) > 0;
  if (!baseValid) return false;

  // TMT-specific: all channels must be mapped
  if (state.config.file_type === 'tmt') {
    const mapping = state.config.tmt_channel_mapping ?? {};
    const tmtFiles = state.uploadedFiles.filter(f => f.tmt_channels && f.tmt_channels.length > 0);
    for (const file of tmtFiles) {
      const fileChannels = file.tmt_channels ?? [];
      for (const ch of fileChannels) {
        const key = `${file.filename}::${ch}`;
        const entry = mapping[key];
        if (!entry || Object.values(entry).every(v => !v)) return false;
      }
    }
  }
  return true;
};
