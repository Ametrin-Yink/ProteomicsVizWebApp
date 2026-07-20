'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Database, Dna, FileText, FolderOpen, Tag } from 'lucide-react';
import { FileLibraryPicker } from '@/components/files/FileLibraryPicker';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

type PickerRole = 'ptm_enrichment' | 'global_proteome' | 'custom_fasta';

interface ModificationSummary {
  name: string;
  row_count: number;
  occurrence_count: number;
  sites: string[];
}

interface SessionFile {
  filename: string;
  size: number;
  columns?: string[];
  tmt_channels?: string[];
  detected_modifications?: ModificationSummary[];
}

interface PTMFileSetupProps {
  sessionId: string;
  onReadyChange: (ready: boolean) => void;
}

function FileCard({ file, detail }: { file: SessionFile; detail: string }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-surface/40 px-4 py-3">
      <CheckCircle className="h-4 w-4 shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text" title={file.filename}>{file.filename}</p>
        <p className="text-xs text-text-muted">{detail}</p>
      </div>
    </div>
  );
}

export default function PTMFileSetup({ sessionId, onReadyChange }: PTMFileSetupProps) {
  const config = useAnalysisStore((state) => state.config);
  const setConfig = useAnalysisStore((state) => state.setConfig);
  const addToast = useUIStore((state) => state.addToast);
  const [enrichment, setEnrichment] = useState<SessionFile | null>(null);
  const [protein, setProtein] = useState<SessionFile | null>(null);
  const [customFasta, setCustomFasta] = useState<SessionFile | null>(null);
  const [pickerRole, setPickerRole] = useState<PickerRole | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const response = await fetch(`/api/sessions/${sessionId}`);
    if (!response.ok) throw new Error(`Failed to load session files (HTTP ${response.status})`);
    const session = await response.json();
    const files = session.files ?? {};
    const enrichmentFile = files.ptm_enrichment?.[0] ?? null;
    const modifications = enrichmentFile?.detected_modifications ?? [];
    setEnrichment(enrichmentFile);
    setProtein(files.global_proteome?.[0] ?? null);
    setCustomFasta(files.fasta?.[0] ?? null);

    if (enrichmentFile) {
      const store = useAnalysisStore.getState();
      const selectedTarget = store.config.ptm_target_modification;
      if (
        selectedTarget
        && !modifications.some((item: ModificationSummary) => item.name === selectedTarget)
      ) {
        store.setConfig({ ptm_target_modification: undefined });
      }
      store.addUploadedFile({
        filename: enrichmentFile.filename,
        original_filename: enrichmentFile.original_filename,
        size: enrichmentFile.size,
        columns: enrichmentFile.columns ?? [],
        experiment: '',
        replicate: 0,
        batch: '',
        file_type: 'tmt',
        tmt_channels: enrichmentFile.tmt_channels ?? [],
      });
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      reload()
        .catch((error) => addToast('error', error instanceof Error ? error.message : 'Failed to load PTM files'))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addToast, reload]);

  const detectedModifications = useMemo(
    () => enrichment?.detected_modifications ?? [],
    [enrichment],
  );
  const fastaReady = config.ptm_fasta_source === 'human'
    || config.ptm_fasta_source === 'mouse'
    || (config.ptm_fasta_source === 'custom' && customFasta !== null);
  const targetReady = detectedModifications.some(
    (modification) => modification.name === config.ptm_target_modification,
  );
  const ready = enrichment !== null
    && targetReady
    && fastaReady;

  useEffect(() => onReadyChange(ready), [onReadyChange, ready]);

  const selectFastaSource = (source: 'human' | 'mouse' | 'custom') => {
    setConfig({ ptm_fasta_source: source });
    if (source === 'custom') setPickerRole('custom_fasta');
  };

  if (loading) {
    return <div className="rounded-lg border border-border bg-background p-8 text-sm text-text-muted">Loading PTM setup…</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <FileText className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">PTM enrichment PSMs</h2>
            <p className="text-sm text-text-muted">Select one Proteome Discoverer TMT TXT file from the library.</p>
          </div>
        </div>
        <div className="p-5">
          <button
            type="button"
            onClick={() => setPickerRole('ptm_enrichment')}
            className="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-5 py-3 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <FolderOpen className="h-5 w-5" />
            {enrichment ? 'Replace from File Library' : 'Select from File Library'}
          </button>
          {enrichment && (
            <FileCard
              file={enrichment}
              detail={`${enrichment.tmt_channels?.length ?? 0} reporter channels · ${detectedModifications.length} modifications detected`}
            />
          )}
        </div>
      </section>

      {enrichment && (
        <section className="rounded-lg border border-border bg-background">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <Tag className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">Target modification</h2>
              <p className="text-sm text-text-muted">Choose one detected modification for this analysis.</p>
            </div>
          </div>
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {detectedModifications.map((modification) => (
              <label
                key={modification.name}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  config.ptm_target_modification === modification.name
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-surface/50',
                )}
              >
                <input
                  type="radio"
                  name="ptm-target-modification"
                  className="mt-1"
                  checked={config.ptm_target_modification === modification.name}
                  onChange={() => setConfig({ ptm_target_modification: modification.name })}
                />
                <span>
                  <span className="block text-sm font-medium text-text">{modification.name}</span>
                  <span className="block text-xs text-text-muted">
                    {modification.row_count.toLocaleString()} PSM rows · sites {modification.sites.slice(0, 4).join(', ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">Protein abundance PSMs</h2>
            <p className="text-sm text-text-muted">Optional. Channels must exactly match the PTM file.</p>
          </div>
        </div>
        <div className="p-5">
          <button
            type="button"
            onClick={() => setPickerRole('global_proteome')}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
          >
            <FolderOpen className="h-4 w-4" />
            {protein ? 'Replace protein file' : 'Add protein file'}
          </button>
          {protein ? (
            <FileCard file={protein} detail={`${protein.tmt_channels?.length ?? 0} matching reporter channels`} />
          ) : (
            <div className="mt-3 flex items-start gap-2 text-xs text-text-muted">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Protein and protein-adjusted volcano tabs will remain disabled.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Dna className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-text-primary">FASTA reference</h2>
            <p className="text-sm text-text-muted">Use a bundled reference or select a custom FASTA from the library.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 p-5">
          {(['human', 'mouse', 'custom'] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => selectFastaSource(source)}
              className={cn(
                'rounded-lg border px-4 py-2 text-sm capitalize transition-colors',
                config.ptm_fasta_source === source
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-border text-text-secondary hover:bg-surface',
              )}
            >
              {source === 'custom' ? 'Custom from library' : source}
            </button>
          ))}
          {config.ptm_fasta_source === 'custom' && customFasta && (
            <div className="w-full">
              <FileCard file={customFasta} detail="Custom FASTA reference" />
            </div>
          )}
        </div>
      </section>

      {pickerRole && (
        <FileLibraryPicker
          sessionId={sessionId}
          fileType={pickerRole === 'custom_fasta' ? 'fasta' : 'ptm'}
          role={pickerRole}
          singleSelect
          onSelect={async () => {
            setPickerRole(null);
            await reload();
          }}
          onClose={() => setPickerRole(null)}
        />
      )}
    </div>
  );
}
