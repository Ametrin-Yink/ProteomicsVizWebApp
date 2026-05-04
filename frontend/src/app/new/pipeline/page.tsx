/**
 * Step 2: Pipeline Selection
 * Choose between msqrob2 and MSstats analysis pipelines
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Dna, BarChart3, Check } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';
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
  const { selectedPipeline, setPipeline, config } = state;
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = React.useState(false);

  // Redirect guard: no session or no uploaded files -> back to first step
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    } else if (state.uploadedFiles.length === 0 && state.selectedFiles.size === 0) {
      router.replace(`/new/upload?session=${sessionId}`);
    }
  }, [sessionId, state.uploadedFiles.length, state.selectedFiles.size, router]);

  const handleBack = () => {
    router.push(`/new/upload?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (!selectedPipeline || !sessionId) return;

    setIsSaving(true);
    try {
      // Save pipeline selection to backend config
      await sessionsApi.updateConfig(sessionId, {
        ...config,
        pipeline: selectedPipeline,
      });
      router.push(`/new/config?session=${sessionId}`);
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
        <h1 className="text-2xl font-bold text-text">Choose Analysis Pipeline</h1>
        <p className="text-text-muted mt-1">
          Select the statistical method for protein abundance and differential expression
        </p>
      </div>

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
                  ? 'border-primary shadow-[0_0_20px_rgba(231,53,100,0.15)]'
                  : 'border-border hover:border-primary/30 hover:shadow-sm'
              )}
            >
              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white">
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

              <h3 className="text-lg font-semibold text-text mb-1">{pipeline.name}</h3>
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
      <div className="flex items-center justify-between pt-4">
        <button
          data-testid="pipeline-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Upload
        </button>

        <button
          data-testid="pipeline-continue-btn"
          onClick={handleContinue}
          disabled={!selectedPipeline || isSaving}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            selectedPipeline && !isSaving
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
              Continue to Configuration
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
