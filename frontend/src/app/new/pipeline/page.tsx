/**
 * Step 1: Pipeline Selection
 * Choose between msqrob2 and MSstats analysis pipelines
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Dna, BarChart3, Check } from 'lucide-react';
import { MassSpecIcon } from '@/components/ui/MassSpecIcon';
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
    summary: 'For large cohorts with moderate to high missing values',
    gradient: 'from-[#E73564] to-[#C42A52]',
  },
  {
    id: 'msstats' as const,
    name: 'MSstats',
    title: 'Statistical Modeling',
    icon: BarChart3,
    summary: 'For <50 samples with low missing values',
    gradient: 'from-[#00ADEF] to-[#0088CC]',
  },
];

function PipelineContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { selectedTemplate, setTemplate, selectedPipeline, setPipeline } = state;
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = React.useState(false);

  // Redirect guard: no session
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    }
  }, [sessionId, router]);

  const canContinue =
    selectedTemplate === 'protein' &&
    selectedPipeline !== null;

  const handleBack = () => {
    router.push('/');
  };

  const handleContinue = async () => {
    if (!sessionId) return;

    // Read latest state directly to avoid stale closure
    const latest = useAnalysisStore.getState();
    if (!latest.selectedPipeline) return;

    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, {
        ...latest.config,
        pipeline: latest.selectedPipeline,
      });
      router.replace(`/new/upload?session=${sessionId}`);
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

      {/* Template selection */}
      <div className="flex justify-center">
        <div className="inline-flex gap-0.5 p-0.5 bg-surface rounded-lg">
          <button
            data-testid="template-btn-protein"
            onClick={() => setTemplate('protein')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              selectedTemplate === 'protein'
                ? 'bg-background text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            Protein Analysis
          </button>
          <button
            data-testid="template-btn-ptm"
            onClick={() => setTemplate('ptm')}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              selectedTemplate === 'ptm'
                ? 'bg-background text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            PTM Analysis
            <span className="ml-1.5 text-[10px] text-text-muted">Soon</span>
          </button>
        </div>
      </div>

      {/* Pipeline cards */}
      {selectedTemplate === 'protein' ? (
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
                {isSelected && (
                  <div className="absolute top-3 right-3 flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white shadow-[0_4px_14px_0_rgba(231,53,100,0.39)]">
                    <Check className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={cn(
                    'inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br mb-4',
                    pipeline.gradient
                  )}
                >
                  <Icon className="w-6 h-6 text-white" />
                </div>

                <h3 className="font-semibold text-text-primary mb-1">{pipeline.name}</h3>
                <p className="text-sm font-medium text-primary mb-2">{pipeline.title}</p>
                <p className="text-sm text-text-muted">{pipeline.summary}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-background border border-border rounded-xl">
          <MassSpecIcon className="w-12 h-12 text-text-muted mb-4" />
          <h3 className="font-semibold text-text-primary mb-2">Post-translational Modification Analysis</h3>
          <p className="text-sm text-text-muted max-w-md">
            Pipeline details are currently being developed. Check back soon for PTM-specific analysis tools.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          data-testid="pipeline-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
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
              Continue to Upload
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
