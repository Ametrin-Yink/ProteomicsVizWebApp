/**
 * Step 2: File Upload & Experiment Setup
 * Upload PSM CSV files, review parsed metadata, configure experiment structure
 */

'use client';

import React, { useEffect, useState, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Upload, Database, CheckCircle, Dna, BarChart3, FolderOpen } from 'lucide-react';
import type { SessionConfig } from '@/types';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';
import PTMFileSetup from '@/components/analysis/PTMFileSetup';
import ExperimentTable from '@/components/analysis/ExperimentTable';
import ValidationPanel from '@/components/analysis/ValidationPanel';
import { useAnalysisStore, getValidation } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, mapBackendFiles } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useSessionValidation } from '@/hooks/use-session-validation';
import { useAutoSave } from '@/hooks/use-auto-save';
import { useBeforeUnload } from '@/hooks/use-beforeunload';

function UploadContentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const selectedFiles = useAnalysisStore((s) => s.selectedFiles);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const validation = useMemo(
    () => getValidation({ analysisType, uploadedFiles, selectedFiles, config }),
    [analysisType, uploadedFiles, selectedFiles, config]
  );
  const addToast = useUIStore((state) => state.addToast);
  const resetAnalysis = useAnalysisStore((s) => s.reset);

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [isProcessingSelection, setIsProcessingSelection] = useState(false);
  const [ptmLibraryReady, setPtmLibraryReady] = useState(false);

  // Reset analysis store when session changes — prevents stale file/config leakage
  useEffect(() => {
    resetAnalysis();
  }, [sessionId, resetAnalysis]);

  useSessionValidation(sessionId || null);

  // Restore session state on page load
  useEffect(() => {
    if (!sessionId) {
      setIsRestoring(false);
      return;
    }

    const restoreSession = async () => {
      try {
        const sessionResp = await fetch(`/api/sessions/${sessionId}`);
        if (sessionResp.status === 404) {
          addToast('error', 'Session not found. Please start a new analysis.');
          router.push('/');
          return;
        }
        if (sessionResp.ok) {
          const raw = await sessionResp.json();
          const rawConfig = raw.config as Partial<SessionConfig> | null;
          const fileTypeFromConfig = rawConfig?.file_type;
          if (raw.pipeline === 'ptm') {
            const store = useAnalysisStore.getState();
            if (!store.analysisType) store.setAnalysisType('ptm');
          } else if (fileTypeFromConfig === 'tmt' || fileTypeFromConfig === 'dia') {
            const store = useAnalysisStore.getState();
            if (!store.analysisType) {
              store.setAnalysisType(fileTypeFromConfig as 'tmt' | 'dia');
            }
          }

          const files = mapBackendFiles(raw.files);
          if (files.length > 0) {
            const { addUploadedFile } = useAnalysisStore.getState();
            for (const file of files) {
              addUploadedFile(file);
            }
          }

          if (rawConfig) setConfig(rawConfig);
        }
      } catch (err) {
        console.error('Session restore failed:', err);
        // Don't addToast here — useErrorStore may not be available. Set state instead.
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
  }, [sessionId, setConfig, router, addToast]);

  // Auto-save config to backend on changes (debounced) so edits survive refresh
  const { saveError } = useAutoSave(sessionId!, config, { enabled: !isRestoring });

  // Validate session ID and analysis type (deferred until session restore completes)
  useEffect(() => {
    if (isRestoring) return;
    if (!sessionId) {
      addToast('error', 'No session found. Please start a new analysis.');
      router.push('/');
    } else if (!analysisType) {
      router.replace('/');
    }
  }, [sessionId, analysisType, isRestoring, router, addToast]);

  const { dismiss: dismissBeforeUnload } = useBeforeUnload();

  const hasCriticalErrors = validation.warnings.filter((w) => w.type === 'error').length > 0;
  // TMT: just need files selected (metadata is per-channel on next page)
  // DIA: need files + no critical errors (ExperimentTable validation)
  const canContinue = analysisType === 'tmt'
    ? uploadedFiles.length > 0
    : uploadedFiles.length > 0 && !hasCriticalErrors;

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;

    dismissBeforeUnload();
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      router.replace(`/new/metadata?session=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save configuration';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePtmContinue = async () => {
    if (!ptmLibraryReady || !sessionId) return;
    dismissBeforeUnload();
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, {
        ...config,
        pipeline: 'ptm',
        file_type: 'tmt',
      });
      router.replace(`/new/metadata?session=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save PTM setup';
      addToast('error', `Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isRestoring) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-surface rounded animate-pulse w-1/2" />
        <div className="h-48 bg-surface rounded animate-pulse w-full" />
        <div className="h-6 bg-surface rounded animate-pulse w-3/4" />
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (analysisType === 'ptm') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="font-bold text-text-primary">PTM TMT Data Setup</h1>
          <p className="mt-1 text-text-muted">Select Proteome Discoverer TXT inputs from the File Library.</p>
        </div>
        <PTMFileSetup sessionId={sessionId} onReadyChange={setPtmLibraryReady} />
        <div className="flex items-center justify-between border-t border-border pt-4">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </button>
          <button
            type="button"
            onClick={handlePtmContinue}
            disabled={!ptmLibraryReady || isSaving}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-5 py-2 font-medium transition-colors',
              ptmLibraryReady && !isSaving
                ? 'bg-primary text-white hover:bg-primary-dark'
                : 'cursor-not-allowed bg-surface text-text-muted',
            )}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Continue to Metadata
          </button>
        </div>
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

      {/* Pipeline badge */}
      {analysisType && (
        <div className="flex items-center gap-2">
          {analysisType === 'tmt' ? (
            <BarChart3 className="w-4 h-4 text-primary" />
          ) : (
            <Dna className="w-4 h-4 text-primary" />
          )}
          <span className="text-sm font-medium text-primary">
            {analysisType === 'tmt' ? 'MSstats' : 'msqrob2'} Pipeline
          </span>
        </div>
      )}

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
              <button
                data-testid="browse-library-btn"
                onClick={() => setShowPicker(true)}
                className="inline-flex items-center gap-2 px-6 py-4 border-2 border-dashed border-primary/40 rounded-xl bg-primary/5 hover:bg-primary/10 transition-colors"
              >
                <FolderOpen className="w-6 h-6 text-primary" />
                <div className="text-left">
                  <p className="text-base font-medium text-text">Browse File Library</p>
                  <p className="text-sm text-text-muted">Select .txt or .csv PSM files</p>
                </div>
              </button>

              {uploadedFiles.length > 0 && (
                <p className="mt-3 text-sm text-text-muted">
                  {uploadedFiles.length} files selected · {(uploadedFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)} MB total
                </p>
              )}

              {showPicker && (
                <FileLibraryPicker
                  sessionId={sessionId}
                  fileType={analysisType as 'tmt' | 'dia'}
                  onSelect={async (_paths) => {
                    setShowPicker(false);
                    setIsProcessingSelection(true);
                    // paths were already copied to session by the picker
                    // Reload session files to get parsed metadata
                    try {
                      const resp = await fetch(`/api/sessions/${sessionId}`);
                      if (resp.ok) {
                        const raw = await resp.json();
                        const files = mapBackendFiles(raw.files);
                        const { addUploadedFile } = useAnalysisStore.getState();
                        for (const file of files) {
                          addUploadedFile(file);
                        }
                      }
                    } finally {
                      setIsProcessingSelection(false);
                    }
                  }}
                  onClose={() => setShowPicker(false)}
                />
              )}
              {isProcessingSelection && (
                <div className="flex items-center gap-2 text-sm text-text-muted mt-3">
                  <Loader2 className="w-4 h-4 animate-spin" /> Processing files...
                </div>
              )}
            </div>
          </section>

          {/* DIA: per-file experiment structure + validation */}
        {analysisType === 'dia' && uploadedFiles.length > 0 && (
          <>
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
          </>
        )}

        {/* TMT: summary after file selection (metadata is per-channel on next page) */}
        {analysisType === 'tmt' && uploadedFiles.length > 0 && (
          <section className="bg-background border border-border rounded-lg">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-text-primary">File Selected</h2>
                <p className="text-sm text-text-muted">
                  TMT channels will be configured on the next page
                </p>
              </div>
            </div>
            <div className="p-5">
              {uploadedFiles.map(f => (
                <div key={f.filename} className="flex items-center gap-3 p-2 text-sm">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  <span className="text-text font-medium">{f.filename}</span>
                  <span className="text-text-muted">
                    {(f.size / (1024 * 1024)).toFixed(1)} MB
                    {f.tmt_channels && ` · ${f.tmt_channels.length} channels detected`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          data-testid="upload-back-btn"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-secondary
            hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>

        <button
          data-testid="upload-continue-btn"
          onClick={handleContinue}
          disabled={!canContinue || isSaving}
          className={cn(
            'inline-flex items-center gap-2 px-5 py-2 rounded-lg font-medium transition-all duration-200',
            canContinue && !isSaving
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-surface text-text-muted cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Metadata
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
      {saveError && (
        <p className="text-xs text-error mt-1" role="alert">{saveError}</p>
      )}
    </div>
  );
}

function UploadContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';
  return <UploadContentInner key={sessionId || 'no-session'} />;
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
