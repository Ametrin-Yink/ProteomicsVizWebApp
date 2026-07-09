/**
 * Step 1: Analysis Type Selection
 * Choose between Protein (TMT/DIA) or PTM analysis
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Dna, BarChart3, FlaskConical, Check } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function TypeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const setAnalysisType = useAnalysisStore((s) => s.setAnalysisType);
  const config = useAnalysisStore((s) => s.config);
  const { addToast } = useUIStore();

  const [isProtein, setIsProtein] = React.useState<boolean | null>(null);
  const [dataType, setDataType] = React.useState<'tmt' | 'dia' | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  // Redirect guard: no session
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    }
  }, [sessionId, router]);

  const canContinue = isProtein === true ? dataType !== null : isProtein === false;

  const handleBack = () => {
    router.push('/');
  };

  const handleContinue = async () => {
    if (!sessionId || !canContinue) return;

    setIsSaving(true);
    try {
      const selectedType: 'tmt' | 'dia' | 'ptm' = isProtein
        ? (dataType as 'tmt' | 'dia')
        : 'ptm';

      setAnalysisType(selectedType);

      // Save file_type to backend session config
      await sessionsApi.updateConfig(sessionId, {
        ...config,
        file_type: selectedType === 'ptm' ? undefined : selectedType,
        pipeline: selectedType === 'tmt' ? 'msstats' : selectedType === 'dia' ? 'msqrob2' : 'ptm',
      });
      router.replace(`/new/upload?session=${sessionId}&type=${selectedType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save type selection';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step header */}
      <div className="text-center mb-8">
        <h1 className="font-bold text-text-primary">New Analysis</h1>
        <p className="text-text-muted mt-1">
          Select the type of proteomics analysis to perform
        </p>
      </div>

      {/* Analysis type toggle */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-text-primary">Analysis Type</h2>
        </div>
        <div className="p-5">
          <div className="flex justify-center">
            <div className="inline-flex gap-0.5 p-0.5 bg-surface rounded-lg">
              <button
                data-testid="type-btn-protein"
                onClick={() => { setIsProtein(true); setDataType(null); }}
                className={cn(
                  'px-5 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
                  isProtein === true
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Dna className="w-4 h-4" />
                Protein Analysis
              </button>
              <button
                data-testid="type-btn-ptm"
                onClick={() => { setIsProtein(false); setDataType(null); }}
                className={cn(
                  'px-5 py-2.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2',
                  isProtein === false
                    ? 'bg-background text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <FlaskConical className="w-4 h-4" />
                PTM Analysis
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Data type selection (Protein only) */}
      {isProtein === true && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-text-primary">Data Type</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* TMT */}
              <button
                data-testid="datatype-btn-tmt"
                onClick={() => setDataType('tmt')}
                className={cn(
                  'relative text-left p-5 rounded-xl border-2 transition-all duration-200 bg-background',
                  dataType === 'tmt'
                    ? 'border-primary shadow-sm'
                    : 'border-border hover:border-primary/30 hover:shadow-sm'
                )}
              >
                {dataType === 'tmt' && (
                  <div className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
                <BarChart3 className="w-6 h-6 text-primary mb-2" />
                <h3 className="font-semibold text-text-primary mb-1">TMT</h3>
                <p className="text-sm text-text-muted">
                  Tandem Mass Tag multiplexed quantification.
                  Uses MSstats for statistical modeling.
                </p>
                <p className="text-xs text-text-muted mt-2">
                  Supports TMTpro 16-plex, TMT 10-plex, etc.
                </p>
              </button>

              {/* DIA */}
              <button
                data-testid="datatype-btn-dia"
                onClick={() => setDataType('dia')}
                className={cn(
                  'relative text-left p-5 rounded-xl border-2 transition-all duration-200 bg-background',
                  dataType === 'dia'
                    ? 'border-primary shadow-sm'
                    : 'border-border hover:border-primary/30 hover:shadow-sm'
                )}
              >
                {dataType === 'dia' && (
                  <div className="absolute top-3 right-3 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                )}
                <Dna className="w-6 h-6 text-primary mb-2" />
                <h3 className="font-semibold text-text-primary mb-1">DIA</h3>
                <p className="text-sm text-text-muted">
                  Data-Independent Acquisition proteomics.
                  Uses msqrob2 for robust protein analysis with batch correction.
                </p>
                <p className="text-xs text-text-muted mt-2">
                  Requires 2 or more files for comparison.
                </p>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* PTM info */}
      {isProtein === false && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-text-primary">PTM Analysis</h2>
          </div>
          <div className="p-5">
            <div className="flex items-start gap-3 p-4 bg-surface rounded-lg">
              <FlaskConical className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-text font-medium">Post-Translational Modification Analysis</p>
                <p className="text-sm text-text-muted mt-1">
                  Upload PTM enrichment data, select modifications, and configure FASTA reference.
                  PTM analysis uses DIA-format data.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          data-testid="type-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <button
          data-testid="type-continue-btn"
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

export default function TypePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <TypeContent />
    </Suspense>
  );
}
