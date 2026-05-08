/**
 * Step 1: File Upload & Experiment Setup
 * Upload PSM CSV files, review parsed metadata, configure experiment structure
 */

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Loader2, Upload, Database, CheckCircle } from 'lucide-react';
import FileUploadZone from '@/components/analysis/FileUploadZone';
import ExperimentTable from '@/components/analysis/ExperimentTable';
import ValidationPanel from '@/components/analysis/ValidationPanel';
import { useAnalysisStore, getValidation } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, mapBackendFiles } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig } = state;
  const validation = getValidation(state);
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = useState(false);

  // Restore session state on page load
  useEffect(() => {
    if (!sessionId) return;

    const restoreSession = async () => {
      try {
        const sessionResp = await fetch(`/api/sessions/${sessionId}`);
        if (sessionResp.ok) {
          const raw = await sessionResp.json();
          const files = mapBackendFiles(raw.files);
          if (files.length > 0) {
            const { addUploadedFile } = useAnalysisStore.getState();
            for (const file of files) {
              addUploadedFile(file);
            }
          }

          // Restore config from raw backend response
          const cfg = raw.config as Record<string, unknown> | null;
          if (cfg && typeof cfg === 'object') {
            const updates: Partial<typeof config> = {};
            if (typeof cfg.treatment === 'string') updates.treatment = cfg.treatment;
            if (typeof cfg.control === 'string') updates.control = cfg.control;
            if (typeof cfg.organism === 'string') updates.organism = cfg.organism;
            if (typeof cfg.remove_razor === 'boolean') updates.remove_razor = cfg.remove_razor;
            if (typeof cfg.strict_filtering === 'boolean') updates.strict_filtering = cfg.strict_filtering;
            if (cfg.pipeline === 'msqrob2' || cfg.pipeline === 'msstats') updates.pipeline = cfg.pipeline;
            if (typeof cfg.condition_column === 'string') updates.condition_column = cfg.condition_column;
            if (cfg.metadata_columns && typeof cfg.metadata_columns === 'object') {
              updates.metadata_columns = cfg.metadata_columns as Record<string, Record<string, string>>;
            }
            if (Array.isArray(cfg.comparisons)) updates.comparisons = cfg.comparisons as typeof config.comparisons;
            if (Array.isArray(cfg.covariate_columns)) updates.covariate_columns = cfg.covariate_columns as string[];
            if (Object.keys(updates).length > 0) {
              setConfig(updates);
            }
          }
        }
      } catch {
        // Session restoration failed, user can start fresh
      }
    };

    restoreSession();
  }, [sessionId, setConfig]);

  // Validate session ID
  useEffect(() => {
    if (!sessionId) {
      addToast('error', 'No session found. Please start a new analysis.');
      router.push('/');
    }
  }, [sessionId, router, addToast]);

  const hasCriticalErrors = validation.warnings.filter((w) => w.type === 'error').length > 0;
  const canContinue = validation.selectedFiles.length > 0 && !hasCriticalErrors;

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;

    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      router.push(`/new/pipeline?session=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save configuration';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-2">
        <h1 className="font-bold text-text-primary">Upload & Experiment Setup</h1>
        <p className="text-text-muted mt-1">
          Upload your PSM CSV files. Files are parsed to extract experiment, condition, and replicate.
        </p>
      </div>

      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Upload className="w-5 h-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Data Input</h2>
            <p className="text-sm text-text-muted">
              Format: PSM_ExperimentName_Condition_Replicate.csv
            </p>
          </div>
        </div>
        <div className="p-5">
          <FileUploadZone sessionId={sessionId} />
        </div>
      </section>

      {state.uploadedFiles.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">Experiment Structure</h2>
              <p className="text-sm text-text-muted">
                Review parsed files and select which to include
              </p>
            </div>
          </div>
          <div className="p-5">
            <ExperimentTable />
          </div>
        </section>
      )}

      {state.uploadedFiles.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">Validation</h2>
              <p className="text-sm text-text-muted">Check experiment setup requirements</p>
            </div>
          </div>
          <div className="p-5">
            <ValidationPanel />
          </div>
        </section>
      )}

      <div className="flex justify-end pt-4 border-t border-border">
        <button
          data-testid="upload-continue-btn"
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
              Continue to Pipeline Selection
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <UploadContent />
    </Suspense>
  );
}
