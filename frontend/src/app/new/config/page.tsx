/**
 * Step 3: Pipeline-Specific Configuration
 * Configure advanced parameters based on selected pipeline, then start analysis
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Play,
  Sliders,
  Dna,
  BarChart3,
  AlertCircle,
} from 'lucide-react';
import { useAnalysisStore, canStartAnalysis } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import MsstatsConfigForm from '@/components/analysis/MsstatsConfigForm';

function ConfigContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig, selectedPipeline } = state;
  const canStart = canStartAnalysis(state);
  const { addToast } = useUIStore();

  const [isStarting, setIsStarting] = React.useState(false);

  // Redirect guard: no session or no pipeline selected -> back to earlier step
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    } else if (!selectedPipeline) {
      router.replace(`/new/pipeline?session=${sessionId}`);
    }
  }, [sessionId, selectedPipeline, router]);

  const handleBack = () => {
    router.push(`/new/comparisons?session=${sessionId}`);
  };

  const handleStartAnalysis = async () => {
    if (!canStart || !sessionId) return;
    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      await processingApi.start(sessionId);
    } catch {
      addToast('error', 'Failed to start processing. Please try again.');
      setIsStarting(false);
      return;
    }

    router.push(`/analysis/processing?session_id=${sessionId}&pipeline=${selectedPipeline}`);
  };

  const pipelineLabel = selectedPipeline === 'msstats' ? 'MSstats' : 'msqrob2';
  const PipelineIcon = selectedPipeline === 'msstats' ? BarChart3 : Dna;

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          <PipelineIcon className="w-4 h-4" />
          {pipelineLabel} Pipeline
        </div>
        <h1 className="text-2xl font-bold text-text">Configuration</h1>
        <p className="text-text-muted mt-1">
          Set {pipelineLabel}-specific parameters before starting the analysis
        </p>
      </div>

      {/* Shared Advanced Parameters */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Sliders className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Advanced Parameters</h2>
            <p className="text-sm text-text-muted">
              Statistical thresholds applied during differential expression analysis
            </p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          {/* P-value threshold */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              P-Value Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.001"
                max="0.5"
                step="0.001"
                data-testid="pvalue-slider"
                value={config.pvalue_threshold ?? 0.05}
                onChange={(e) => setConfig({ pvalue_threshold: parseFloat(e.target.value) })}
                className="flex-1 h-2 bg-surface rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-sm
                  accent-primary"
              />
              <span className="w-16 text-sm font-mono text-text font-medium tabular-nums">
                {config.pvalue_threshold ?? 0.05}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Proteins with adjusted p-value below this threshold are considered significant
            </p>
          </div>

          {/* Log2 FC threshold */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Log2 Fold Change Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                data-testid="logfc-slider"
                value={config.logfc_threshold ?? 1.0}
                onChange={(e) => setConfig({ logfc_threshold: parseFloat(e.target.value) })}
                className="flex-1 h-2 bg-surface rounded-full appearance-none cursor-pointer
                  accent-primary
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary
                  [&::-webkit-slider-thumb]:rounded-full"
              />
              <span className="w-16 text-sm font-mono text-text font-medium tabular-nums">
                {config.logfc_threshold ?? 1.0}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Minimum absolute log2 fold change for biological significance
            </p>
          </div>

          {/* Min peptides per protein */}
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Minimum Peptides per Protein
            </label>
            <select
              data-testid="min-peptides-select"
              value={config.min_peptides_per_protein ?? 1}
              onChange={(e) => setConfig({ min_peptides_per_protein: parseInt(e.target.value, 10) })}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            >
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">
              Proteins with fewer peptides are excluded from analysis
            </p>
          </div>
        </div>
      </section>

      {/* MSstats-specific parameters */}
      {selectedPipeline === 'msstats' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-secondary" />
            <div>
              <h2 className="text-lg font-semibold text-text">MSstats Parameters</h2>
              <p className="text-sm text-text-muted">
                Configure MSstats-specific normalization and processing options
              </p>
            </div>
          </div>
          <div className="p-5">
            <MsstatsConfigForm config={config} setConfig={setConfig} />
          </div>
        </section>
      )}

      {/* Remembered experiment setup summary */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Experiment Summary</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Comparisons</span>
              <span className="text-text font-medium">
                {state.selectedPipeline && (config.comparisons?.length ?? 0) > 0
                  ? `${config.comparisons!.length} selected`
                  : '—'}
              </span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Organism</span>
              <span className="text-text font-medium capitalize">{config.organism || '—'}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Files Selected</span>
              <span className="text-text font-medium">{state.selectedFiles.size}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Validation warning */}
      {!canStart && state.selectedFiles.size > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/5 border border-warning/20 text-warning">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Configuration incomplete</p>
            <p className="text-sm mt-1">
              Go back to Upload & Setup to select files and configure treatment/control conditions.
            </p>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <button
          data-testid="config-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Comparisons
        </button>

        <button
          data-testid="start-analysis-btn"
          onClick={handleStartAnalysis}
          disabled={!canStart || isStarting}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            canStart && !isStarting
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-border text-text-muted cursor-not-allowed'
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

export default function ConfigPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <ConfigContent />
    </Suspense>
  );
}
