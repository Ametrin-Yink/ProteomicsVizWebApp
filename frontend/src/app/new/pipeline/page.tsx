/**
 * Step 2: Pipeline Selection
 * Choose between msqrob2 and MSstats analysis pipelines
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Dna, BarChart3, Check, Info } from 'lucide-react';
import { useAnalysisStore, getValidation, getConditions } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { organismsApi, sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const pipelines = [
  {
    id: 'msqrob2' as const,
    name: 'msqrob2',
    title: 'Robust Protein Analysis',
    icon: Dna,
    description:
      'Uses robust M-estimation with ridge penalty for protein-level aggregation and differential expression via limma. Best for experiments with expected outliers or heterogeneous variance.',
    features: [
      'Robust regression (M-estimation)',
      'limma-based differential expression',
      'Handles missing values via ridge penalty',
      'Well-suited for TMT-labeled data',
    ],
    gradient: 'from-[#E73564] to-[#C42A52]',
  },
  {
    id: 'msstats' as const,
    name: 'MSstats',
    title: 'Statistical Modeling',
    icon: BarChart3,
    description:
      'Uses linear mixed models and Tukey median polish for protein abundance, with flexible normalization and imputation. Best for label-free or complex experimental designs.',
    features: [
      'Linear mixed models / Tukey median polish',
      'Multiple normalization options',
      'Model-based imputation (MBimpute)',
      'Handles complex experimental designs',
    ],
    gradient: 'from-[#00ADEF] to-[#0088CC]',
  },
];

function PipelineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { selectedPipeline, setPipeline, config, setConfig, setAvailableOrganisms, availableOrganisms } = state;
  const conditions = getConditions(state);
  const validation = getValidation(state);
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = React.useState(false);

  // Load organisms on mount
  React.useEffect(() => {
    if (!sessionId) return;
    const loadOrganisms = async () => {
      try {
        const organisms = await organismsApi.list();
        setAvailableOrganisms(
          organisms.map((o) => ({
            id: o.id,
            name: o.name,
            display_name: o.display_name || o.name,
            available: o.available,
          }))
        );
      } catch (error) {
        console.error('Failed to load organisms:', error);
      }
    };
    loadOrganisms();
  }, [sessionId, setAvailableOrganisms]);

  // Redirect guard: no session or no uploaded files -> back to first step
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    } else if (state.uploadedFiles.length === 0 && state.selectedFiles.size === 0) {
      router.replace(`/new/upload?session=${sessionId}`);
    }
  }, [sessionId, state.uploadedFiles.length, state.selectedFiles.size, router]);

  const canContinue =
    selectedPipeline !== null &&
    config.organism !== '' &&
    validation.isValid;

  const handleBack = () => {
    router.push(`/new/upload?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (!sessionId) return;

    // Read latest state directly to avoid stale closure
    const latest = useAnalysisStore.getState();
    if (!latest.selectedPipeline || !latest.config.organism) return;

    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, {
        ...latest.config,
        pipeline: latest.selectedPipeline,
      });
      router.push(`/new/comparisons?session=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save pipeline selection';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div className="text-center mb-8">
        <h1 className="font-bold text-text-primary">Choose Analysis Pipeline</h1>
        <p className="text-text-muted mt-1">
          Select the statistical method for protein abundance and differential expression
        </p>
      </div>

      {/* Experiment Configuration */}
      {conditions.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Info className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">Experiment Configuration</h2>
              <p className="text-sm text-text-muted">
                Set conditions, organism, and filtering options
              </p>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-1 gap-5">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Organism</label>
                <select
                  data-testid="organism-select"
                  value={config.organism}
                  onChange={(e) => setConfig({ organism: e.target.value })}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
                    focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                >
                  <option value="">Select organism...</option>
                  {availableOrganisms
                    .filter((o) => o.available)
                    .map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.display_name || org.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-5 mt-5">
              <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
                <div>
                  <span className="text-sm font-medium text-text-primary">Remove Razor Peptides</span>
                  <p className="text-xs text-text-muted mt-0.5">
                    Exclude peptides matching multiple protein groups
                  </p>
                </div>
                <input
                  data-testid="remove-razor-checkbox"
                  type="checkbox"
                  checked={config.remove_razor}
                  onChange={(e) => setConfig({ remove_razor: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                  after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                  after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                  peer-checked:after:translate-x-4 flex-shrink-0"
                />
              </label>
              <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
                <div>
                  <span className="text-sm font-medium text-text-primary">Strict Filtering</span>
                  <p className="text-xs text-text-muted mt-0.5">
                    20% missing value threshold, remove single-peptide proteins
                  </p>
                </div>
                <input
                  data-testid="strict-filtering-checkbox"
                  type="checkbox"
                  checked={config.strict_filtering}
                  onChange={(e) => setConfig({ strict_filtering: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                  after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                  after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                  peer-checked:after:translate-x-4 flex-shrink-0"
                />
              </label>
            </div>
          </div>
        </section>
      )}

      {/* Pipeline cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {pipelines.map((pipeline) => {
          const isSelected = selectedPipeline === pipeline.id;
          const Icon = pipeline.icon;

          return (
            <button
              key={pipeline.id}
              data-testid={`pipeline-card-${pipeline.id}`}
              onClick={() => setPipeline(pipeline.id)}
              className={cn(
                'relative text-left p-6 rounded-xl border-2 transition-all duration-200 bg-background',
                isSelected
                  ? 'border-primary shadow-[0_4px_14px_0_rgba(231,53,100,0.39)]'
                  : 'border-border hover:border-primary/30 hover:shadow-sm'
              )}
            >
              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white shadow-[0_4px_14px_0_rgba(231,53,100,0.39)]">
                  <Check className="w-4 h-4" />
                </div>
              )}

              {/* Icon with gradient */}
              <div
                className={cn(
                  'inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br mb-4',
                  pipeline.gradient
                )}
              >
                <Icon className="w-6 h-6 text-white" />
              </div>

              <h3 className="font-semibold text-text-primary mb-1">{pipeline.name}</h3>
              <p className="text-sm font-medium text-primary mb-3">{pipeline.title}</p>
              <p className="text-sm text-text-muted mb-4 leading-relaxed">
                {pipeline.description}
              </p>

              {/* Feature list */}
              <ul className="space-y-2">
                {pipeline.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-text-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          data-testid="pipeline-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Upload
        </button>

        <button
          data-testid="pipeline-continue-btn"
          onClick={handleContinue}
          disabled={!canContinue || isSaving}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            canContinue && !isSaving
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-border text-text-muted cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Comparisons
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <PipelineContent />
    </Suspense>
  );
}
