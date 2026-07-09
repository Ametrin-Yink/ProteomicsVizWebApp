/**
 * Step 3: Metadata Page
 * Conditional metadata input: TMT shows TmtChannelMapping, DIA shows DiaMetadataTable.
 * PTM redirects to Comparisons (FR1.9).
 * Auto-saves to backend with 800ms debounce.
 * Restores state from backend on mount.
 */

'use client';

import React, { useEffect, useState, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Loader2, BarChart3, Dna, CheckCircle,
  AlertCircle, ChevronDown, ChevronRight, FlaskConical,
} from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import TmtChannelMapping from '@/components/analysis/TmtChannelMapping';
import DiaMetadataTable from '@/components/analysis/DiaMetadataTable';
import type { UploadedFileInfo } from '@/types';

function MetadataContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const tmtChannelMapping = useAnalysisStore((s) => s.tmtChannelMapping);
  const { addToast } = useUIStore();

  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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
      router.replace(`/new/type?session=${sessionId}`);
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

  // Restore session state on mount
  useEffect(() => {
    if (!sessionId) return;

    const restore = async () => {
      try {
        const sessionResp = await fetch(`/api/sessions/${sessionId}`);
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
          }
        }
      } catch {
        // Restoration failed; user can continue editing
      } finally {
        setIsRestoring(false);
      }
    };

    restore();
  }, [sessionId, setConfig]);

  // Auto-save with 800ms debounce (FR3.4)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!sessionId || isRestoring) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      sessionsApi.updateConfig(sessionId, config).catch(() => {});
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionId, config, isRestoring]);

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
      const channels = tmtFiles.flatMap((f) => f.tmt_channels || []);
      if (channels.length === 0) {
        return { isValid: false, message: 'No TMT channels detected', warnings: [] };
      }

      // Check all channels mapped
      const unmapped = channels.filter((ch) => {
        const entry = mapping[ch];
        if (!entry) return true;
        const hasGroupVal = Object.entries(entry).some(
          ([k, v]) => k !== 'replicate' && v !== undefined && v !== null && String(v).trim() !== ''
        );
        const hasReplicate = entry.replicate !== undefined && Number(entry.replicate) > 0;
        return !hasGroupVal || !hasReplicate;
      });

      // Get unique condition combos
      const conditionCombos = new Set<string>();
      channels.forEach((ch) => {
        const entry = mapping[ch];
        if (!entry) return;
        const groupVals = Object.entries(entry)
          .filter(([k]) => k !== 'replicate')
          .map(([, v]) => String(v ?? '').trim())
          .filter(Boolean)
          .join('+');
        if (groupVals) conditionCombos.add(groupVals);
      });

      const warnings: string[] = [];
      if (conditionCombos.size < 2 && channels.length > 0) {
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
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
          </div>
          <div className="p-5">
            <DiaMetadataTable />
          </div>
        </section>
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
    </div>
  );
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
