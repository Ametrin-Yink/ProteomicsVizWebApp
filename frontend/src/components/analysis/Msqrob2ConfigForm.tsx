'use client';

import React from 'react';
import type { SessionConfig } from '@/types';

interface Msqrob2ConfigFormProps {
  config: SessionConfig;
  setConfig: (partial: Partial<SessionConfig>) => void;
}

export default function Msqrob2ConfigForm({ config, setConfig }: Msqrob2ConfigFormProps) {
  return (
    <div className="space-y-5">
      {/* Normalization Method */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Normalization Method
        </label>
        <select
          data-testid="msqrob2-normalization-select"
          value={config.msqrob2_normalization ?? 'center.median'}
          onChange={(e) => setConfig({ msqrob2_normalization: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
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
        <label className="block text-sm font-medium text-text mb-2">
          Missing Value Imputation
        </label>
        <select
          data-testid="msqrob2-imputation-select"
          value={config.msqrob2_imputation ?? 'none'}
          onChange={(e) => setConfig({ msqrob2_imputation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
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
        <label className="block text-sm font-medium text-text mb-2">
          Protein Aggregation Method
        </label>
        <select
          data-testid="msqrob2-aggregation-select"
          value={config.msqrob2_aggregation ?? 'robustSummary'}
          onChange={(e) => setConfig({ msqrob2_aggregation: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
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
        <label className="block text-sm font-medium text-text mb-2">
          Differential Expression Model
        </label>
        <select
          data-testid="msqrob2-model-select"
          value={config.msqrob2_model ?? 'msqrobLm'}
          onChange={(e) => setConfig({ msqrob2_model: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
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
              <span className="text-sm font-medium text-text">Robust Estimation (M-estimation)</span>
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
              <span className="text-sm font-medium text-text">Ridge Penalty</span>
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

      {/* Multiple Testing Correction */}
      <div>
        <label className="block text-sm font-medium text-text mb-2">
          Multiple Testing Correction
        </label>
        <select
          data-testid="msqrob2-adjust-select"
          value={config.msqrob2_adjust_method ?? 'BH'}
          onChange={(e) => setConfig({ msqrob2_adjust_method: e.target.value })}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
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
