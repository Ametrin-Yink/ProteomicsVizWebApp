'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Play, Loader2, Dna, BarChart3,
  FileText, Table2, GitCompare, Sliders, CheckCircle,
} from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';
import { cn, formatGroup } from '@/lib/utils';

function SummaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const config = useAnalysisStore((s) => s.config);
  const selectedPipeline = useAnalysisStore((s) => s.selectedPipeline);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const availableOrganisms = useAnalysisStore((s) => s.availableOrganisms);
  const { addToast } = useUIStore();

  const [isStarting, setIsStarting] = React.useState(false);

  React.useEffect(() => {
    if (!sessionId) { router.replace('/'); }
    else if (!selectedPipeline) { router.replace(`/new/pipeline?session=${sessionId}`); }
  }, [sessionId, selectedPipeline, router]);

  const maxConditions = React.useMemo(
    () => uploadedFiles.reduce((max, f) => Math.max(max, f.conditions.length), 0),
    [uploadedFiles],
  );

  const customColumns = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const conditionColSet = new Set(
      Array.from({ length: maxConditions }, (_, i) => `condition_${i + 1}`),
    );
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && !conditionColSet.has(k) && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns, maxConditions]);

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

    router.push(`/analysis/processing?session_id=${sessionId}&pipeline=${selectedPipeline}`);
  };

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
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <PipelineIcon className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Pipeline</h2>
          </div>
        </div>
        <div className="p-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <PipelineIcon className="w-4 h-4" />
            {pipelineLabel}
          </span>
        </div>
      </section>

      {/* Files */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Files</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Files</span>
              <span className="text-text-primaryfont-medium">{uploadedFiles.length}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Size</span>
              <span className="text-text-primaryfont-medium">{(totalSize / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          </div>
        </div>
      </section>

      {/* Experiment Structure (read-only) */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Table2 className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Experiment Structure</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Filename</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Experiment</th>
                  {Array.from({ length: maxConditions }, (_, i) => (
                    <th key={`cond-${i}`} className="text-left py-2 px-3 text-text-muted font-medium text-xs">Condition {i + 1}</th>
                  ))}
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Replicate</th>
                  {customColumns.map((col) => (
                    <th key={col} className="text-left py-2 px-3 text-text-muted font-medium text-xs">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => {
                  const meta = config.metadata_columns?.[file.filename] || {};
                  return (
                    <tr key={file.filename} className="border-b border-border/50">
                      <td className="py-1.5 px-3 text-text-primarytext-xs font-mono truncate max-w-[200px]" title={file.filename}>
                        {file.filename}
                      </td>
                      <td className="py-1.5 px-3 text-text-primarytext-xs">{meta.experiment || file.experiment}</td>
                      {Array.from({ length: maxConditions }, (_, i) => (
                        <td key={`cond-${i}`} className="py-1.5 px-3 text-text-primarytext-xs">{file.conditions[i] || '—'}</td>
                      ))}
                      <td className="py-1.5 px-3 text-text-primarytext-xs font-mono">#{meta.replicate || file.replicate}</td>
                      {customColumns.map((col) => (
                        <td key={col} className="py-1.5 px-3 text-text-primarytext-xs">{meta[col] || '—'}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Comparisons */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Comparisons</h2>
          </div>
        </div>
        <div className="p-5">
          {(!config.comparisons || config.comparisons.length === 0) ? (
            <p className="text-sm text-text-muted italic">No comparisons defined</p>
          ) : (
            <div className="space-y-1">
              {config.comparisons.map((comp, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-text-primarypx-3 py-2 bg-surface rounded-lg border border-border">
                  <span className="font-medium text-blue-700">{formatGroup(comp.group1)}</span>
                  <span className="text-text-muted">vs</span>
                  <span className="font-medium text-red-700">{formatGroup(comp.group2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Configuration */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Sliders className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Configuration</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Organism</span>
              <span className="text-text-primaryfont-medium">{organismLabel}</span>
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
              <span className="text-text-primaryfont-medium">{config.pvalue_threshold ?? 0.05}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Log2 FC Threshold</span>
              <span className="text-text-primaryfont-medium">{config.logfc_threshold ?? 1.0}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Min Peptides per Protein</span>
              <span className="text-text-primaryfont-medium">{config.min_peptides_per_protein ?? 1}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Covariates (MSstats only) */}
      {selectedPipeline === 'msstats' && (config.covariate_columns?.length ?? 0) > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-text-primary">Covariates</h2>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              {config.covariate_columns?.map((col) => (
                <span key={col} className="px-3 py-1 bg-primary/10 border border-primary/30 rounded-lg text-sm text-primary">
                  {col}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primarybg-surface border border-border rounded-lg hover:bg-border/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Configuration
        </button>
        <button
          data-testid="summary-start-analysis-btn"
          onClick={handleStartAnalysis}
          disabled={isStarting}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
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
