/**
 * Step 3: Pipeline-Specific Configuration
 * Configure advanced parameters based on selected pipeline, then start analysis
 */

'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sliders,
  Dna,
  BarChart3,
  AlertCircle,
  Info,
} from 'lucide-react';
import { useAnalysisStore, canStartAnalysis } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { organismsApi, sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import MsstatsConfigForm from '@/components/analysis/MsstatsConfigForm';
import Msqrob2ConfigForm from '@/components/analysis/Msqrob2ConfigForm';

function ConfigContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const selectedPipeline = useAnalysisStore((s) => s.selectedPipeline);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const setAvailableOrganisms = useAnalysisStore((s) => s.setAvailableOrganisms);
  const availableOrganisms = useAnalysisStore((s) => s.availableOrganisms);
  const selectedFilesSize = useAnalysisStore((s) => s.selectedFiles.size);
  const canStart = useAnalysisStore(canStartAnalysis);
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

  const canContinue = canStart && config.organism !== '';

  const handleBack = () => {
    router.push(`/new/comparisons?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;
    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsStarting(false);
      return;
    }

    setIsStarting(false);
    router.push(`/new/summary?session=${sessionId}`);
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
        <h1 className="font-bold text-text-primary">Configuration</h1>
        <p className="text-text-muted mt-1">
          Set {pipelineLabel}-specific parameters before starting the analysis
        </p>
      </div>

      {/* Experiment Configuration */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Info className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Experiment Configuration</h2>
            <p className="text-sm text-text-muted">Organism and filtering options</p>
          </div>
        </div>
        <div className="p-5">
          <div className="mb-5">
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

          <div className="grid grid-cols-2 gap-5">
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

      {/* Shared Advanced Parameters */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Sliders className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Advanced Parameters</h2>
            <p className="text-sm text-text-muted">
              Statistical thresholds applied during differential expression analysis
            </p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          {/* P-value threshold */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
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
              <span className="w-16 text-sm font-mono text-text-primary font-medium tabular-nums">
                {config.pvalue_threshold ?? 0.05}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Proteins with adjusted p-value below this threshold are considered significant
            </p>
          </div>

          {/* Log2 FC threshold */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
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
              <span className="w-16 text-sm font-mono text-text-primary font-medium tabular-nums">
                {config.logfc_threshold ?? 1.0}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Minimum absolute log2 fold change for biological significance
            </p>
          </div>

          {/* Exclude single-peptide proteins */}
          <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
            <div>
              <span className="text-sm font-medium text-text-primary">Exclude Single-Peptide Proteins</span>
              <p className="text-xs text-text-muted mt-0.5">
                Remove proteins with only one identified peptide from the analysis
              </p>
            </div>
            <input
              type="checkbox"
              data-testid="exclude-single-peptide-checkbox"
              checked={(config.min_peptides_per_protein ?? 1) > 1}
              onChange={(e) => setConfig({ min_peptides_per_protein: e.target.checked ? 2 : 1 })}
              className="sr-only peer"
            />
            <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
              after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
              peer-checked:after:translate-x-5"
            />
          </label>
        </div>
      </section>

      {/* MSstats-specific parameters */}
      {selectedPipeline === 'msstats' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-secondary" />
            <div>
              <h2 className="font-semibold text-text-primary">MSstats Parameters</h2>
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


      {/* msqrob2-specific parameters */}
      {selectedPipeline === 'msqrob2' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Dna className="w-5 h-5 text-secondary" />
            <div>
              <h2 className="font-semibold text-text-primary">msqrob2 Parameters</h2>
              <p className="text-sm text-text-muted">
                Configure msqrob2/QFeatures preprocessing and statistical modeling options
              </p>
            </div>
          </div>
          <div className="p-5">
            <Msqrob2ConfigForm config={config} setConfig={setConfig} metadataColumns={config.metadata_columns} />
          </div>
        </section>
      )}

      {/* Validation warning */}
      {!canContinue && selectedFilesSize > 0 && (
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
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          data-testid="config-back-btn"
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Comparisons
        </button>

        <button
          data-testid="config-continue-btn"
          onClick={handleContinue}
          disabled={!canContinue || isStarting}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            canContinue && !isStarting
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-border text-text-muted cursor-not-allowed'
          )}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Summary
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SearchParamsReader({ children }: { children: (sessionId: string) => React.ReactNode }) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';
  return <>{children(sessionId)}</>;
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
      <SearchParamsReader>
        {(sessionId) => <ConfigContent sessionId={sessionId} />}
      </SearchParamsReader>
    </Suspense>
  );
}
