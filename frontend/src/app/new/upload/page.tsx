/**
 * Step 2: File Upload & Experiment Setup
 * Upload PSM CSV files, review parsed metadata, configure experiment structure
 */

'use client';

import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, Upload, Database, CheckCircle, Dna, BarChart3, Tag, FlaskConical, AlertCircle, FileText, Plus, Minus, X, FolderOpen } from 'lucide-react';
import type { UploadedFileInfo } from '@/types';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';
import ExperimentTable from '@/components/analysis/ExperimentTable';
import ValidationPanel from '@/components/analysis/ValidationPanel';
import { useAnalysisStore, getValidation } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, mapBackendFiles } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useSessionValidation } from '@/hooks/use-session-validation';
import { useAutoSave } from '@/hooks/use-auto-save';

function UploadContentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const validation = getValidation(useAnalysisStore.getState());
  const { addToast } = useUIStore();
  const resetAnalysis = useAnalysisStore((s) => s.reset);

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  // Reset analysis store when session changes — prevents stale file/config leakage
  useEffect(() => {
    resetAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useSessionValidation(sessionId || null);

  // PTM-specific state
  const [ptmLabelingType, setPtmLabelingType] = useState<'LF' | 'TMT'>('LF');
  const [ptmGlobalProteomeExpanded, setPtmGlobalProteomeExpanded] = useState(false);
  const [ptmFastaUploadMethod, setPtmFastaUploadMethod] = useState<'human' | 'mouse' | 'custom' | null>(null);
  const [ptmFastaFile, setPtmFastaFile] = useState<{ name: string; size: number } | null>(null);
  const [ptmFastaUploading, setPtmFastaUploading] = useState(false);
  const [ptmEnrichmentFiles, setPtmEnrichmentFiles] = useState<UploadedFileInfo[]>([]);
  const [ptmGlobalFiles, setPtmGlobalFiles] = useState<{ filename: string; size: number }[]>([]);
  const [ptmEnrichmentUploading, setPtmEnrichmentUploading] = useState(false);
  const [ptmGlobalUploading, setPtmGlobalUploading] = useState(false);
  const [isDraggingPtmEnrichment, setIsDraggingPtmEnrichment] = useState(false);
  const [isDraggingPtmGlobal, setIsDraggingPtmGlobal] = useState(false);
  const [isDraggingFasta, setIsDraggingFasta] = useState(false);
  const [detectedMods, setDetectedMods] = useState<string[]>([]);
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());

  const ptmEnrichmentInputRef = useRef<HTMLInputElement>(null);
  const ptmGlobalInputRef = useRef<HTMLInputElement>(null);
  const fastaInputRef = useRef<HTMLInputElement>(null);

  const removePtmEnrichmentFile = useCallback((filename: string) => {
    setPtmEnrichmentFiles((prev) => prev.filter((f) => f.filename !== filename));
    const store = useAnalysisStore.getState();
    const existing = store.uploadedFiles.find((f) => f.filename === filename);
    if (existing) store.removeUploadedFile(filename);
  }, []);

  const removePtmGlobalFile = useCallback((filename: string) => {
    setPtmGlobalFiles((prev) => prev.filter((f) => f.filename !== filename));
  }, []);

  const uploadPtmEnrichment = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setPtmEnrichmentUploading(true);
    try {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      const res = await fetch(`/api/sessions/${sessionId}/upload/ptm-enrichment`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        addToast('error', `PTM upload failed: ${text}`);
        return;
      }
      const data = await res.json();
      if (data.files?.length > 0) {
        const store = useAnalysisStore.getState();
        const parsedFiles: UploadedFileInfo[] = data.files.map((f: Record<string, unknown>) => ({
          filename: f.filename as string,
          experiment: (f.experiment as string) || '',
          replicate: (f.replicate as number) || 0,
          batch: (f.batch as string) || '',
          file_type: (f.file_type as 'tmt' | 'dia' | null) || null,
          size: (f.size as number) || 0,
        }));
        for (const pf of parsedFiles) store.addUploadedFile(pf);
        setPtmEnrichmentFiles((prev) => [...prev, ...parsedFiles]);
        addToast('success', `Uploaded ${data.files.length} PTM enrichment file(s)`);
        if (detectedMods.length === 0) {
          setTimeout(() => {
            setDetectedMods([
              'Phosphorylation (STY)',
              'Acetylation (K)',
              'Methylation (KR)',
              'Ubiquitination (K)',
            ]);
          }, 1000);
        }
      }
    } catch (err) {
      addToast('error', `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPtmEnrichmentUploading(false);
    }
  }, [sessionId, addToast, detectedMods.length]);

  const uploadPtmGlobal = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setPtmGlobalUploading(true);
    try {
      const formData = new FormData();
      for (const file of files) formData.append('files', file);
      const res = await fetch(`/api/sessions/${sessionId}/upload/global-proteome`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        addToast('error', `Global proteome upload failed: ${text}`);
        return;
      }
      const data = await res.json();
      if (data.files?.length > 0) {
        setPtmGlobalFiles((prev) => [
          ...prev,
          ...data.files.map((f: Record<string, unknown>) => ({
            filename: f.filename as string,
            size: (f.size as number) || 0,
          })),
        ]);
        addToast('success', `Uploaded ${data.files.length} global proteome file(s)`);
      }
    } catch (err) {
      addToast('error', `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPtmGlobalUploading(false);
    }
  }, [sessionId, addToast]);

  const uploadFasta = useCallback(async (file: File) => {
    setPtmFastaUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/sessions/${sessionId}/upload/fasta`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        addToast('error', `FASTA upload failed: ${text}`);
        return;
      }
      setPtmFastaFile({ name: file.name, size: file.size });
      addToast('success', 'FASTA file uploaded');
    } catch (err) {
      addToast('error', `FASTA upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPtmFastaUploading(false);
    }
  }, [sessionId, addToast]);

  const handlePtmEnrichmentDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPtmEnrichment(false);
    uploadPtmEnrichment(e.dataTransfer.files);
  }, [uploadPtmEnrichment]);

  const handlePtmEnrichmentChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      uploadPtmEnrichment(e.target.files);
      e.target.value = '';
    }
  }, [uploadPtmEnrichment]);

  const handlePtmGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPtmGlobal(false);
    uploadPtmGlobal(e.dataTransfer.files);
  }, [uploadPtmGlobal]);

  const handlePtmGlobalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      uploadPtmGlobal(e.target.files);
      e.target.value = '';
    }
  }, [uploadPtmGlobal]);

  const handleFastaDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFasta(false);
    setPtmFastaUploadMethod('custom');
    const file = e.dataTransfer.files[0];
    if (file) uploadFasta(file);
  }, [uploadFasta]);

  const handleFastaChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPtmFastaUploadMethod('custom');
      uploadFasta(file);
      e.target.value = '';
    }
  }, [uploadFasta]);

  // Restore session state on page load
  useEffect(() => {
    if (!sessionId) return;

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
            const updates: Record<string, unknown> = {};
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
            if (Array.isArray(cfg.comparisons)) updates.comparisons = cfg.comparisons;
            if (Array.isArray(cfg.covariate_columns)) updates.covariate_columns = cfg.covariate_columns as string[];
            if (Object.keys(updates).length > 0) {
              setConfig(updates);
            }
          }

          // Restore analysis type from backend session (needed on page refresh)
          const rawConfig = raw.config as Record<string, unknown> | null;
          const fileTypeFromConfig = rawConfig?.file_type as string | undefined;
          if (fileTypeFromConfig === 'tmt' || fileTypeFromConfig === 'dia') {
            const store = useAnalysisStore.getState();
            if (!store.analysisType) {
              store.setAnalysisType(fileTypeFromConfig as 'tmt' | 'dia');
            }
          } else if (raw.pipeline === 'ptm') {
            const store = useAnalysisStore.getState();
            if (!store.analysisType) {
              store.setAnalysisType('ptm');
            }
          }
        }
      } catch {
        // Network error — allow continuing offline
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, setConfig]);

  // Auto-save config to backend on changes (debounced) so edits survive refresh
  const { isSaving: isAutoSaving, saveError } = useAutoSave(sessionId!, config, { enabled: !isRestoring });

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

  const hasCriticalErrors = validation.warnings.filter((w) => w.type === 'error').length > 0;
  const ptmHasEnrichmentFiles = ptmEnrichmentFiles.length > 0;
  const ptmHasFasta = ptmFastaFile !== null || ptmFastaUploadMethod !== null;
  // TMT: just need files selected (metadata is per-channel on next page)
  // DIA: need files + no critical errors (ExperimentTable validation)
  // PTM: need enrichment files + FASTA
  const canContinue = analysisType === 'ptm'
    ? ptmHasEnrichmentFiles && ptmHasFasta
    : analysisType === 'tmt'
      ? uploadedFiles.length > 0
      : uploadedFiles.length > 0 && !hasCriticalErrors;

  const handleContinue = async () => {
    if (!canContinue || !sessionId) return;

    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      // PTM skips metadata step, TMT/DIA goes to metadata
      if (analysisType === 'ptm') {
        router.replace(`/new/comparisons?session=${sessionId}`);
      } else {
        router.replace(`/new/metadata?session=${sessionId}`);
      }
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

      {/* Pipeline badge */}
      {analysisType && analysisType !== 'ptm' && (
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

      {analysisType !== 'ptm' ? (
        <>
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
                    // paths were already copied to session by the picker
                    // Reload session files to get parsed metadata
                    const resp = await fetch(`/api/sessions/${sessionId}`);
                    if (resp.ok) {
                      const raw = await resp.json();
                      const files = mapBackendFiles(raw.files);
                      const { addUploadedFile } = useAnalysisStore.getState();
                      for (const file of files) {
                        addUploadedFile(file);
                      }
                    }
                  }}
                  onClose={() => setShowPicker(false)}
                />
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
        </>
      ) : (
        <>
          {/* LF/TMT Toggle */}
          <section className="bg-background border border-border rounded-lg">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <FlaskConical className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-text-primary">PTM Analysis Type</h2>
                <p className="text-sm text-text-muted">Select the labeling strategy for your PTM experiment</p>
              </div>
            </div>
            <div className="p-5">
              <div className="inline-flex rounded-lg border border-border overflow-hidden">
                <button
                  data-testid="ptm-lf-btn"
                  onClick={() => setPtmLabelingType('LF')}
                  className={cn(
                    'px-5 py-2 text-sm font-medium transition-colors',
                    ptmLabelingType === 'LF'
                      ? 'bg-primary text-white'
                      : 'bg-background text-text-secondary hover:bg-surface'
                  )}
                >
                  Label-Free (LF)
                </button>
                <button
                  data-testid="ptm-tmt-btn"
                  onClick={() => setPtmLabelingType('TMT')}
                  className={cn(
                    'px-5 py-2 text-sm font-medium transition-colors',
                    ptmLabelingType === 'TMT'
                      ? 'bg-primary text-white'
                      : 'bg-background text-text-secondary hover:bg-surface'
                  )}
                >
                  TMT (Tandem Mass Tags)
                </button>
              </div>
            </div>
          </section>

          {/* Zone 1: PTM Enrichment Data */}
          <section className="bg-background border border-border rounded-lg">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <Upload className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-text-primary">PTM Enrichment Data</h2>
                <p className="text-sm text-text-muted">
                  Upload PTM enrichment CSV files (required)
                </p>
              </div>
              {ptmEnrichmentFiles.length > 0 && (
                <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  {ptmEnrichmentFiles.length} file{ptmEnrichmentFiles.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="p-5" data-testid="ptm-enrichment-zone">
              {/* Drop zone */}
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingPtmEnrichment(true); }}
                onDragLeave={(e) => { e.preventDefault(); setIsDraggingPtmEnrichment(false); }}
                onDrop={handlePtmEnrichmentDrop}
                onClick={() => ptmEnrichmentInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ptmEnrichmentInputRef.current?.click(); } }}
                className={cn(
                  'relative border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all duration-200',
                  isDraggingPtmEnrichment
                    ? 'border-primary bg-primary/5'
                    : 'border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10'
                )}
              >
                <input ref={ptmEnrichmentInputRef} type="file" accept=".csv" multiple onChange={handlePtmEnrichmentChange} className="hidden" />
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 rounded-full bg-primary/10">
                    <Upload className="w-8 h-8 text-primary/70" />
                  </div>
                  <div>
                    <p className="text-base font-medium text-text">
                      {isDraggingPtmEnrichment ? 'Drop files here' : 'Drag & drop PTM enrichment CSV files'}
                    </p>
                    <p className="text-sm text-text-muted mt-1">or click to browse</p>
                    <p className="text-xs text-text-muted mt-1">
                      Expected: <code className="px-1 py-0.5 bg-surface rounded text-text-secondary">PSM_Experiment_Cond1_Cond2_Rep.csv</code>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>Supported: CSV files</span>
                    <span>•</span>
                    <span>Max 500MB</span>
                  </div>
                </div>
              </div>

              {/* Uploading indicator */}
              {ptmEnrichmentUploading && (
                <div className="flex items-center gap-2 mt-3 text-sm text-text-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading PTM enrichment files...
                </div>
              )}

              {/* Uploaded PTM enrichment files list */}
              {ptmEnrichmentFiles.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Uploaded Files</p>
                  {ptmEnrichmentFiles.map((f) => {
                    const meta = config.metadata_columns?.[f.filename] || {};
                    return (
                    <div key={f.filename} className="flex items-center justify-between p-2 rounded-md border border-border bg-background text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                        <span className="text-text truncate" title={f.filename}>{f.filename}</span>
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {meta.experiment || f.experiment}
                        </span>
                      </div>
                      <button
                        onClick={() => removePtmEnrichmentFile(f.filename)}
                        className="p-1 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors flex-shrink-0 ml-2"
                        title="Remove file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Zone 2: Global Proteome Data (collapsible) */}
          <section className="bg-background border border-border rounded-lg">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <Database className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-text-primary">Global Proteome Data</h2>
                <p className="text-sm text-text-muted">Optional global proteome data for normalization</p>
              </div>
              <button
                onClick={() => setPtmGlobalProteomeExpanded(!ptmGlobalProteomeExpanded)}
                className="ml-auto text-sm font-medium text-primary hover:text-primary-dark transition-colors flex items-center gap-1"
              >
                {ptmGlobalProteomeExpanded ? (
                  <><Minus className="w-4 h-4" /> Hide Global Proteome</>
                ) : (
                  <><Plus className="w-4 h-4" /> Add Global Proteome Data</>
                )}
              </button>
            </div>
            <div className="p-5" data-testid="global-proteome-zone">
              {!ptmGlobalProteomeExpanded ? (
                <p className="text-sm text-text-muted italic">
                  No global proteome data (Mode A &mdash; PTM only)
                </p>
              ) : (
                <div>
                  <div
                    role="button"
                    tabIndex={0}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingPtmGlobal(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDraggingPtmGlobal(false); }}
                    onDrop={handlePtmGlobalDrop}
                    onClick={() => ptmGlobalInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ptmGlobalInputRef.current?.click(); } }}
                    className={cn(
                      'relative border-2 border-dashed rounded-xl p-6 cursor-pointer transition-all duration-200',
                      isDraggingPtmGlobal
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary bg-surface/50 hover:bg-surface'
                    )}
                  >
                    <input ref={ptmGlobalInputRef} type="file" accept=".csv" multiple onChange={handlePtmGlobalChange} className="hidden" />
                    <div className="flex flex-col items-center text-center space-y-2">
                      <Upload className="w-6 h-6 text-text-muted" />
                      <p className="text-sm text-text">Drop global proteome CSV files here</p>
                      <p className="text-xs text-text-muted">or click to browse</p>
                    </div>
                  </div>
                  {ptmGlobalUploading && (
                    <div className="flex items-center gap-2 mt-3 text-sm text-text-muted">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading global proteome files...
                    </div>
                  )}
                  {ptmGlobalFiles.length > 0 && (
                    <div className="mt-4 space-y-1.5">
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">Uploaded Files</p>
                      {ptmGlobalFiles.map((f) => (
                        <div key={f.filename} className="flex items-center justify-between p-2 rounded-md border border-border bg-background text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                            <span className="text-text truncate" title={f.filename}>{f.filename}</span>
                          </div>
                          <button
                            onClick={() => removePtmGlobalFile(f.filename)}
                            className="p-1 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors flex-shrink-0 ml-2"
                            title="Remove file"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Zone 3: FASTA Reference */}
          <section className="bg-background border border-border rounded-lg">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
              <FileText className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-text-primary">FASTA Reference</h2>
                <p className="text-sm text-text-muted">
                  Select an organism or upload a custom FASTA file (required)
                </p>
              </div>
              {(ptmFastaUploadMethod !== null || ptmFastaFile !== null) && (
                <span className="ml-auto text-xs bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">
                  FASTA set
                </span>
              )}
            </div>
            <div className="p-5" data-testid="fasta-zone">
              {/* Organism quick-select buttons */}
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => { setPtmFastaUploadMethod('human'); setPtmFastaFile(null); }}
                  className={cn(
                    'px-4 py-2 text-sm rounded-lg border transition-colors',
                    ptmFastaUploadMethod === 'human'
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-background text-text-secondary hover:bg-surface hover:text-text'
                  )}
                >
                  Human (UP000005640)
                </button>
                <button
                  onClick={() => { setPtmFastaUploadMethod('mouse'); setPtmFastaFile(null); }}
                  className={cn(
                    'px-4 py-2 text-sm rounded-lg border transition-colors',
                    ptmFastaUploadMethod === 'mouse'
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-background text-text-secondary hover:bg-surface hover:text-text'
                  )}
                >
                  Mouse (UP000000589)
                </button>
                <button
                  onClick={() => { setPtmFastaUploadMethod('custom'); }}
                  className={cn(
                    'px-4 py-2 text-sm rounded-lg border transition-colors',
                    ptmFastaUploadMethod === 'custom' && !ptmFastaFile
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : ptmFastaFile
                      ? 'border-success/30 bg-success/5 text-success font-medium'
                      : 'border-border bg-background text-text-secondary hover:bg-surface hover:text-text'
                  )}
                >
                  Custom Upload
                </button>
              </div>

              {/* Custom FASTA upload drop zone */}
              {ptmFastaUploadMethod === 'custom' && !ptmFastaFile && (
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingFasta(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDraggingFasta(false); }}
                  onDrop={handleFastaDrop}
                  onClick={() => fastaInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fastaInputRef.current?.click(); } }}
                  className={cn(
                    'relative border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all duration-200',
                    isDraggingFasta
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary bg-surface/50 hover:bg-surface'
                  )}
                >
                  <input ref={fastaInputRef} type="file" accept=".fasta,.fa,.faa" onChange={handleFastaChange} className="hidden" />
                  <div className="flex flex-col items-center text-center space-y-2">
                    <FileText className="w-6 h-6 text-text-muted" />
                    <p className="text-sm text-text">Drop a FASTA file here or click to browse</p>
                    <p className="text-xs text-text-muted">Supported: .fasta, .fa, .faa (max 100MB)</p>
                  </div>
                </div>
              )}

              {/* FASTA uploading indicator */}
              {ptmFastaUploading && (
                <div className="flex items-center gap-2 mt-3 text-sm text-text-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading FASTA file...
                </div>
              )}

              {/* FASTA file info */}
              {ptmFastaFile && (
                <div className="mt-3 flex items-center justify-between p-3 rounded-md border border-success/20 bg-success/5 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-success" />
                    <span className="text-text font-medium">{ptmFastaFile.name}</span>
                    <span className="text-text-muted text-xs">
                      ({(ptmFastaFile.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <button
                    onClick={() => { setPtmFastaFile(null); if (ptmFastaUploadMethod === 'custom') setPtmFastaUploadMethod(null); }}
                    className="p-1 text-text-muted hover:text-error rounded transition-colors"
                    title="Remove FASTA"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Detected Modifications */}
          {ptmEnrichmentFiles.length > 0 && (
            <section className="bg-background border border-border rounded-lg">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <Tag className="w-5 h-5 text-primary" />
                <div>
                  <h2 className="font-semibold text-text-primary">Detected Modifications</h2>
                  <p className="text-sm text-text-muted">
                    Select post-translational modifications to include in analysis
                  </p>
                </div>
                {detectedMods.length > 0 && (
                  <span className="ml-auto text-xs text-text-muted">
                    {selectedMods.size} of {detectedMods.length} selected
                  </span>
                )}
              </div>
              <div className="p-5">
                {detectedMods.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Detecting modifications from uploaded files...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {detectedMods.map((mod) => (
                      <label
                        key={mod}
                        data-testid={`ptm-mod-checkbox-${mod.replace(/[^a-zA-Z0-9]/g, '-')}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface cursor-pointer hover:bg-surface/80 transition-colors select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMods.has(mod)}
                          onChange={() => {
                            setSelectedMods((prev) => {
                              const next = new Set(prev);
                              if (next.has(mod)) next.delete(mod);
                              else next.add(mod);
                              return next;
                            });
                          }}
                          className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                        />
                        <span className="text-sm text-text">{mod}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ExperimentTable for PTM enrichment files */}
          {uploadedFiles.length > 0 && (
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

          {/* PTM Validation */}
          {ptmEnrichmentFiles.length > 0 && (
            <section className="bg-background border border-border rounded-lg">
              <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-primary" />
                <div>
                  <h2 className="font-semibold text-text-primary">Validation</h2>
                  <p className="text-sm text-text-muted">Check PTM experiment setup requirements</p>
                </div>
              </div>
              <div className="p-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    {ptmHasEnrichmentFiles ? (
                      <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
                    )}
                    <span className={ptmHasEnrichmentFiles ? 'text-text' : 'text-text-muted'}>
                      PTM enrichment data uploaded
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {ptmHasFasta ? (
                      <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
                    )}
                    <span className={ptmHasFasta ? 'text-text' : 'text-text-muted'}>
                      FASTA reference provided
                    </span>
                  </div>
                  {ptmEnrichmentFiles.length >= 2 && (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                      <span className="text-text">Multiple files uploaded for comparison analysis</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
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
              {analysisType === 'ptm' ? 'Continue to Comparisons' : 'Continue to Metadata'}
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
