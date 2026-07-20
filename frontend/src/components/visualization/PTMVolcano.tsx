'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Microscope } from 'lucide-react';
import VolcanoPlot from '@/components/visualization/VolcanoPlot';
import { FilterPanel } from '@/components/visualization/FilterPanel';
import PTMResultTable, { type PTMResultRow } from '@/components/visualization/PTMResultTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchableSelect } from '@/components/ui/Select';
import { getDataSource, updateVisualizationState } from '@/lib/api-client';
import {
  formatNumber,
  formatPValue,
  getSignificanceLabel,
  getVolcanoPointColor,
  isSignificantVolcano,
} from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { useUIStore } from '@/stores/ui-store';
import type { DEResult, VolcanoFilters } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface PTMVolcanoProps {
  sessionId: string;
}

type Layer = 'ptm' | 'protein' | 'adjusted';

interface ComparisonData {
  label: string;
  ptm_model: Record<string, unknown>[];
  protein_model: Record<string, unknown>[];
  adjusted_model: Record<string, unknown>[];
}

interface SiteDetails {
  site?: Record<string, unknown>;
  evidence?: Record<string, unknown>[];
  peptidoforms?: Record<string, unknown>[];
}

const DEFAULT_FILTERS: VolcanoFilters = {
  foldChange: 1,
  pValue: 0.05,
  adjPValue: 1,
  s0: 0.1,
};

const LAYERS: Array<{ key: Layer; label: string; description: string }> = [
  { key: 'ptm', label: 'PTM', description: 'PTM site change using the selected normalization method' },
  { key: 'protein', label: 'Protein', description: 'Matched global protein change' },
  { key: 'adjusted', label: 'Protein-adjusted PTM', description: 'PTM change minus matched protein change' },
];

