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
import { useAnalysisStore, canStartAnalysis, getPipelineFromType } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { organismsApi, sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useBeforeUnload } from '@/hooks/use-beforeunload';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
import MsstatsConfigForm from '@/components/analysis/MsstatsConfigForm';
import Msqrob2ConfigForm from '@/components/analysis/Msqrob2ConfigForm';

function ConfigContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const setAvailableOrganisms = useAnalysisStore((s) => s.setAvailableOrganisms);
  const availableOrganisms = useAnalysisStore((s) => s.availableOrganisms);
  const selectedFilesSize = useAnalysisStore((s) => s.selectedFiles.size);
  const canStart = useAnalysisStore(canStartAnalysis);
  const selectedPipeline = getPipelineFromType(analysisType);
  const addToast = useUIStore((state) => state.addToast);

  const [isStarting, setIsStarting] = React.useState(false);
  const [isLoadingOrganisms, setIsLoadingOrganisms] = React.useState(true);
  const [organismError, setOrganismError] = React.useState<string | null>(null);

  const { dismiss: dismissBeforeUnload } = useBeforeUnload();

  // Redirect guard: no session or no analysis type -> back to earlier step
  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    } else if (!analysisType) {
      router.replace('/');
    }
  }, [sessionId, analysisType, router]);

  // Load organisms on mount
  const loadOrganisms = React.useCallback(async () => {
    if (!sessionId) return;
    setIsLoadingOrganisms(true);
    setOrganismError(null);
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
      setOrganismError('Failed to load organisms');
      addToast('error', `Failed to load organisms: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoadingOrganisms(false);
    }
  }, [sessionId, setAvailableOrganisms, addToast]);

  React.useEffect(() => {
    loadOrganisms();
  }, [loadOrganisms]);

  const canContinue = canStart && (analysisType === 'ptm' || config.organism !== '');

  const handleBack = () => {
    router.push(`/new/comparisons?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;
    dismissBeforeUnload();
    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsStarting(false);
      return;
    }

    setIsStarting(false);
    router.replace(`/new/summary?session=${sessionId}`);
  };

  const pipelineLabel = selectedPipeline === 'ptm'
    ? 'PTM TMT'
    : selectedPipeline === 'msstats'
      ? 'MSstats'
      : 'msqrob2';
  const PipelineIcon = selectedPipeline === 'msqrob2' ? Dna : BarChart3;

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
          {analysisType !== 'ptm' ? (
          <div className="mb-5">
            <label className="block text-sm font-medium text-text-primary mb-1.5">Organism</label>
            <div className="flex items-center gap-2">
              <select
                data-testid="organism-select"
                value={config.organism}
                onChange={(e) => setConfig({ organism: e.target.value })}
                disabled={isLoadingOrganisms || !!organismError}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {isLoadingOrganisms ? 'Loading...' : organismError ? 'Failed to load' : 'Select organism...'}
                </option>
                {!isLoadingOrganisms && !organismError && availableOrganisms
                  .filter((o) => o.available)
                  .map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.display_name || org.name}
                    </option>
                  ))}
              </select>
              {organismError && (
                <button
                  onClick={loadOrganisms}
                  className="flex items-center gap-1 px-3 py-2 text-sm font-medium bg-surface border border-border rounded-lg hover:bg-border/20 text-text-primary transition-colors"
                  title="Retry loading organisms"
                >
                  <Loader2 className="w-4 h-4" /> Retry
                </button>
              )}
            </div>
          </div>
          ) : (
            <div className="mb-5 rounded-lg border border-border bg-surface p-3">
              <p className="text-sm font-medium text-text-primary">FASTA reference</p>
              <p className="mt-0.5 text-xs capitalize text-text-muted">{config.ptm_fasta_source}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-5">
            <label className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border cursor-pointer hover:border-primary/30 transition-colors">
              <div>
                <span className="text-sm font-medium text-text-primary">
                  Resolve Shared Peptides
                  <HelpTooltip text="Assign each peptide-spectrum match with multiple candidate proteins to the candidate supported by the most distinct PSMs. Ties use the original accession order. When disabled, the original protein group is preserved." />
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  Assign shared PSMs to the best-supported protein
                </p>
              </div>
              <input
                data-testid="resolve-shared-peptides-checkbox"
                type="checkbox"
                checked={config.resolve_shared_peptides}
                onChange={(e) => setConfig({ resolve_shared_peptides: e.target.checked })}
                className="sr-only peer"
              />
              <div className="relative w-10 h-5 bg-border rounded-full peer-checked:bg-primary transition-colors
                after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white
                after:w-4 after:h-4 after:rounded-full after:transition-transform after:duration-200
                peer-checked:after:translate-x-4 flex-shrink-0"
              />
            </label>
            <div className="p-3 bg-surface rounded-lg border border-border">
              <div>
                <span className="text-sm font-medium text-text-primary">
                  Maximum Missing Values per Condition
                  <HelpTooltip text="A PSM must meet this missing-replicate limit in every condition. The percentage is applied to the expected replicate count from the experimental design; lower values are more stringent." />
                </span>
                <p className="text-xs text-text-muted mt-0.5">
                  Allowed missing replicate percentage in every condition
                </p>
              </div>
              <input
                data-testid="missing-value-threshold-input"
                type="number"
                min={0}
                max={100}
                step={1}
                value={Math.round(config.max_missing_fraction_per_condition * 100)}
                onChange={(e) => {
                  const percent = Number(e.target.value);
                  if (Number.isFinite(percent)) {
                    setConfig({ max_missing_fraction_per_condition: Math.min(100, Math.max(0, percent)) / 100 });
                  }
                }}
                className="mt-3 w-24 px-3 py-2 bg-background border border-border rounded-lg text-text-primary text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <span className="ml-2 text-sm text-text-muted">%</span>
            </div>
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
              <HelpTooltip text="The significance level used to determine differentially expressed proteins. Proteins with an adjusted p-value below this threshold are considered statistically significant. Lower values (e.g., 0.01) are more stringent; higher values (e.g., 0.1) are more permissive. The default of 0.05 is standard in most proteomics studies." />
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
              <HelpTooltip text="The minimum absolute log2 fold change for a protein to be considered biologically significant. A threshold of 1.0 corresponds to a 2-fold change. Statistical significance (p-value) and biological significance (fold change) are independent filters — both must be met. Increase this value to focus on proteins with larger magnitude changes." />
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

          {/* Minimum PSMs per protein */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Minimum PSMs per Protein
              <HelpTooltip text="After missing-value filtering and shared-peptide resolution, retain only proteins supported by at least this many distinct Unique_PSM identifiers. Reporter channels and replicate rows are not counted more than once." />
            </label>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              data-testid="min-psms-per-protein-input"
              value={config.min_psms_per_protein}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value)) {
                  setConfig({ min_psms_per_protein: Math.min(10, Math.max(1, Math.round(value))) });
                }
              }}
              className="w-24 px-3 py-2 bg-surface border border-border rounded-lg text-text-primary text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="text-xs text-text-muted mt-1">
              Counts distinct surviving PSMs after the per-condition missing-value filter
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

      {selectedPipeline === 'ptm' && (
        <section className="rounded-lg border border-border bg-background">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <BarChart3 className="h-5 w-5 text-secondary" />
            <div>
              <h2 className="font-semibold text-text-primary">PTM Processing</h2>
              <p className="text-sm text-text-muted">Normalization and missing-value handling</p>
            </div>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="rounded-lg border border-border bg-surface p-3">
              <span className="block text-sm font-medium text-text-primary">Normalization method</span>
              <span className="mb-2 block text-xs text-text-muted">Choose the reporter-channel reference distribution</span>
              <select
                data-testid="ptm-normalization-select"
                value={config.ptm_normalization_method ?? 'background_peptide'}
                onChange={(event) => setConfig({
                  ptm_normalization_method: event.target.value as 'background_peptide' | 'centered_median' | 'none',
                  ptm_background_normalization: event.target.value === 'background_peptide',
                })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="centered_median">Centered median</option>
                <option value="background_peptide">Background peptides</option>
                <option value="none">None (raw PTM)</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-surface p-3">
              <span>
                <span className="block text-sm font-medium text-text-primary">Model-based imputation</span>
                <span className="block text-xs text-text-muted">Impute only after the per-condition coverage filter</span>
              </span>
              <input
                type="checkbox"
                checked={config.ptm_imputation ?? true}
                onChange={(event) => setConfig({ ptm_imputation: event.target.checked })}
                className="h-4 w-4"
              />
            </label>
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
            'inline-flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all duration-200',
            canContinue && !isStarting
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-surface text-text-muted cursor-not-allowed'
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
