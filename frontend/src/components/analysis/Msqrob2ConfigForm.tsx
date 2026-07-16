'use client';

import React, { useMemo } from 'react';
import type { SessionConfig } from '@/types';
import { HelpTooltip } from '@/components/ui/HelpTooltip';

interface Msqrob2ConfigFormProps {
  config: SessionConfig;
  setConfig: (partial: Partial<SessionConfig>) => void;
  metadataColumns?: Record<string, Record<string, string>>;
}

export default function Msqrob2ConfigForm({ config, setConfig, metadataColumns }: Msqrob2ConfigFormProps) {
  const customColumnNames = useMemo(() => {
    if (!metadataColumns) return [];
    const cols = new Set<string>();
    Object.values(metadataColumns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols).sort();
  }, [metadataColumns]);

  return (
    <div className="space-y-5">
      {/* Normalization Method */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Normalization Method
          <HelpTooltip text="Normalization corrects for systematic technical variation across samples, such as differences in total peptide loading or labeling efficiency. 'Center Median' (shift to max) is the recommended default for most TMT-based experiments." />
        </label>
        <select
          data-testid="msqrob2-normalization-select"
          value={config.msqrob2_normalization ?? 'center.median'}
          onChange={(e) => setConfig({ msqrob2_normalization: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="center.median">Center Median (shift to max)</option>
          <option value="center.mean">Center Mean</option>
          <option value="quantiles">Quantiles</option>
          <option value="quantiles.robust">Robust Quantiles</option>
          <option value="vsn">VSN (Variance Stabilization)</option>
          <option value="div.median">Divide by Median</option>
          <option value="none">None (No Normalization)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Normalization corrects for systematic technical variation across samples
        </p>
      </div>

      {/* Imputation Method */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Missing Value Imputation
          <HelpTooltip text="Imputation fills in missing peptide intensities before protein aggregation. 'None' filters out peptides with missing values. KNN uses k-nearest neighbors to estimate missing values. BPCA and MLE use model-based approaches. MinDet/MinProb use distribution-based methods. Choose based on the missing data pattern in your dataset." />
        </label>
        <select
          data-testid="msqrob2-imputation-select"
          value={config.msqrob2_imputation ?? 'none'}
          onChange={(e) => setConfig({ msqrob2_imputation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="none">None (Filter only)</option>
          <option value="knn">KNN (k-Nearest Neighbors)</option>
          <option value="bpca">BPCA (Bayesian PCA)</option>
          <option value="MinDet">MinDet (Deterministic Minimum)</option>
          <option value="MinProb">MinProb (Probabilistic Minimum)</option>
          <option value="QRILC">QRILC (Quantile Regression)</option>
          <option value="MLE">MLE (Maximum Likelihood)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Impute missing peptide intensities before protein aggregation
        </p>
      </div>

      {/* Aggregation Method */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Protein Aggregation Method
          <HelpTooltip text="How peptide-level intensities are combined into protein-level abundance estimates. 'Robust Summary' (MAD-based) is recommended as it is resistant to outlier peptides. 'Median Polish' uses Tukey's additive model. 'Sum' and 'Mean' are simpler but more sensitive to outliers." />
        </label>
        <select
          data-testid="msqrob2-aggregation-select"
          value={config.msqrob2_aggregation ?? 'robustSummary'}
          onChange={(e) => setConfig({ msqrob2_aggregation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="robustSummary">Robust Summary (MAD-based, recommended)</option>
          <option value="medianPolish">Median Polish (Tukey)</option>
          <option value="sum">Sum</option>
          <option value="mean">Mean</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          How peptide intensities are combined into protein-level values
        </p>
      </div>

      {/* DE Model */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Differential Expression Model
          <HelpTooltip text="The statistical model used for detecting differentially expressed proteins. 'msqrobLm' uses M-estimation with Huber weights, providing resistance to outliers. 'msqrobGlm' uses a generalized linear model, suitable for count-based or non-normal data." />
        </label>
        <select
          data-testid="msqrob2-model-select"
          value={config.msqrob2_model ?? 'msqrobLm'}
          onChange={(e) => setConfig({ msqrob2_model: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="msqrobLm">msqrobLm (Robust Linear Model, recommended)</option>
          <option value="msqrobGlm">msqrobGlm (Generalized Linear Model)</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          msqrobLm uses M-estimation with Huber weights for outlier resistance
        </p>
      </div>

      {/* Robust estimation toggle (only visible when model is msqrobLm) */}
      {(config.msqrob2_model ?? 'msqrobLm') === 'msqrobLm' && (
        <>
          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text-primary">Robust Estimation (M-estimation)</span>
              <p className="text-xs text-text-muted mt-0.5">
                Use Huber weights to down-weight outlier observations
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msqrob2-robust-checkbox"
              checked={config.msqrob2_robust ?? true}
              onChange={(e) => setConfig({ msqrob2_robust: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>

          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text-primary">Ridge Penalty</span>
              <p className="text-xs text-text-muted mt-0.5">
                Apply ridge regression penalty for high-dimensional designs
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="msqrob2-ridge-checkbox"
              checked={config.msqrob2_ridge ?? false}
              onChange={(e) => setConfig({ msqrob2_ridge: e.target.checked })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>
        </>
      )}

      {/* Batch Correction */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Batch Correction
          <HelpTooltip text="If your samples were measured across multiple batches (e.g., different TMT runs), select the metadata column that identifies batch membership. The linear model will include batch as a covariate via limma's removeBatchEffect, reducing unwanted technical variation." />
        </label>
        <select
          data-testid="msqrob2-batch-column-select"
          value={config.msqrob2_batch_column ?? 'batch'}
          onChange={(e) => setConfig({ msqrob2_batch_column: e.target.value || undefined })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="">None (No batch correction)</option>
          {customColumnNames.map((col) => (
            <option key={col} value={col}>{col}</option>
          ))}
        </select>
        <p className="text-xs text-text-muted mt-1">
          Include a metadata column as batch covariate in the linear model (limma removeBatchEffect).
          Add custom columns (e.g. &ldquo;Batch&rdquo;) on the Upload page metadata table.
        </p>
      </div>

      {/* Multiple Testing Correction */}
      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Multiple Testing Correction
          <HelpTooltip text="When testing thousands of proteins simultaneously, p-values must be adjusted to control the false discovery rate (FDR). Benjamini-Hochberg (BH) is the standard method, controlling the expected proportion of false positives. Bonferroni is more conservative, controlling the family-wise error rate." />
        </label>
        <select
          data-testid="msqrob2-adjust-select"
          value={config.msqrob2_adjust_method ?? 'BH'}
          onChange={(e) => setConfig({ msqrob2_adjust_method: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
            focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          <option value="BH">Benjamini-Hochberg (BH, recommended)</option>
          <option value="bonferroni">Bonferroni</option>
          <option value="holm">Holm</option>
          <option value="BY">Benjamini-Yekutieli (BY)</option>
          <option value="fdr">FDR</option>
        </select>
        <p className="text-xs text-text-muted mt-1">
          Method for adjusting p-values to control false discovery rate
        </p>
      </div>
    </div>
  );
}
