/**
 * Step 3: Metadata Page
 * Conditional metadata input: TMT shows TmtChannelMapping, DIA shows DiaMetadataTable.
 * PTM redirects to Comparisons (FR1.9).
 * Auto-saves to backend with 800ms debounce.
 * Restores state from backend on mount.
 */

'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Loader2, BarChart3, Dna, CheckCircle,
  AlertCircle, ChevronDown, ChevronRight, FolderOpen,
} from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, fileLibraryApi, mapBackendFiles } from '@/lib/api-client';
import { parseCSVLine } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';
import { useSessionValidation } from '@/hooks/use-session-validation';
import { useAutoSave } from '@/hooks/use-auto-save';
import { useBeforeUnload } from '@/hooks/use-beforeunload';
import TmtChannelMapping from '@/components/analysis/TmtChannelMapping';
import DiaMetadataTable from '@/components/analysis/DiaMetadataTable';

function MetadataContentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const tmtChannelMapping = useAnalysisStore((s) => s.config.tmt_channel_mapping);
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showMetadataPicker, setShowMetadataPicker] = useState(false);

  const importChannelMapping = useAnalysisStore((s) => s.importChannelMapping);
  const importMetadataColumns = useAnalysisStore((s) => s.importMetadataColumns);

  const resetAnalysis = useAnalysisStore((s) => s.reset);

  // Reset analysis store when session changes — prevents stale file/config leakage
  useEffect(() => {
    resetAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useSessionValidation(sessionId || null);

  // TMT files
  const tmtFiles = useMemo(
    () => uploadedFiles.filter((f) => f.file_type === 'tmt'),
    [uploadedFiles]
  );
  const isMultiTmt = tmtFiles.length > 1;

  // Redirect guard
  useEffect(() => {
    if (isRestoring) return;
    if (!sessionId) {
      addToast('error', 'No session found. Please start a new analysis.');
      router.push('/');
      return;
    }
    if (!analysisType) {
      router.replace('/');
      return;
    }
    // FR1.9: PTM redirects to Comparisons
    if (analysisType === 'ptm') {
      router.replace(`/new/comparisons?session=${sessionId}`);
      return;
    }
    if (uploadedFiles.length === 0) {
      router.replace(`/new/upload?session=${sessionId}`);
      return;
    }
  }, [sessionId, analysisType, uploadedFiles.length, isRestoring, router, addToast]);

  const { dismiss: dismissBeforeUnload } = useBeforeUnload();

  // Restore session state on mount
  useEffect(() => {
    if (!sessionId) return;

    const restore = async () => {
      try {
        const sessionResp = await fetch(`/api/sessions/${sessionId}`);
        if (sessionResp.status === 404) {
          addToast('error', 'Session not found. Please start a new analysis.');
          router.push('/');
          return;
        }
        if (sessionResp.ok) {
          const raw = await sessionResp.json();
          const cfg = raw.config as Record<string, unknown> | null;
          if (cfg && typeof cfg === 'object') {
            const updates: Record<string, unknown> = {};

            // Restore tmt_channel_mapping
            if (cfg.tmt_channel_mapping && typeof cfg.tmt_channel_mapping === 'object') {
              updates.tmt_channel_mapping = cfg.tmt_channel_mapping;
            }

            // Restore metadata_columns
            if (cfg.metadata_columns && typeof cfg.metadata_columns === 'object') {
              updates.metadata_columns = cfg.metadata_columns;
            }

            if (Object.keys(updates).length > 0) {
              setConfig(updates);
            }

            // Restore analysis type from file_type config field
            const fileTypeFromConfig = cfg.file_type as string | undefined;
            if (fileTypeFromConfig === 'tmt' || fileTypeFromConfig === 'dia') {
              useAnalysisStore.getState().setAnalysisType(fileTypeFromConfig as 'tmt' | 'dia');
            }
          }

          // Restore uploaded files
          const restoredFiles = mapBackendFiles(raw.files);
          if (restoredFiles.length > 0) {
            const { addUploadedFile } = useAnalysisStore.getState();
            for (const file of restoredFiles) {
              addUploadedFile(file);
            }
          }
        }
      } catch {
        // Network error — allow continuing offline
      } finally {
        setIsRestoring(false);
      }
    };

    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, setConfig]);

  // Auto-save config to backend on changes (debounced) so edits survive refresh
  const { saveError } = useAutoSave(sessionId!, config, { enabled: !isRestoring });

  // Initialize expanded files (expand all on mount)
  useEffect(() => {
    if (isMultiTmt) {
      setExpandedFiles(new Set(tmtFiles.map((f) => f.filename)));
    }
  }, [isMultiTmt, tmtFiles]);

  // --- Validation ---
  const validation = useMemo(() => {
    if (analysisType === 'tmt') {
      const mapping = tmtChannelMapping || {};
      const fileChannelPairs = tmtFiles.flatMap((f) => (f.tmt_channels || []).map((ch) => ({ file: f, channel: ch, key: f.filename + '::' + ch })));
      if (fileChannelPairs.length === 0) {
        return { isValid: false, message: 'No TMT channels detected', warnings: [] };
      }

      // Check all channels mapped
      const unmapped = fileChannelPairs.filter(({ key }) => {
        const entry = mapping[key];
        if (!entry) return true;
        const hasGroupVal = Object.entries(entry).some(
          ([k, v]) => k !== 'replicate' && v !== undefined && v !== null && String(v).trim() !== ''
        );
        const hasReplicate = entry.replicate !== undefined && Number(entry.replicate) > 0;
        return !hasGroupVal || !hasReplicate;
      });

      // Get unique condition combos
      const conditionCombos = new Set<string>();
      fileChannelPairs.forEach(({ key }) => {
        const entry = mapping[key];
        if (!entry) return;
        const groupVals = Object.entries(entry)
          .filter(([k]) => k !== 'replicate')
          .map(([, v]) => String(v ?? '').trim())
          .filter(Boolean)
          .join('+');
        if (groupVals) conditionCombos.add(groupVals);
      });

      const warnings: string[] = [];
      if (conditionCombos.size < 2 && fileChannelPairs.length > 0) {
        warnings.push('Need at least 2 unique condition combinations for comparison');
      }
      if (unmapped.length > 0) {
        warnings.push(`${unmapped.length} channel(s) not fully mapped`);
      }

      return {
        isValid: conditionCombos.size >= 2 && unmapped.length === 0,
        message: warnings.length > 0 ? warnings.join('; ') : '',
        warnings,
      };
    }

    // DIA validation
    const metadataColumns = config.metadata_columns || {};
    if (uploadedFiles.length === 0) {
      return { isValid: false, message: 'No files uploaded', warnings: ['Upload DIA files first'] };
    }

    const coreCols = new Set(['experiment', 'replicate', 'batch']);
    const condCols = new Set<string>();
    Object.values(metadataColumns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (!coreCols.has(k)) condCols.add(k);
      });
    });

    // Check all files have experiment and at least one condition value
    const emptyFiles = uploadedFiles.filter((f) => {
      const meta = metadataColumns[f.filename] || {};
      return !meta.experiment?.trim();
    });

    // Get unique condition combos
    const conditionCombos = new Set<string>();
    uploadedFiles.forEach((f) => {
      const meta = metadataColumns[f.filename] || {};
      const combined = Array.from(condCols)
        .map((col) => meta[col] || '')
        .join('+');
      if (combined) conditionCombos.add(combined);
    });

    const warnings: string[] = [];
    if (conditionCombos.size < 2 && uploadedFiles.length > 0) {
      warnings.push('Need at least 2 unique condition combinations for comparison');
    }
    if (emptyFiles.length > 0) {
      warnings.push(`${emptyFiles.length} file(s) missing experiment name`);
    }

    const replicateKeys = new Set<string>();
    const duplicateReplicates = new Set<string>();
    uploadedFiles.forEach((file) => {
      const meta = metadataColumns[file.filename] || {};
      const replicate = meta.replicate?.trim();
      if (!replicate) return;
      const key = [meta.experiment, ...Array.from(condCols).map((col) => meta[col] || ''), replicate].join('::');
      if (replicateKeys.has(key)) duplicateReplicates.add(key);
      replicateKeys.add(key);
    });
    if (duplicateReplicates.size > 0) {
      warnings.push(`${duplicateReplicates.size} duplicate condition and replicate combination(s)`);
    }

    return {
      isValid: conditionCombos.size >= 2 && emptyFiles.length === 0,
      message: warnings.length > 0 ? warnings.join('; ') : '',
      warnings,
    };
  }, [analysisType, tmtChannelMapping, tmtFiles, uploadedFiles, config.metadata_columns]);

  // --- Navigation ---
  const handleBack = () => {
    router.push(`/new/upload?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (!validation.isValid) {
      addToast('warning', 'Please resolve validation issues before continuing');
      return;
    }
    dismissBeforeUnload();
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      router.replace(`/new/comparisons?session=${sessionId}`);
    } catch (error) {
      addToast('error', `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFileExpanded = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          {analysisType === 'tmt' ? (
            <><BarChart3 className="w-4 h-4" /> MSstats Pipeline</>
          ) : (
            <><Dna className="w-4 h-4" /> msqrob2 Pipeline</>
          )}
        </div>
        <h1 className="font-bold text-text-primary">Experiment Metadata</h1>
        <p className="text-text-muted mt-1">
          {analysisType === 'tmt'
            ? 'Assign TMT channels to condition groups and replicates'
            : 'Configure metadata for each uploaded DIA file'
          }
        </p>
      </div>

      {/* TMT Channel Mapping */}
      {analysisType === 'tmt' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">TMT Channel Mapping</h2>
              <p className="text-sm text-text-muted">
                Map each TMT channel to a condition group and replicate
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {isMultiTmt && (
                <>
                  <button
                    onClick={() => setExpandedFiles(new Set(tmtFiles.map((file) => file.filename)))}
                    className="px-2 py-1 text-xs font-medium text-text-secondary hover:text-text"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={() => setExpandedFiles(new Set())}
                    className="px-2 py-1 text-xs font-medium text-text-secondary hover:text-text"
                  >
                    Collapse All
                  </button>
                </>
              )}
              <button
                onClick={() => setShowMetadataPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
                data-testid="import-from-library-btn"
              >
                <FolderOpen className="w-4 h-4" />
                Import from Library
              </button>
            </div>
          </div>
          <div className="p-5 space-y-6">
            {isMultiTmt ? (
              // Multi-file TMT: collapsible sections per file
              tmtFiles.map((file) => {
                const isExpanded = expandedFiles.has(file.filename);
                return (
                  <div key={file.filename} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleFileExpanded(file.filename)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface/80 transition-colors text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-text truncate block">
                          {file.filename}
                        </span>
                        <span className="text-xs text-text-muted">
                          {(file.size / 1024 / 1024).toFixed(2)} MB &middot; {file.tmt_channels?.length || 0} channels
                        </span>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="p-4 border-t border-border">
                        <TmtChannelMapping file={file} compact />
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              // Single-file TMT
              tmtFiles.map((file) => (
                <TmtChannelMapping key={file.filename} file={file} />
              ))
            )}
          </div>
        </section>
      )}

      {/* DIA Metadata Table */}
      {analysisType === 'dia' && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border flex items-center gap-3">
            <Dna className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">DIA File Metadata</h2>
              <p className="text-sm text-text-muted">
                Assign experiment, condition groups, replicate, and batch to each file
              </p>
            </div>
            <button
              onClick={() => setShowMetadataPicker(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
              data-testid="import-from-library-btn"
            >
              <FolderOpen className="w-4 h-4" />
              Import from Library
            </button>
          </div>
          <div className="p-5">
            <DiaMetadataTable />
          </div>
        </section>
      )}

      {showMetadataPicker && (
        <FileLibraryPicker
          sessionId={sessionId}
          fileType="csv-only"
          onSelect={async (paths) => {
            setShowMetadataPicker(false);
            if (paths.length > 0) {
              // Fetch first selected CSV content and parse
              const content = await fileLibraryApi.getContent(paths[0]);
              if (analysisType === 'tmt') {
                // Import channel mapping for all TMT files (bare channel names
                // in CSV apply to each file's channels)
                for (const f of tmtFiles) {
                  importChannelMapping(f.filename, content);
                }
                addToast('success', `Channel mapping imported for ${tmtFiles.length} file(s)`);
              } else {
                // DIA: parse CSV with expected columns: filename, experiment, ..., replicate, batch
                const text = content.replace(/\r/g, '');
                const lines = text.split('\n').filter((l) => l.trim());
                if (lines.length < 2) {
                  addToast('warning', 'CSV must have a header and at least one data row');
                  return;
                }
                const headers = parseCSVLine(lines[0]);
                const filenameIdx = headers.indexOf('filename');
                if (filenameIdx === -1) {
                  addToast('warning', 'CSV must have a "filename" column');
                  return;
                }
                const colNames = headers.filter((h) => h !== 'filename');
                const imported: Record<string, Record<string, string>> = {};
                for (let i = 1; i < lines.length; i++) {
                  const values = parseCSVLine(lines[i]);
                  const fn = values[filenameIdx];
                  if (!fn) continue;
                  const entry: Record<string, string> = {};
                  colNames.forEach((col) => {
                    const colIdx = headers.indexOf(col);
                    if (colIdx >= 0) entry[col] = values[colIdx] || '';
                  });
                  imported[fn] = entry;
                }
                // Check for conflicts before overwriting
                const conflicts: string[] = [];
                const existing = config.metadata_columns ?? {};
                for (const fn of Object.keys(imported)) {
                  if (existing[fn]) {
                    for (const key of Object.keys(imported[fn])) {
                      if (existing[fn][key] && existing[fn][key] !== imported[fn][key]) {
                        conflicts.push(`${fn}: ${key} (${existing[fn][key]} → ${imported[fn][key]})`);
                      }
                    }
                  }
                }
                if (conflicts.length > 0) {
                  const confirmed = window.confirm(
                    `This will overwrite ${conflicts.length} value(s):\n${conflicts.slice(0, 5).join('\n')}${conflicts.length > 5 ? `\n...and ${conflicts.length - 5} more` : ''}\n\nContinue?`
                  );
                  if (!confirmed) return;
                }
                importMetadataColumns(imported);
                addToast('success', `Metadata imported from library (${Object.keys(imported).length} files)`);
              }
            }
          }}
          onClose={() => setShowMetadataPicker(false)}
        />
      )}

      {/* Validation */}
      {!validation.isValid && (
        <div className="space-y-2">
          {validation.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {validation.isValid && (
        <div className="flex items-center gap-2 p-3 bg-success/5 border border-success/20 rounded-lg text-sm text-success">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          Configuration is valid
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Upload
        </button>

        <button
          data-testid="metadata-continue-btn"
          onClick={handleContinue}
          disabled={!validation.isValid || isSaving}
          className={cn(
            'flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors',
            validation.isValid && !isSaving
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-surface text-text-muted cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              Continue to Comparisons
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

function MetadataContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';
  return <MetadataContentInner key={sessionId || 'no-session'} />;
}

export default function MetadataPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    }>
      <MetadataContent />
    </Suspense>
  );
}
