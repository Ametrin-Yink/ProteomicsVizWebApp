'use client';

import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SessionConfig } from '@/types';

interface MsstatsConfigFormProps {
  config: SessionConfig;
  setConfig: (partial: Partial<SessionConfig>) => void;
}

export default function MsstatsConfigForm({ config, setConfig }: MsstatsConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  return (
    <div className="space-y-5">
      {/* Basic Section */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-3">MSstats Basic</h3>

        {/* Normalization Method */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Normalization Method
          </label>
          <select
            data-testid="msstats-normalization-select"
            value={config.msstats_normalization ?? 'equalizeMedians'}
            onChange={(e) => setConfig({ msstats_normalization: e.target.value })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          >
            <option value="equalizeMedians">Equalize Medians</option>
            <option value="quantile">Quantile</option>
            <option value="NONE">None (No Normalization)</option>
            <option value="GLOBALSTANDARDS">Global Standards</option>
          </select>
        </div>

        {/* Summary Method */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Summary Method
          </label>
          <select
            data-testid="msstats-summary-select"
            value={config.msstats_summary_method ?? 'TMP'}
            onChange={(e) => setConfig({ msstats_summary_method: e.target.value })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          >
            <option value="TMP">Tukey Median Polish (TMP)</option>
            <option value="linear">Linear Mixed Model</option>
          </select>
        </div>

        {/* Feature Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Feature Selection
          </label>
          <select
            data-testid="msstats-feature-select"
            value={config.msstats_feature_selection ?? 'all'}
            onChange={(e) => setConfig({ msstats_feature_selection: e.target.value })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          >
            <option value="all">All Features</option>
            <option value="top3">Top 3 Peptides</option>
            <option value="topN">Top N Peptides</option>
            <option value="highQuality">High Quality</option>
          </select>
        </div>

        {/* Conditional: n_top_feature when topN selected */}
        {(config.msstats_feature_selection === 'topN') && (
          <div className="mb-4 ml-4 p-3 bg-surface rounded-lg border border-border">
            <label className="block text-sm font-medium text-text mb-2">
              Number of Top Features
            </label>
            <input
              type="number"
              min={1}
              max={10}
              data-testid="msstats-ntop-input"
              value={config.msstats_n_top_feature ?? 3}
              onChange={(e) => setConfig({ msstats_n_top_feature: parseInt(e.target.value, 10) || 3 })}
              className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-text text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              Number of highest-intensity features to retain per protein
            </p>
          </div>
        )}

        {/* Log Base */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Log Base
          </label>
          <select
            data-testid="msstats-logbase-select"
            value={config.msstats_log_base ?? 2}
            onChange={(e) => setConfig({ msstats_log_base: parseInt(e.target.value, 10) })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          >
            <option value={2}>Log2</option>
            <option value={10}>Log10</option>
          </select>
          <p className="text-xs text-text-muted mt-1">
            MSstats supports log2 and log10 transformations
          </p>
        </div>

        {/* MBimpute */}
        <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors mb-4">
          <div>
            <span className="text-sm font-medium text-text">MBimpute</span>
            <p className="text-xs text-text-muted mt-0.5">
              Model-based imputation for missing values
            </p>
          </div>
          <input
            type="checkbox"
            data-testid="msstats-impute-checkbox"
            checked={config.msstats_impute ?? true}
            onChange={(e) => setConfig({ msstats_impute: e.target.checked })}
            className="sr-only peer"
          />
          <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
            after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
            after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
            peer-checked:after:translate-x-5"
          />
        </label>

        {/* Censored Intensity */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Censored Intensity
          </label>
          <select
            data-testid="msstats-censored-select"
            value={config.msstats_censored_int ?? 'NA'}
            onChange={(e) => setConfig({ msstats_censored_int: e.target.value })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
              focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          >
            <option value="NA">NA</option>
            <option value="0">0</option>
          </select>
        </div>

        {/* Max Quantile */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-text mb-2">
            Max Quantile for Normalization: {config.msstats_max_quantile ?? 0.999}
          </label>
          <input
            type="range"
            min="0.9"
            max="1.0"
            step="0.001"
            data-testid="msstats-maxquantile-slider"
            value={config.msstats_max_quantile ?? 0.999}
            onChange={(e) => setConfig({ msstats_max_quantile: parseFloat(e.target.value) })}
            className="w-full h-2 bg-surface rounded-full appearance-none cursor-pointer accent-primary"
          />
        </div>

        {/* Remove >50% Missing */}
        <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
          <div>
            <span className="text-sm font-medium text-text">Remove Proteins &gt;50% Missing</span>
            <p className="text-xs text-text-muted mt-0.5">
              Remove proteins with more than 50% missing values across runs
            </p>
          </div>
          <input
            type="checkbox"
            data-testid="msstats-remove50-checkbox"
            checked={config.msstats_remove50missing ?? false}
            onChange={(e) => setConfig({ msstats_remove50missing: e.target.checked })}
            className="sr-only peer"
          />
          <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
            after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
            after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
            peer-checked:after:translate-x-5"
          />
        </label>
      </div>

      {/* Advanced Section Toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-semibold text-text hover:text-primary transition-colors w-full text-left"
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          MSstats Advanced
        </button>
        <p className="text-xs text-text-muted mt-0.5 ml-6">
          Fine-tune model fitting, feature filtering, and diagnostics
        </p>
      </div>

      {showAdvanced && (
        <div className="space-y-4 ml-2 pl-4 border-l-2 border-border">
          {/* Minimum Feature Count */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Minimum Feature Count
            </label>
            <input
              type="number"
              min={1}
              max={10}
              data-testid="msstats-min-feature-input"
              value={(config.min_peptides_per_protein ?? 1) > 1 ? (config.msstats_min_feature_count ?? 2) : 1}
              disabled={(config.min_peptides_per_protein ?? 1) <= 1}
              onChange={(e) => setConfig({ msstats_min_feature_count: parseInt(e.target.value, 10) || 2 })}
              className="w-24 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary
                disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-text-muted mt-1">
              {(config.min_peptides_per_protein ?? 1) > 1
                ? 'Minimum features (peptides) required per protein for summarization'
                : 'Locked to 1 while "Exclude Single-Peptide Proteins" is off'}
            </p>
          </div>

          {/* Remove Uninformative Feature Outliers */}
          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text">Remove Uninformative Feature Outliers</span>
              <p className="text-xs text-text-muted mt-0.5">
                Flag and remove outlier features detected during feature selection
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msstats-remove-outliers-checkbox"
              checked={config.msstats_remove_uninformative_feature_outlier ?? false}
              onChange={(e) => setConfig({ msstats_remove_uninformative_feature_outlier: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>

          {/* Equal Feature Variance (conditional on linear) */}
          {(config.msstats_summary_method === 'linear') && (
            <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
              <div>
                <span className="text-sm font-medium text-text">Equal Feature Variance</span>
                <p className="text-xs text-text-muted mt-0.5">
                  Assume equal variances across features (linear mixed model only)
                </p>
              </div>
              <input
                type="checkbox"
                data-testid="msstats-equal-var-checkbox"
                checked={config.msstats_equal_feature_var ?? true}
                onChange={(e) => setConfig({ msstats_equal_feature_var: e.target.checked })}
                className="sr-only peer"
              />
              <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                peer-checked:after:translate-x-5"
              />
            </label>
          )}

          {/* Standard Protein Names (conditional on GLOBALSTANDARDS) */}
          {(config.msstats_normalization === 'GLOBALSTANDARDS') && (
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Standard Protein Names
              </label>
              <input
                type="text"
                data-testid="msstats-standards-input"
                value={config.msstats_name_standards ?? ''}
                onChange={(e) => setConfig({ msstats_name_standards: e.target.value || undefined })}
                placeholder="e.g., P02768, P01023 (comma-separated)"
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-text-muted mt-1">
                Comma-separated UniProt IDs of reference proteins for global standards normalization
              </p>
            </div>
          )}

          {/* Number of Cores */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Number of CPU Cores
            </label>
            <input
              type="number"
              min={1}
              max={64}
              data-testid="msstats-cores-input"
              value={config.msstats_n_cores ?? 32}
              onChange={(e) => setConfig({ msstats_n_cores: parseInt(e.target.value, 10) || 32 })}
              className="w-24 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              CPU cores for parallel R processing (Steps 6-7). Higher values speed up large datasets.
            </p>
          </div>

          {/* Save Fitted Models */}
          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text">Save Fitted Models</span>
              <p className="text-xs text-text-muted mt-0.5">
                Store fitted linear models in output (disable for large datasets to reduce memory)
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msstats-save-models-checkbox"
              checked={config.msstats_save_fitted_models ?? true}
              onChange={(e) => setConfig({ msstats_save_fitted_models: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>
        </div>
      )}
    </div>
  );
}