function numeric(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRow(raw: Record<string, unknown>): PTMResultRow {
  const id = String(raw.Protein ?? raw.ProteinName ?? '');
  return {
    id,
    display: String(raw.SiteLabel ?? id),
    accession: String(raw.ProteinAccession ?? raw.GlobalProtein ?? raw.Protein ?? ''),
    gene: String(raw.Gene ?? raw.Gene_Name ?? ''),
    localization: String(raw.LocalizationStatus ?? ''),
    mapping: String(raw.MappingStatus ?? ''),
    logFC: numeric(raw.log2FC),
    pValue: numeric(raw.pvalue),
    adjPValue: numeric(raw['adj.pvalue']),
    status: String(raw.Status ?? (numeric(raw.pvalue) === null ? 'Unestimable' : 'Estimated')),
    raw,
  };
}

function rowsForLayer(comparison: ComparisonData, layer: Layer): PTMResultRow[] {
  const source = layer === 'ptm'
    ? comparison.ptm_model
    : layer === 'protein'
      ? comparison.protein_model
      : comparison.adjusted_model;
  return (source ?? []).map(normalizeRow);
}

function toDEResult(row: PTMResultRow, filters: VolcanoFilters): DEResult {
  return {
    master_protein_accessions: row.id,
    gene_name: row.gene,
    log_fc: row.logFC ?? 0,
    pval: row.pValue ?? 1,
    adj_pval: row.adjPValue ?? 1,
    significant: isSignificantVolcano(
      row.logFC ?? 0,
      row.pValue ?? 1,
      row.adjPValue ?? 1,
      filters,
    ),
  };
}

function LocalizationBadge({ status }: { status: string }) {
  if (!status) return <span className="text-sm text-text-muted">-</span>;
  const style = status === 'Confident'
    ? 'border-success/20 bg-success/10 text-success'
    : status === 'Ambiguous'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-border bg-surface text-text-muted';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>{status}</span>;
}

function PTMInfoPanel({
  sessionId,
  row,
  layer,
  filters,
}: {
  sessionId: string;
  row: PTMResultRow | null;
  layer: Layer;
  filters: VolcanoFilters;
}) {
  const [details, setDetails] = useState<SiteDetails | null>(null);
  const [samples, setSamples] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!row || layer === 'protein') return;
    const encoded = encodeURIComponent(row.id);
    Promise.all([
      fetch(`/api/sessions/${sessionId}/ptm/site/${encoded}`).then((response) => response.ok ? response.json() : null),
      fetch(`/api/sessions/${sessionId}/ptm/site/${encoded}/abundance`).then((response) => response.ok ? response.json() : null),
    ]).then(([detailResponse, abundanceResponse]) => {
      setDetails(detailResponse?.data ?? null);
      setSamples(abundanceResponse?.data?.samples ?? []);
    }).catch(() => undefined);
  }, [layer, row, sessionId]);

  if (!row) {
    return (
      <EmptyState
        title={layer === 'protein' ? 'No Protein Selected' : 'No PTM Site Selected'}
        description={`Click on a point in the volcano plot or a row in the table to view ${layer === 'protein' ? 'protein' : 'PTM site'} details.`}
        icon={<Microscope className="h-8 w-8 text-text-muted" />}
      />
    );
  }

  const site = details?.site ?? row.raw;
  const evidence = details?.evidence ?? [];
  const peptidoforms = details?.peptidoforms ?? [];
  const abundancePairs = samples
    .map((sample) => ({
      sample,
      abundance: numeric(sample.Abundance ?? sample.NormalizedAbundance),
    }))
    .filter((item): item is { sample: Record<string, unknown>; abundance: number } => item.abundance !== null);
  const significance = getSignificanceLabel(
    row.logFC ?? 0,
    row.pValue ?? 1,
    row.adjPValue ?? 1,
    filters,
  );
  const significanceColor = getVolcanoPointColor(
    row.logFC ?? 0,
    row.pValue ?? 1,
    row.adjPValue ?? 1,
    filters,
  );
  const psmCount = evidence.length || Number(site.ConfidentEvidence ?? 0)
    + Number(site.AmbiguousEvidence ?? 0)
    + Number(site.UnscoredEvidence ?? 0);

  const detailRow = (label: string, value: React.ReactNode, last = false) => (
    <div className={`flex items-center justify-between py-2 ${last ? '' : 'border-b border-border'}`}>
      <span className="text-sm text-text-muted">{label}</span>
      <span className="ml-4 text-right text-sm font-medium text-text-primary">{value}</span>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-background p-6" data-testid="ptm-info-panel">
      <h3 className="mb-4 text-lg font-semibold text-text-primary">
        {layer === 'protein' ? 'Protein Information' : 'PTM Site Information'}
      </h3>

      <div className="mb-6 space-y-1">
        {layer !== 'protein' && detailRow('PTM Site', <span className="break-all">{row.display}</span>)}
        {detailRow('UniProt ID', (
          <a
            href={`https://www.uniprot.org/uniprotkb/${row.accession.split(';')[0].trim()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-secondary hover:underline"
          >
            {row.accession}
          </a>
        ))}
        {detailRow('Gene', row.gene || '-')}
        {layer !== 'protein' && detailRow('Target Modification', String(site.TargetModification ?? '-'))}
        {layer !== 'protein' && detailRow('Localization', <LocalizationBadge status={String(site.LocalizationStatus ?? row.localization)} />)}
        {layer !== 'protein' && detailRow('Mapping', String(site.MappingStatus ?? row.mapping ?? '-'))}
        {detailRow('Fold Change', row.logFC === null ? '-' : formatNumber(2 ** row.logFC, 3))}
        {detailRow('Log2 Fold Change', row.logFC === null ? '-' : formatNumber(row.logFC, 3))}
        {detailRow('P-value', row.pValue === null ? '-' : formatPValue(row.pValue))}
        {detailRow('Adj P-value', row.adjPValue === null ? '-' : formatPValue(row.adjPValue))}
        {detailRow(layer === 'protein' ? 'Number of PSMs' : 'Supporting PSMs', psmCount || '-')}
        {detailRow('Significance', (
          <span
            className="rounded px-2 py-1 text-sm font-medium"
            style={{
              backgroundColor: significance === 'Not Significant' ? 'var(--color-surface, #f1f5f9)' : `${significanceColor}20`,
              color: significance === 'Not Significant' ? '#94a3b8' : significanceColor,
            }}
          >
            {significance}
          </span>
        ), true)}
      </div>

      {layer !== 'protein' && abundancePairs.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-2 text-sm font-medium text-text-primary">PTM Site Abundance</h4>
          <div className="h-52">
            <Plot
              data={[{
                type: 'box',
                x: abundancePairs.map(({ sample }) => String(sample.Condition ?? '')),
                y: abundancePairs.map(({ abundance }) => abundance),
                boxpoints: 'all',
                jitter: 0.25,
                pointpos: 0,
                marker: { color: '#6366F1', size: 7 },
                line: { color: '#6366F1' },
                hovertemplate: '%{x}<br>log2 abundance: %{y:.3f}<extra></extra>',
              }]}
              layout={{
                margin: { l: 48, r: 10, t: 8, b: 40 },
                xaxis: { title: '' },
                yaxis: { title: { text: 'log2 abundance' }, gridcolor: '#E5E7EB' },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                showlegend: false,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </div>
      )}

      {layer !== 'protein' && evidence.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-text-primary">
            Localization Evidence ({evidence.length} PSMs, {peptidoforms.length} peptidoforms)
          </h4>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {evidence.slice(0, 30).map((item, index) => (
              <div key={`${String(item._SourceRow ?? index)}-${index}`} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-text-primary">{String(item.PeptideSequence ?? '')}</span>
                  <LocalizationBadge status={String(item.LocalizationStatus ?? '')} />
                </div>
                <p className="mt-1 text-text-muted">
                  {String(item.LocalizationSource ?? 'Unscored')}
                  {item.LocalizationScores ? ` · ${String(item.LocalizationScores)}%` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PTMVolcano({ sessionId }: PTMVolcanoProps) {
  const addToast = useUIStore((state) => state.addToast);
  const [sessionName, setSessionName] = useState('Results');
  const [comparisons, setComparisons] = useState<ComparisonData[]>([]);
  const [comparisonIndex, setComparisonIndex] = useState(0);
  const [layer, setLayer] = useState<Layer>('ptm');
  const [filtersByComparison, setFiltersByComparison] = useState<Record<string, VolcanoFilters>>({});
  const [markedByKey, setMarkedByKey] = useState<Record<string, Set<string>>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchMarkOpen, setBatchMarkOpen] = useState(false);
  const [batchComparisons, setBatchComparisons] = useState<Set<string>>(new Set());
  const batchMarkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/sessions/${sessionId}/ptm/results`).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }),
      getDataSource(`/api/sessions/${sessionId}`),
    ]).then(([resultResponse, session]) => {
      setComparisons(resultResponse.data?.comparisons ?? []);
      setSessionName(session.name || 'Results');
      const restored: Record<string, Set<string>> = {};
      if (session.markers && typeof session.markers === 'object' && !Array.isArray(session.markers)) {
        for (const [key, ids] of Object.entries(session.markers)) restored[key] = new Set(ids);
      }
      setMarkedByKey(restored);
      if (session.ptm_volcano_filters) setFiltersByComparison(session.ptm_volcano_filters);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Failed to load PTM results');
    }).finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!batchMarkOpen) return;
    const close = (event: MouseEvent) => {
      if (batchMarkRef.current && !batchMarkRef.current.contains(event.target as Node)) setBatchMarkOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [batchMarkOpen]);

  const comparison = comparisons[comparisonIndex];
  const filters = comparison ? filtersByComparison[comparison.label] ?? DEFAULT_FILTERS : DEFAULT_FILTERS;
  const debouncedFilters = useDebounce(filters, 150);
  const layerRows = useMemo(() => comparison ? rowsForLayer(comparison, layer) : [], [comparison, layer]);
  const plottedRows = useMemo(
    () => layerRows.filter((row) => row.logFC !== null && row.pValue !== null),
    [layerRows],
  );
  const rowById = useMemo(() => new Map(layerRows.map((row) => [row.id, row])), [layerRows]);
  const plotData = useMemo(
    () => plottedRows.map((row) => toDEResult(row, debouncedFilters)),
    [debouncedFilters, plottedRows],
  );
  const selectedRow = selectedId ? rowById.get(selectedId) ?? null : null;
  const markerKey = comparison ? `${comparison.label}::${layer}` : '';
  const markedIds = useMemo(
    () => markedByKey[markerKey] ?? new Set<string>(),
    [markedByKey, markerKey],
  );
  const comparisonLabel = comparison?.label.replace(/_vs_/g, ' vs ') ?? '';

  const deCounts = useMemo(() => {
    const significant = plottedRows.filter((row) => isSignificantVolcano(
      row.logFC ?? 0,
      row.pValue ?? 1,
      row.adjPValue ?? 1,
      debouncedFilters,
    ));
    return {
      total: significant.length,
      up: significant.filter((row) => (row.logFC ?? 0) > 0).length,
      down: significant.filter((row) => (row.logFC ?? 0) < 0).length,
    };
  }, [debouncedFilters, plottedRows]);

  const comparisonOptions = useMemo(() => comparisons.map((item) => ({
    value: item.label,
    label: item.label.replace(/_vs_/g, ' vs '),
  })), [comparisons]);

  const selectIds = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    setSelectedId(ids[0] ?? null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedId(null);
  }, []);

  const updateMarked = useCallback((key: string, ids: Set<string>) => {
    setMarkedByKey((current) => ({ ...current, [key]: ids }));
  }, []);

  const toggleMark = useCallback((row: PTMResultRow) => {
    const next = new Set(markedIds);
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    updateMarked(markerKey, next);
  }, [markedIds, markerKey, updateMarked]);

  const markAllSignificant = useCallback(() => {
    updateMarked(markerKey, new Set(plottedRows
      .filter((row) => isSignificantVolcano(
        row.logFC ?? 0,
        row.pValue ?? 1,
        row.adjPValue ?? 1,
        debouncedFilters,
      ))
      .map((row) => row.id)));
  }, [debouncedFilters, markerKey, plottedRows, updateMarked]);

  const handleBatchMark = () => {
    try {
      const next = { ...markedByKey };
      for (const label of batchComparisons) {
        const item = comparisons.find((candidate) => candidate.label === label);
        if (!item) continue;
        const comparisonFilters = filtersByComparison[label] ?? DEFAULT_FILTERS;
        next[`${label}::${layer}`] = new Set(rowsForLayer(item, layer)
          .filter((row) => row.logFC !== null && row.pValue !== null)
          .filter((row) => isSignificantVolcano(
            row.logFC ?? 0,
            row.pValue ?? 1,
            row.adjPValue ?? 1,
            comparisonFilters,
          ))
          .map((row) => row.id));
      }
      setMarkedByKey(next);
      setBatchMarkOpen(false);
    } catch {
      addToast('error', 'Failed to mark significant PTM entries across comparisons.');
    }
  };

  useEffect(() => {
    if (loading || error) return;
    const markers = Object.fromEntries(Object.entries(markedByKey)
      .filter(([, ids]) => ids.size > 0)
      .map(([key, ids]) => [key, Array.from(ids)]));
    const timer = setTimeout(() => {
      updateVisualizationState(`/api/sessions/${sessionId}`, { markers }).catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [error, loading, markedByKey, sessionId]);

  useEffect(() => {
    if (Object.keys(filtersByComparison).length === 0) return;
    const timer = setTimeout(() => {
      updateVisualizationState(`/api/sessions/${sessionId}`, {
        ptm_volcano_filters: filtersByComparison,
      }).catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [filtersByComparison, sessionId]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="h-48 animate-pulse rounded-lg bg-border/30" />
          <div className="h-96 animate-pulse rounded-lg bg-border/30" />
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-border/30" />
      </div>
    );
  }
  if (error) return <div className="rounded-lg border border-error/20 bg-error/5 p-5 text-error">{error}</div>;
  if (!comparison) return <div className="rounded-lg border border-border bg-background p-10 text-center text-text-muted">No PTM results are available.</div>;

  return (
    <div data-testid="ptm-volcano-container">
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-5 py-3 text-sm" data-testid="general-info-panel">
        <span className="font-semibold text-text-primary">{sessionName}</span>
        <div className="h-4 w-px bg-border" />
        <SearchableSelect
          options={comparisonOptions}
          value={comparison.label}
          onChange={(value) => {
            const nextIndex = Math.max(0, comparisons.findIndex((item) => item.label === value));
            const nextComparison = comparisons[nextIndex];
            setComparisonIndex(nextIndex);
            if (nextComparison && layer !== 'ptm' && rowsForLayer(nextComparison, layer).length === 0) {
              setLayer('ptm');
            }
            clearSelection();
          }}
          placeholder="Select comparison..."
          searchPlaceholder="Filter comparisons..."
          className="min-w-[280px]"
        />
        <div className="h-4 w-px bg-border" />
        <span className="text-text-secondary">
          {layerRows.length.toLocaleString()} {layer === 'protein' ? 'proteins' : 'PTM sites'}
        </span>
        <div className="h-4 w-px bg-border" />
        <span className="text-text-secondary">
          {deCounts.total.toLocaleString()} DE (
          <span className="font-semibold text-primary">{deCounts.up.toLocaleString()}↑</span>{' '}
          <span className="font-semibold text-secondary">{deCounts.down.toLocaleString()}↓</span>)
        </span>
        <div className="h-4 w-px bg-border" />
        <div className="relative" ref={batchMarkRef}>
          <button
            type="button"
            onClick={() => setBatchMarkOpen((current) => !current)}
            className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-border/30"
          >
            Mark Significant in Batch
          </button>
          {batchMarkOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 space-y-2 rounded-lg border border-border bg-background p-3 shadow-lg">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={batchComparisons.size === comparisons.length}
                  onChange={() => setBatchComparisons(
                    batchComparisons.size === comparisons.length
                      ? new Set()
                      : new Set(comparisons.map((item) => item.label)),
                  )}
                  className="rounded border-border"
                />
                Select All
              </label>
              <div className="max-h-48 space-y-1 overflow-y-auto border-t border-border pt-2">
                {comparisonOptions.map((item) => (
                  <label key={item.value} className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary hover:text-text-primary">
                    <input
                      type="checkbox"
                      checked={batchComparisons.has(item.value)}
                      onChange={() => {
                        const next = new Set(batchComparisons);
                        if (next.has(item.value)) next.delete(item.value);
                        else next.add(item.value);
                        setBatchComparisons(next);
                      }}
                      className="rounded border-border"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={handleBatchMark}
                disabled={batchComparisons.size === 0}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Mark {batchComparisons.size || ''} comparison(s)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-background p-3">
        {LAYERS.map((item) => {
          const disabled = item.key === 'protein'
            ? comparison.protein_model.length === 0
            : item.key === 'adjusted'
              ? comparison.adjusted_model.length === 0
              : false;
          return (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              title={disabled ? 'A matched protein PSM file is required for this layer.' : item.description}
              onClick={() => {
                setLayer(item.key);
                clearSelection();
              }}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                layer === item.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
              } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <VolcanoPlot
            data={plotData}
            filters={debouncedFilters}
            selectedProteins={selectedIds}
            markedProteins={markedIds}
            onSelectProteins={selectIds}
            onClearSelection={clearSelection}
            comparisonLabel={comparisonLabel}
            itemName={layer === 'protein' ? 'Proteins' : 'PTM sites'}
            getPointLabel={(item) => rowById.get(item.master_protein_accessions)?.gene
              || rowById.get(item.master_protein_accessions)?.display
              || item.master_protein_accessions}
            getHoverText={(item) => {
              const row = rowById.get(item.master_protein_accessions);
              if (!row) return item.master_protein_accessions;
              return [
                `<b>${row.display}</b>`,
                `Protein: ${row.accession}`,
                `Gene: ${row.gene || 'N/A'}`,
                `Log2 FC: ${item.log_fc.toFixed(3)}`,
                `P-value: ${item.pval.toExponential(2)}`,
                `Adj P-value: ${item.adj_pval.toExponential(2)}`,
                row.localization ? `Localization: ${row.localization}` : '',
              ].filter(Boolean).join('<br>');
            }}
          />

          <FilterPanel
            {...filters}
            onChange={(updated) => setFiltersByComparison((current) => ({
              ...current,
              [comparison.label]: updated,
            }))}
            onReset={() => setFiltersByComparison((current) => ({
              ...current,
              [comparison.label]: DEFAULT_FILTERS,
            }))}
          />

          <PTMResultTable
            data={layerRows}
            layer={layer}
            selectedIds={selectedIds}
            markedIds={markedIds}
            filters={debouncedFilters}
            comparisonLabel={comparisonLabel}
            onSelect={(row) => selectIds([row.id])}
            onToggleMark={toggleMark}
            onMarkAllSignificant={markAllSignificant}
            onClearAllMarks={() => updateMarked(markerKey, new Set())}
          />
        </div>

        <div className="lg:col-span-1">
          {selectedIds.size > 1 ? (
            <div className="rounded-lg border border-border bg-background p-6">
              <div className="py-8 text-center text-text-secondary">
                <p className="text-lg font-medium">Multiple Entries Selected</p>
                <p className="mt-2 text-sm">{selectedIds.size} entries selected.</p>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="mt-4 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-text-secondary hover:bg-border/30"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          ) : (
            <PTMInfoPanel
              key={`${layer}:${selectedId ?? ''}`}
              sessionId={sessionId}
              row={selectedRow}
              layer={layer}
              filters={filters}
            />
          )}
        </div>
      </div>
    </div>
  );
}
