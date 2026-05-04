/**
 * ConfigPanel Component
 * Configuration form for analysis parameters
 */

'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Info, Loader2 } from 'lucide-react';
import { useAnalysisStore, getConditions, getAllPairwiseComparisons } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { organismsApi } from '@/lib/api-client';
import type { Organism } from '@/types';

export const ConfigPanel: React.FC<{ template?: string }> = ({ template }) => {
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [isLoadingOrganisms, setIsLoadingOrganisms] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState('');

  const state = useAnalysisStore();
  const { config, setConfig, setAvailableOrganisms } = state;
  const conditions = getConditions(state);
  const allComparisons = getAllPairwiseComparisons(state);
  const { addToast } = useUIStore();

  // Sync comparisons from config when conditions change
  useEffect(() => {
    if (template === 'multi_condition_comparison' && allComparisons.length > 0) {
      const existing = config.comparisons || [];
      const existingKeys = new Set(existing.map((c) => `${c.treatment}|${c.control}`));
      const allKeys = new Set(allComparisons.map((c) => `${c.treatment}|${c.control}`));
      // Auto-add new comparisons that aren't already in config
      const toAdd = allComparisons.filter((c) => !existingKeys.has(`${c.treatment}|${c.control}`));
      // Auto-remove comparisons whose conditions no longer exist
      const toKeep = existing.filter((c) => allKeys.has(`${c.treatment}|${c.control}`));
      if (toAdd.length > 0 || toKeep.length !== existing.length) {
        setConfig({ comparisons: [...toKeep, ...toAdd] });
      }
    }
  }, [conditions, template]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Load organisms on mount
  useEffect(() => {
    const loadOrganisms = async () => {
      setIsLoadingOrganisms(true);
      setLoadError(null);
      
      try {
        const data = await organismsApi.list();
        setOrganisms(data);
        setAvailableOrganisms(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load organisms';
        setLoadError(message);
        addToast('error', `Failed to load organisms: ${message}`);
      } finally {
        setIsLoadingOrganisms(false);
      }
    };
    
    loadOrganisms();
  }, [setAvailableOrganisms, addToast]);
  
  // Check if treatment and control are different
  const isTreatmentControlValid = config.treatment !== config.control || 
    config.treatment === '' || 
    config.control === '';
  
  // Toggle switch component - Enhanced for better usability
  const Toggle: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    description?: string;
  }> = ({ checked, onChange, label, description }) => (
    <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border hover:border-border transition-colors">
      <div className="flex-1 pr-4">
        <label className="text-base font-semibold text-text flex items-center gap-2">
          {label}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${checked ? 'bg-success/10 text-success' : 'bg-surface text-text-muted'}`}>
            {checked ? 'ON' : 'OFF'}
          </span>
        </label>
        {description && (
          <p className="text-sm text-text-muted mt-1">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-8 w-16 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
          ${checked ? 'bg-primary' : 'bg-border'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0
            transition duration-200 ease-in-out
            ${checked ? 'translate-x-8' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  );
  
  return (
    <div className="space-y-6" data-testid="config-form">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text">Analysis Configuration</h3>
        <p className="text-sm text-text-muted mt-1">
          Configure parameters for differential expression analysis
        </p>
      </div>
      
      {/* Treatment/Control Setup */}
      <div className="space-y-4 p-4 bg-surface rounded-lg">
        <h4 className="text-sm font-medium text-text uppercase tracking-wider">
          Treatment / Control Setup
        </h4>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Treatment Dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">
              Treatment
              <span className="text-error ml-1">*</span>
            </label>
            <select
              data-testid="treatment-select"
              value={config.treatment}
              onChange={(e) => setConfig({ treatment: e.target.value })}
              disabled={conditions.length === 0}
              className={`
                block w-full rounded-md border-border shadow-sm
                focus:border-primary focus:ring-primary sm:text-sm
                disabled:bg-surface disabled:text-text-muted
                ${!isTreatmentControlValid ? 'border-red-300' : ''}
              `}
            >
              <option value="">Select treatment...</option>
              {conditions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
            {conditions.length === 0 && (
              <p className="text-xs text-text-muted">
                Upload files to see available conditions
              </p>
            )}
          </div>
          
          {/* Control Dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">
              Control
              <span className="text-error ml-1">*</span>
            </label>
            <select
              data-testid="control-select"
              value={config.control}
              onChange={(e) => setConfig({ control: e.target.value })}
              disabled={conditions.length === 0}
              className={`
                block w-full rounded-md border-border shadow-sm
                focus:border-primary focus:ring-primary sm:text-sm
                disabled:bg-surface disabled:text-text-muted
                ${!isTreatmentControlValid ? 'border-red-300' : ''}
              `}
            >
              <option value="">Select control...</option>
              {conditions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Validation Error */}
        {!isTreatmentControlValid && (
          <div data-testid="config-error" className="flex items-center gap-2 text-sm text-error">
            <AlertCircle className="w-4 h-4" />
            <span>Treatment and Control must be different</span>
          </div>
        )}
      </div>
      
      {/* Organism Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">
          Organism
          <span className="text-error ml-1">*</span>
        </label>
        
        {isLoadingOrganisms ? (
          <div className="flex items-center gap-2 text-sm text-text-muted py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading organisms...</span>
          </div>
        ) : loadError ? (
          <div data-testid="config-error" className="flex items-center gap-2 text-sm text-error py-2">
            <AlertCircle className="w-4 h-4" />
            <span>{loadError}</span>
          </div>
        ) : (
          <select
            data-testid="organism-select"
            value={config.organism}
            onChange={(e) => setConfig({ organism: e.target.value })}
            className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
          >
            <option value="">Select organism...</option>
            {organisms
              .filter((org) => org.available)
              .map((organism) => (
                <option key={organism.id} value={organism.id}>
                  {organism.display_name}
                </option>
              ))}
          </select>
        )}
        
        {organisms.filter((org) => !org.available).length > 0 && (
          <p className="text-xs text-text-muted">
            {organisms.filter((org) => !org.available).length} organism(s) unavailable
          </p>
        )}
      </div>
      
      {/* Remove Razor Information */}
      <div data-testid="advanced-options-toggle">
        <div className="space-y-4">
            <h4 className="text-sm font-medium text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            Razor Peptide Handling
          </h4>
          <div data-testid="remove-razor-checkbox">
            <Toggle
              checked={config.remove_razor}
              onChange={(checked) => setConfig({ remove_razor: checked })}
              label="Remove Razor Peptides"
              description="Remove peptides that map to multiple proteins (razor peptides). Recommended for most analyses."
            />
          </div>

          {!config.remove_razor && (
            <div className="flex items-start gap-3 p-3 bg-warning/5 border border-warning/20 rounded-lg text-sm text-warning">
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Warning:</strong> Bioinformatics analysis will be less accurate if razor information is not removed.
              </span>
            </div>
          )}
        </div>

        {/* Strict Filtering */}
        <div className="space-y-4 mt-4">
          <h4 className="text-sm font-medium text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            Data Quality Filtering
          </h4>
          <div data-testid="strict-filtering-checkbox">
            <Toggle
              checked={config.strict_filtering}
              onChange={(checked) => setConfig({ strict_filtering: checked })}
              label="Strict Filtering"
              description="Apply stricter quality filters to the data. Improves reliability but may reduce coverage."
            />
          </div>
          
          <div className="flex items-start gap-3 p-3 bg-info/5 border-info/20 rounded-lg text-sm text-secondary">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Tip:</strong> Use strict filtering for high-confidence results.
              Disable for exploratory analysis to maximize coverage.
            </span>
          </div>
        </div>
      </div>

      {/* Multi-Condition: Metadata Grid */}
      {template === "multi_condition_comparison" && (
        <div data-testid="metadata-grid" className="space-y-4 mt-4 p-4 bg-surface rounded-lg">
          <h4 className="text-sm font-medium text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            Sample Metadata
          </h4>
          <p className="text-xs text-text-muted">
            Auto-populated from filenames. Add custom columns for covariates (e.g., batch, dose).
          </p>

          {/* Metadata Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 px-2 text-text-muted text-xs font-medium">Filename</th>
                  <th className="text-left py-1 px-2 text-text-muted text-xs font-medium">Experiment</th>
                  <th className="text-left py-1 px-2 text-text-muted text-xs font-medium">Condition</th>
                  <th className="text-left py-1 px-2 text-text-muted text-xs font-medium">Replicate</th>
                  {(config.metadata_columns ? Object.keys(config.metadata_columns[Object.keys(config.metadata_columns)[0]] || {}) : []).map((col) => (
                    <th key={col} className="text-left py-1 px-2 text-text-muted text-xs font-medium">
                      {col}
                      <button
                        onClick={() => {
                          const newCols = { ...config.metadata_columns };
                          for (const fn of Object.keys(newCols)) {
                            delete newCols[fn][col];
                          }
                          setConfig({ metadata_columns: newCols });
                        }}
                        className="ml-1 text-error hover:opacity-70"
                        title="Remove column"
                      >
                        ×
                      </button>
                    </th>
                  ))}
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {state.uploadedFiles.map((file) => {
                  const row = config.metadata_columns?.[file.filename] || {};
                  return (
                    <tr key={file.filename} className="border-b border-border/50">
                      <td className="py-1 px-2 text-text truncate max-w-[150px]" title={file.filename}>{file.filename}</td>
                      <td className="py-1 px-2 text-text">{file.experiment}</td>
                      <td className="py-1 px-2 text-text">{file.condition}</td>
                      <td className="py-1 px-2 text-text">{file.replicate}</td>
                      {(config.metadata_columns ? Object.keys(config.metadata_columns[Object.keys(config.metadata_columns)[0]] || {}) : []).map((col) => (
                        <td key={col}>
                          <input
                            type="text"
                            value={row[col] || ''}
                            onChange={(e) => {
                              const newCols = {
                                ...(config.metadata_columns || {}),
                                [file.filename]: {
                                  ...(config.metadata_columns?.[file.filename] || {}),
                                  [col]: e.target.value,
                                },
                              };
                              setConfig({ metadata_columns: newCols });
                            }}
                            className="w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary text-xs px-2 py-1"
                            placeholder="-"
                          />
                        </td>
                      ))}
                      <td></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add Column */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newColumnName.trim()) {
                  const col = newColumnName.trim();
                  setConfig({ metadata_columns: config.metadata_columns || {} });
                  // Initialize column for all files
                  const newCols: Record<string, Record<string, string>> = {};
                  for (const file of state.uploadedFiles) {
                    newCols[file.filename] = { ...(config.metadata_columns?.[file.filename] || {}), [col]: '' };
                  }
                  setConfig({ metadata_columns: newCols });
                  setNewColumnName('');
                }
              }}
              className="flex-1 rounded-md border-border shadow-sm focus:border-primary focus:ring-primary text-sm px-2 py-1"
              placeholder="New column name (press Enter)"
            />
          </div>
        </div>
      )}

      {/* Multi-Condition: Comparison Matrix */}
      {template === "multi_condition_comparison" && (
        <div data-testid="comparison-matrix" className="space-y-4 mt-4 p-4 bg-surface rounded-lg">
          <h4 className="text-sm font-medium text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            Comparisons
          </h4>
          <p className="text-xs text-text-muted">
            Select which pairwise comparisons to compute.
          </p>

          {/* Select All / Clear All */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfig({ comparisons: [...allComparisons] })}
              className="text-xs text-primary hover:underline"
            >
              Select All
            </button>
            <span className="text-text-muted">|</span>
            <button
              type="button"
              onClick={() => setConfig({ comparisons: [] })}
              className="text-xs text-primary hover:underline"
            >
              Clear All
            </button>
          </div>

          {/* Comparison List */}
          {allComparisons.length === 0 ? (
            <p className="text-xs text-text-muted italic">Upload files with at least 2 conditions to see comparisons.</p>
          ) : (
            <div className="space-y-1">
              {allComparisons.map((comp) => {
                const enabled = (config.comparisons || []).some(
                  (c) => c.treatment === comp.treatment && c.control === comp.control
                );
                return (
                  <label key={`${comp.treatment}|${comp.control}`} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        const current = config.comparisons || [];
                        if (e.target.checked) {
                          setConfig({ comparisons: [...current, comp] });
                        } else {
                          setConfig({
                            comparisons: current.filter(
                              (c) => !(c.treatment === comp.treatment && c.control === comp.control)
                            ),
                          });
                        }
                      }}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-text">{comp.treatment} vs {comp.control}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Multi-Condition: MSstats Options (expanded) */}
      {template === "multi_condition_comparison" && (
        <div className="space-y-4 mt-4">
          <h4 className="text-sm font-medium text-text uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-primary rounded-full"></span>
            MSstats Options
          </h4>

          {/* Normalization Method */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Normalization</label>
            <select
              value={config.msstats_normalization || "equalizeMedians"}
              onChange={(e) => setConfig({ msstats_normalization: e.target.value })}
              className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            >
              <option value="equalizeMedians">Equalize Medians (default)</option>
              <option value="quantile">Quantile</option>
            </select>
          </div>

          {/* Feature Selection */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Feature Selection</label>
            <select
              value={config.msstats_feature_selection || "all"}
              onChange={(e) => setConfig({ msstats_feature_selection: e.target.value })}
              className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            >
              <option value="all">All Features (default)</option>
              <option value="top3">Top 3 Features</option>
            </select>
          </div>

          {/* Summary Method */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Summary Method</label>
            <select
              value={config.msstats_summary_method || "TMP"}
              onChange={(e) => setConfig({ msstats_summary_method: e.target.value })}
              className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            >
              <option value="TMP">Tukey Median Polish (default)</option>
              <option value="linear">Linear Mixed Model</option>
            </select>
          </div>

          {/* Imputation Controls */}
          <div className="space-y-3">
            <Toggle
              checked={config.msstats_impute ?? true}
              onChange={(checked) => setConfig({ msstats_impute: checked })}
              label="Model-based Imputation (MBimpute)"
              description="Use survival analysis to impute censored missing values. Recommended for most analyses."
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text">Censored Missing Values Encoded As</label>
                <select
                  value={config.msstats_censored_int || "NA"}
                  onChange={(e) => setConfig({ msstats_censored_int: e.target.value })}
                  className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                >
                  <option value="NA">NA</option>
                  <option value="0">0 (zero)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text">Max Quantile for Censored Cutoff</label>
                <input
                  type="number"
                  step="0.001"
                  min="0.9"
                  max="1"
                  value={config.msstats_max_quantile ?? 0.999}
                  onChange={(e) => setConfig({ msstats_max_quantile: parseFloat(e.target.value) })}
                  className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                />
              </div>
            </div>
            <Toggle
              checked={config.msstats_remove50missing ?? false}
              onChange={(checked) => setConfig({ msstats_remove50missing: checked })}
              label="Remove Proteins with &gt;50% Missing Values"
              description="Remove proteins where more than half the values are missing before summarization."
            />
          </div>

          {/* Log Base */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Log Base</label>
            <select
              value={config.msstats_log_base ?? 2}
              onChange={(e) => setConfig({ msstats_log_base: parseInt(e.target.value) })}
              className="block w-full rounded-md border-border shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
            >
              <option value={2}>2 (default)</option>
              <option value={10}>10</option>
              <option value={0}>Natural log (e)</option>
            </select>
          </div>
        </div>
      )}

      {/* Configuration Summary */}
      <div data-testid="config-summary" className="border-t border-border pt-4">
        <h4 className="text-sm font-medium text-text mb-3">Configuration Summary</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Treatment:</span>
            <span className={config.treatment ? 'text-text font-medium' : 'text-text-muted'}>
              {config.treatment || 'Not selected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Control:</span>
            <span className={config.control ? 'text-text font-medium' : 'text-text-muted'}>
              {config.control || 'Not selected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Organism:</span>
            <span className={config.organism ? 'text-text font-medium' : 'text-text-muted'}>
              {config.organism 
                ? organisms.find(o => o.id === config.organism)?.display_name || config.organism
                : 'Not selected'
              }
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Remove Razor:</span>
            <span className={config.remove_razor ? 'text-success' : 'text-text-secondary'}>
              {config.remove_razor ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Strict Filtering:</span>
            <span className={config.strict_filtering ? 'text-success' : 'text-text-secondary'}>
              {config.strict_filtering ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;
