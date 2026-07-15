'use client';

import React, { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Play, Loader2, Dna, BarChart3,
  FileText, Table2, GitCompare, Sliders, CheckCircle,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useAnalysisStore, getPipelineFromType } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';
import { cn, formatGroup } from '@/lib/utils';

function SectionHeader({
  icon: Icon,
  title,
  collapsed,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full px-5 py-3 border-b border-border flex items-center gap-3 hover:bg-surface/50 transition-colors text-left"
    >
      <Icon className="w-5 h-5 text-primary flex-shrink-0" />
      <div className="flex-1">
        <h2 className="font-semibold text-text-primary">{title}</h2>
      </div>
      {collapsed ? (
        <ChevronRight className="w-4 h-4 text-text-muted" />
      ) : (
        <ChevronDown className="w-4 h-4 text-text-muted" />
      )}
    </button>
  );
}

function SummaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const config = useAnalysisStore((s) => s.config);
  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const availableOrganisms = useAnalysisStore((s) => s.availableOrganisms);
  const selectedPipeline = getPipelineFromType(analysisType);
  const { addToast } = useUIStore();

  // Warn user before leaving page with unsaved data
  const beforeUnloadRef = useRef<((e: BeforeUnloadEvent) => void) | null>(null);
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    beforeUnloadRef.current = handler;
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      beforeUnloadRef.current = null;
    };
  }, []);

  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = React.useState(false);

  const toggleSection = (name: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };
  const isCollapsed = (name: string) => collapsedSections.has(name);

  React.useEffect(() => {
    if (!sessionId) { router.replace('/'); }
    else if (!analysisType) { router.replace('/'); }
  }, [sessionId, analysisType, router]);

  // Derive data column names from metadata_columns
  const dataColumns = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const coreCols = new Set(['experiment', 'replicate', 'batch']);
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (!coreCols.has(k)) cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns]);

  const totalSize = React.useMemo(
    () => uploadedFiles.reduce((sum, f) => sum + f.size, 0),
    [uploadedFiles]
  );

  const organismLabel = React.useMemo(() => {
    const org = availableOrganisms.find((o) => o.id === config.organism);
    return org?.display_name || config.organism || 'Not selected';
  }, [config.organism, availableOrganisms]);

  const handleBack = () => {
    router.push(`/new/config?session=${sessionId}`);
  };

  const handleStartAnalysis = async () => {
    if (!sessionId) return;

    // D-027: Confirm before starting
    if (!window.confirm('Are you sure you want to start the analysis? This will begin processing your data and cannot be undone.')) {
      return;
    }

    // Remove beforeunload handler so it doesn't trap user during programmatic navigation
    const handler = beforeUnloadRef.current;
    if (handler) window.removeEventListener('beforeunload', handler);

    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsStarting(false);
      return;
    }

    try {
      await processingApi.start(sessionId);
    } catch (error) {
      addToast('error', `Failed to start processing: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsStarting(false);
      return;
    }

    const params = new URLSearchParams({
      session_id: sessionId,
      pipeline: selectedPipeline ?? 'msqrob2',
      remove_razor: String(config.remove_razor ?? true),
    });
    router.replace(`/analysis/processing?${params}`);
  };

  // D-028: Disable button when prereqs not met
  const canStartAnalysis = sessionId && analysisType && config.organism && config.comparisons && config.comparisons.length > 0;
  const startButtonTitle = !canStartAnalysis
    ? 'Ensure an organism is selected and comparisons are defined before starting.'
    : undefined;

  const pipelineLabel = selectedPipeline === 'msstats' ? 'MSstats' : 'msqrob2';
  const PipelineIcon = selectedPipeline === 'msstats' ? BarChart3 : Dna;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          <CheckCircle className="w-4 h-4" />
          Review & Confirm
        </div>
        <h1 className="font-bold text-text-primary">Analysis Summary</h1>
        <p className="text-text-muted mt-1">
          Review all settings before starting the analysis
        </p>
      </div>

      {/* Pipeline */}
      <section className="bg-background border border-border rounded-lg">
        <SectionHeader icon={PipelineIcon} title="Pipeline" collapsed={isCollapsed('pipeline')} onToggle={() => toggleSection('pipeline')} />
        {!isCollapsed('pipeline') && (
        <div className="p-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <PipelineIcon className="w-4 h-4" />
            {pipelineLabel}
          </span>
        </div>
        )}
      </section>

      {/* Files */}
      <section className="bg-background border border-border rounded-lg">
        <SectionHeader icon={FileText} title="Files" collapsed={isCollapsed('files')} onToggle={() => toggleSection('files')} />
        {!isCollapsed('files') && (
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Files</span>
              <span className="text-text-primary font-medium">{uploadedFiles.length}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Size</span>
              <span className="text-text-primary font-medium">{(totalSize / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          </div>
        </div>
        )}
      </section>

      {/* Experiment Structure (read-only) */}
      <section className="bg-background border border-border rounded-lg">
        <SectionHeader icon={Table2} title="Experiment Structure" collapsed={isCollapsed('experiment')} onToggle={() => toggleSection('experiment')} />
        {!isCollapsed('experiment') && (
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Filename</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Experiment</th>
                  {dataColumns.map((col) => (
                    <th key={col} className="text-left py-2 px-3 text-text-muted font-medium text-xs">{col}</th>
                  ))}
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Replicate</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Batch</th>
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => {
                  const meta = config.metadata_columns?.[file.filename] || {};
                  return (
                    <tr key={file.filename} className="border-b border-border/50">
                      <td className="py-1.5 px-3 text-text-primary text-xs font-mono truncate max-w-[200px]" title={file.filename}>
                        {file.filename}
                      </td>
                      <td className="py-1.5 px-3 text-text-primary text-xs">{meta.experiment || file.experiment}</td>
                      {dataColumns.map((col) => (
                        <td key={col} className="py-1.5 px-3 text-text-primary text-xs">{meta[col] || '—'}</td>
                      ))}
                      <td className="py-1.5 px-3 text-text-primary text-xs font-mono">#{meta.replicate || file.replicate}</td>
                      <td className="py-1.5 px-3 text-text-primary text-xs font-mono">{meta.batch || file.batch || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </section>

      {/* TMT Channel Mapping */}
      {analysisType === 'tmt' && config.tmt_channel_mapping && (
        <section className="bg-background border border-border rounded-lg">
          <SectionHeader icon={Table2} title="TMT Channel Mapping" collapsed={isCollapsed('tmt-mapping')} onToggle={() => toggleSection('tmt-mapping')} />
          {!isCollapsed('tmt-mapping') && (
          <div className="p-5">
            <div className="border border-border rounded-lg overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface">
                  <tr>
                    <th className="px-3 py-2 text-left">Channel</th>
                    <th className="px-3 py-2 text-left">Condition</th>
                    <th className="px-3 py-2 text-left">Replicate</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(config.tmt_channel_mapping).map(([key, entry]) => (
                    <tr key={key} className="border-t border-border">
                      <td className="px-3 py-1.5">{key.split('::')[1] || key}</td>
                      <td className="px-3 py-1.5">
                        {Object.entries(entry)
                          .filter(([k]) => k !== 'replicate' && k !== 'experiment')
                          .map(([k, v]) => `${k}=${v}`).join(', ') || '—'}
                      </td>
                      <td className="px-3 py-1.5">{entry.replicate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </section>
      )}

      {/* Comparisons */}
      <section className="bg-background border border-border rounded-lg">
        <SectionHeader icon={GitCompare} title="Comparisons" collapsed={isCollapsed('comparisons')} onToggle={() => toggleSection('comparisons')} />
        {!isCollapsed('comparisons') && (
        <div className="p-5">
          {(!config.comparisons || config.comparisons.length === 0) ? (
            <p className="text-sm text-text-muted italic">No comparisons defined</p>
          ) : (
            <div className="space-y-1">
              {config.comparisons.map((comp, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-text-primary px-3 py-2 bg-surface rounded-lg border border-border">
                  <span className="font-medium text-[var(--color-info)]">{formatGroup(comp.group1)}</span>
                  <span className="text-text-muted">vs</span>
                  <span className="font-medium text-[var(--color-error)]">{formatGroup(comp.group2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </section>

      {/* Configuration */}
      <section className="bg-background border border-border rounded-lg">
        <SectionHeader icon={Sliders} title="Configuration" collapsed={isCollapsed('config')} onToggle={() => toggleSection('config')} />
        {!isCollapsed('config') && (
        <div className="p-5 space-y-4">
          {/* Shared params */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Organism</span>
              <span className="text-text-primary font-medium">{organismLabel}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Remove Razor Peptides</span>
              <span className={cn('font-medium', config.remove_razor ? 'text-success' : 'text-text-muted')}>
                {config.remove_razor ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Strict Filtering</span>
              <span className={cn('font-medium', config.strict_filtering ? 'text-success' : 'text-text-muted')}>
                {config.strict_filtering ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">P-Value Threshold</span>
              <span className="text-text-primary font-medium">{config.pvalue_threshold ?? 0.05}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Log2 FC Threshold</span>
              <span className="text-text-primary font-medium">{config.logfc_threshold ?? 1.0}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Min Peptides per Protein</span>
              <span className="text-text-primary font-medium">{config.min_peptides_per_protein ?? 1}</span>
            </div>
          </div>

          {/* msqrob2 params */}
          {selectedPipeline === 'msqrob2' && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-2 border-t border-border">msqrob2 Parameters</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Normalization</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_normalization ?? 'center.median'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Imputation</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_imputation ?? 'none'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Aggregation</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_aggregation ?? 'robustSummary'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">DE Model</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_model ?? 'msqrobLm'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Robust Estimation</span>
                  <span className={cn('font-medium', config.msqrob2_robust !== false ? 'text-success' : 'text-text-muted')}>
                    {config.msqrob2_robust !== false ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Ridge Penalty</span>
                  <span className={cn('font-medium', config.msqrob2_ridge ? 'text-success' : 'text-text-muted')}>
                    {config.msqrob2_ridge ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Multiple Testing Correction</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_adjust_method ?? 'BH'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Batch Correction</span>
                  <span className="text-text-primary font-medium">{config.msqrob2_batch_column || 'None'}</span>
                </div>
              </div>
            </div>
          )}

          {/* MSstats params */}
          {selectedPipeline === 'msstats' && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-2 border-t border-border">MSstats Parameters</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Normalization</span>
                  <span className="text-text-primary font-medium">{config.msstats_normalization ?? 'equalizeMedians'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Feature Selection</span>
                  <span className="text-text-primary font-medium">{config.msstats_feature_selection ?? 'all'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Summary Method</span>
                  <span className="text-text-primary font-medium">{config.msstats_summary_method ?? 'TMP'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Impute</span>
                  <span className={cn('font-medium', config.msstats_impute !== false ? 'text-success' : 'text-text-muted')}>
                    {config.msstats_impute !== false ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Log Base</span>
                  <span className="text-text-primary font-medium">{config.msstats_log_base ?? 2}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Censored Int</span>
                  <span className="text-text-primary font-medium">{config.msstats_censored_int ?? 'NA'}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Max Quantile</span>
                  <span className="text-text-primary font-medium">{config.msstats_max_quantile ?? 0.999}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Remove 50% Missing</span>
                  <span className={cn('font-medium', config.msstats_remove50missing ? 'text-success' : 'text-text-muted')}>
                    {config.msstats_remove50missing ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">N Top Feature</span>
                  <span className="text-text-primary font-medium">{config.msstats_n_top_feature ?? 3}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Min Feature Count</span>
                  <span className="text-text-primary font-medium">{config.msstats_min_feature_count ?? 2}</span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Remove Outlier Features</span>
                  <span className={cn('font-medium', config.msstats_remove_uninformative_feature_outlier ? 'text-success' : 'text-text-muted')}>
                    {config.msstats_remove_uninformative_feature_outlier ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="bg-surface rounded-lg p-3">
                  <span className="text-text-muted block text-xs">Equal Feature Var</span>
                  <span className={cn('font-medium', config.msstats_equal_feature_var !== false ? 'text-success' : 'text-text-muted')}>
                    {config.msstats_equal_feature_var !== false ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Covariates (both pipelines) */}
          {(config.covariate_columns?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider pt-2 border-t border-border">Covariates</h3>
              <div className="flex flex-wrap gap-2">
                {config.covariate_columns?.map((col) => (
                  <span key={col} className="px-3 py-1 bg-primary/10 border border-primary/30 rounded-lg text-sm text-primary">{col}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </section>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary bg-surface border border-border rounded-lg hover:bg-border/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Configuration
        </button>
        <div className="relative" title={startButtonTitle}>
          <button
            data-testid="summary-start-analysis-btn"
            onClick={handleStartAnalysis}
            disabled={isStarting || !canStartAnalysis}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all duration-200',
              isStarting || !canStartAnalysis
                ? 'bg-surface text-text-muted cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
            )}
          >
            {isStarting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Starting Analysis...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Start Analysis
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>}>
      <SummaryContent />
    </Suspense>
  );
}
