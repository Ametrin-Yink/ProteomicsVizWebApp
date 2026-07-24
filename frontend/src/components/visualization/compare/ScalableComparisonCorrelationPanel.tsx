'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle } from 'lucide-react';

import { SearchableSelect, Select } from '@/components/ui/Select';
import ComparisonHeatmap from '@/components/visualization/compare/ComparisonHeatmap';
import VennDiagram from '@/components/visualization/compare/VennDiagram';
import { visualizationApi, getDataSource } from '@/lib/api-client';
import { useApi } from '@/lib/api-context';
import { COLORSCALE_CYAN_GREY_CORAL, formatComparisonKeyWrapped } from '@/lib/utils';
import type {
  CompareRunStatus,
  ComparisonCorrelationLookup,
  ComparisonCorrelationMetadata,
  ComparisonCorrelationTile,
  ComparisonFoldChangeDetail,
  ComparisonSpearmanResult,
  VennData,
  VolcanoFilters,
} from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Props {
  comparisons: Array<{ value: string; label: string }>;
  onComparisonSearch?: (value: string) => void;
}

export default function ScalableComparisonCorrelationPanel({ comparisons, onComparisonSearch }: Props) {
  const { apiPrefix } = useApi();
  const [primary, setPrimary] = useState('');
  const effectivePrimary = primary || comparisons[0]?.value || '';
  const options = useMemo(() => {
    if (!effectivePrimary || comparisons.some((item) => item.value === effectivePrimary)) return comparisons;
    return [{ value: effectivePrimary, label: effectivePrimary.replaceAll('_vs_', ' vs ') }, ...comparisons];
  }, [comparisons, effectivePrimary]);
  const [status, setStatus] = useState<CompareRunStatus>({ status: 'idle' });
  const [metadata, setMetadata] = useState<ComparisonCorrelationMetadata | null>(null);
  const [tile, setTile] = useState<ComparisonCorrelationTile | null>(null);
  const [tilePosition, setTilePosition] = useState({ level: 0, row: 0, column: 0 });
  const [lookup, setLookup] = useState<ComparisonCorrelationLookup | null>(null);
  const [detail, setDetail] = useState<ComparisonFoldChangeDetail | null>(null);
  const [spearmanTarget, setSpearmanTarget] = useState('');
  const [spearman, setSpearman] = useState<ComparisonSpearmanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Venn state
  const [vennComparisons, setVennComparisons] = useState<string[]>([]);
  const [vennData, setVennData] = useState<VennData | null>(null);
  const [vennLoading, setVennLoading] = useState(false);
  const [vennError, setVennError] = useState<string | null>(null);
  const [vennThresholds, setVennThresholds] = useState<VolcanoFilters>({
    foldChange: 1, pValue: 0.05, adjPValue: 0.05, s0: 0.1,
  });
  const [thresholdsLoading, setThresholdsLoading] = useState(true);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadMetadata = useCallback(async () => {
    const result = await visualizationApi.getComparisonCorrelationMetadata(apiPrefix);
    setMetadata(result);
    setStatus({ status: 'completed' });
    setTilePosition({ level: result.max_level, row: 0, column: 0 });
  }, [apiPrefix]);

  useEffect(() => {
    let cancelled = false;
    visualizationApi.getComparisonCorrelationMetadata(apiPrefix).then((result) => {
      if (cancelled) return;
      setMetadata(result);
      setStatus({ status: 'completed' });
      setTilePosition({ level: result.max_level, row: 0, column: 0 });
    }).catch(() => undefined);
    visualizationApi.getComparisonCorrelationStatus(apiPrefix).then((result) => {
      if (!cancelled) setStatus(result);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [apiPrefix]);

  const pollStatus = useCallback(async () => {
    const nextStatus = await visualizationApi.getComparisonCorrelationStatus(apiPrefix);
    setStatus(nextStatus);
    if (nextStatus.status === 'completed') {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      await loadMetadata();
    } else if (nextStatus.status === 'error' || nextStatus.status === 'cancelled') {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setError(nextStatus.error || 'Comparison correlation did not complete');
    }
  }, [apiPrefix, loadMetadata]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    if (!metadata) return;
    const controller = new AbortController();
    visualizationApi.getComparisonCorrelationTile(
      apiPrefix,
      tilePosition.level,
      tilePosition.row,
      tilePosition.column,
      controller.signal,
    ).then(setTile).catch((caught: unknown) => {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Failed to load correlation tile');
    });
    return () => controller.abort();
  }, [apiPrefix, metadata, tilePosition]);

  useEffect(() => {
    if (!metadata || !effectivePrimary) return;
    const controller = new AbortController();
    visualizationApi.lookupComparisonCorrelation(apiPrefix, effectivePrimary, controller.signal)
      .then(async (result) => {
        setLookup(result);
        const detailComparisons = [effectivePrimary, ...result.nearest.slice(0, 9).map((item) => item.comparison_id)];
        setSpearmanTarget(result.nearest[0]?.comparison_id || '');
        setDetail(await visualizationApi.getComparisonFoldChangeDetail(apiPrefix, detailComparisons, controller.signal));
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Failed to load reference comparison');
      });
    return () => controller.abort();
  }, [apiPrefix, effectivePrimary, metadata]);

  // Load volcano thresholds from session on mount
  useEffect(() => {
    const controller = new AbortController();
    getDataSource(apiPrefix, controller.signal).then((session) => {
      if (session.volcano_filters) {
        setVennThresholds(session.volcano_filters);
      }
    }).catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.warn('Failed to load Venn thresholds from session, using defaults:', err);
    }).finally(() => {
      setThresholdsLoading(false);
    });
    return () => controller.abort();
  }, [apiPrefix]);

  const handleComputeVenn = async () => {
    if (vennComparisons.length < 2) return;
    setVennLoading(true);
    setVennError(null);
    try {
      const result = await visualizationApi.computeVennData(apiPrefix, {
        comparisons: vennComparisons,
        pvalue_threshold: vennThresholds.adjPValue,
        logfc_threshold: vennThresholds.foldChange,
      });
      setVennData(result);
    } catch (err) {
      setVennError(err instanceof Error ? err.message : 'Venn computation failed');
    } finally {
      setVennLoading(false);
    }
  };

  const toggleVennComparison = (value: string) => {
    setVennComparisons((prev) => {
      if (prev.includes(value)) {
        return prev.filter((v) => v !== value);
      }
      if (prev.length >= 3) return prev; // Venn max 3 sets
      return [...prev, value];
    });
  };

  const run = async () => {
    setError(null);
    setMetadata(null);
    setStatus({ status: 'running' });
    try {
      await visualizationApi.runComparisonCorrelation(apiPrefix, {
        primary_comparison: effectivePrimary,
        selected_comparisons: effectivePrimary ? [effectivePrimary] : [],
        marked_proteins: {},
        cluster_method: 'pca',
      });
      pollRef.current = setInterval(() => void pollStatus(), 2000);
      void pollStatus();
    } catch (caught) {
      setStatus({ status: 'error' });
      setError(caught instanceof Error ? caught.message : 'Failed to start correlation computation');
    }
  };

  const factor = 2 ** tilePosition.level;
  const gridCount = metadata ? Math.ceil(metadata.comparison_count / factor) : 0;
  const maximumTile = metadata ? Math.max(0, Math.ceil(gridCount / metadata.tile_size) - 1) : 0;
  const moveTile = (rowDelta: number, columnDelta: number) => {
    setTilePosition((current) => ({
      ...current,
      row: Math.max(0, Math.min(maximumTile, current.row + rowDelta)),
      column: Math.max(0, Math.min(maximumTile, current.column + columnDelta)),
    }));
  };
  const changeLevel = (level: number) => {
    if (!metadata) return;
    setTilePosition({ level: Math.max(0, Math.min(metadata.max_level, level)), row: 0, column: 0 });
  };

  const tileTrace = useMemo(() => {
    if (!tile) return null;
    const x = tile.correlations[0]?.map((_, index) => (tile.column_start + index) * tile.factor) || [];
    const y = tile.correlations.map((_, index) => (tile.row_start + index) * tile.factor);
    return {
      type: 'heatmap' as const,
      z: tile.correlations,
      x,
      y,
      customdata: tile.support_counts,
      colorscale: COLORSCALE_CYAN_GREY_CORAL as string[][],
      zmin: -1,
      zmax: 1,
      zmid: 0,
      colorbar: { title: 'Pearson r', thickness: 14 },
      hovertemplate: `Comparison index: %{y}<br>vs %{x}<br>Pearson r: %{z:.3f}<br>${tile.aggregation === 'exact' ? 'Shared proteins' : 'Maximum support in visual bin'}: %{customdata}<extra></extra>`,
    };
  }, [tile]);

  const spearmanOptions = useMemo(() => (
    lookup
      ? [...lookup.nearest, ...lookup.least_correlated]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.comparison_id === item.comparison_id) === index)
        .map((item) => ({ value: item.comparison_id, label: item.comparison_id.replaceAll('_vs_', ' vs ') }))
      : []
  ), [lookup]);

  const computeSpearman = async () => {
    if (!effectivePrimary || !spearmanTarget) return;
    setSpearman(await visualizationApi.getComparisonSpearman(apiPrefix, effectivePrimary, spearmanTarget));
  };

  const progress = status.progress && status.progress.total > 0
    ? Math.round((status.progress.completed / status.progress.total) * 100)
    : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-72 flex-1">
            <label className="mb-1.5 block text-sm font-medium text-text-primary">Reference comparison</label>
            <SearchableSelect
              options={options}
              value={effectivePrimary}
              onChange={setPrimary}
              onSearchChange={onComparisonSearch}
              placeholder="Search comparisons..."
              searchPlaceholder="Search all comparisons..."
            />
          </div>
          <button
            type="button"
            onClick={run}
            disabled={status.status === 'running'}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status.status === 'running' ? 'Computing...' : metadata ? 'Rebuild Full Correlation' : 'Build Full Correlation'}
          </button>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Pearson correlation is computed across every comparison with pairwise-complete protein log2 fold changes. Cells with fewer than 100 shared proteins are suppressed.
        </p>
        {status.status === 'running' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            Resumable block computation{progress == null ? '' : `: ${progress}%`}
          </div>
        )}
        {error && <div className="mt-3 flex items-center gap-2 text-sm text-error"><AlertCircle className="h-4 w-4" />{error}</div>}
      </div>

      {metadata && tileTrace && tile && (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">Tiled Pearson Correlation Overview</h3>
                  <p className="mt-1 text-xs text-text-muted">{metadata.comparison_count.toLocaleString()} comparisons · level {tilePosition.level} · {tile.aggregation}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" title="Previous row tile" onClick={() => moveTile(-1, 0)} className="rounded p-1.5 hover:bg-surface"><ChevronUp className="h-4 w-4" /></button>
                  <button type="button" title="Previous column tile" onClick={() => moveTile(0, -1)} className="rounded p-1.5 hover:bg-surface"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" title="Next column tile" onClick={() => moveTile(0, 1)} className="rounded p-1.5 hover:bg-surface"><ChevronRight className="h-4 w-4" /></button>
                  <button type="button" title="Next row tile" onClick={() => moveTile(1, 0)} className="rounded p-1.5 hover:bg-surface"><ChevronDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => changeLevel(tilePosition.level - 1)} disabled={tilePosition.level === 0} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40">Zoom in</button>
                  <button type="button" onClick={() => changeLevel(tilePosition.level + 1)} disabled={tilePosition.level === metadata.max_level} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40">Overview</button>
                </div>
              </div>
              <div className="h-[520px]">
                <Plot data={[tileTrace]} layout={{ margin: { l: 60, r: 60, t: 20, b: 60 }, xaxis: { title: 'Comparison index' }, yaxis: { title: 'Comparison index', autorange: 'reversed' } }} config={{ displaylogo: false, responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <h3 className="text-sm font-medium text-text-primary">All-comparison Embedding</h3>
              <p className="mt-1 text-xs text-text-muted">Every comparison is rendered with WebGL; use the reference search for exact lookup.</p>
              <div className="h-[520px]">
                <Plot
                  data={[{
                    type: 'scattergl', mode: 'markers',
                    x: metadata.embedding.map((item) => item.x),
                    y: metadata.embedding.map((item) => item.y),
                    text: metadata.embedding.map((item) => item.comparison_id),
                    marker: { size: metadata.embedding.map((item) => item.comparison_id === effectivePrimary ? 10 : 5), color: metadata.embedding.map((item) => item.comparison_id === effectivePrimary ? '#E73564' : '#00ADEF'), opacity: 0.72 },
                    hovertemplate: '%{text}<extra></extra>',
                  }]}
                  layout={{ margin: { l: 50, r: 20, t: 20, b: 50 }, xaxis: { title: 'Correlation component 1' }, yaxis: { title: 'Correlation component 2' } }}
                  config={{ displaylogo: false, responsive: true }} style={{ width: '100%', height: '100%' }} useResizeHandler
                />
              </div>
            </div>
          </div>

          {lookup && (
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-text-primary">Reference Comparison</h3>
                  <p className="mt-1 text-xs text-text-muted">Exact Pearson values and shared-protein support for {formatComparisonKeyWrapped(lookup.comparison_id)}</p>
                </div>
                <div className="flex min-w-80 items-end gap-2">
                  <div className="flex-1"><Select label="On-demand Spearman" options={spearmanOptions} value={spearmanTarget} onChange={(event) => setSpearmanTarget(event.target.value)} /></div>
                  <button type="button" onClick={computeSpearman} disabled={!spearmanTarget} className="mb-0.5 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-surface disabled:opacity-50">Compute</button>
                </div>
              </div>
              {spearman && <p className="mb-3 text-sm text-text-secondary">Spearman: {spearman.correlation == null ? 'Insufficient support' : spearman.correlation.toFixed(3)} ({spearman.support_count.toLocaleString()} shared proteins)</p>}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {[['Nearest', lookup.nearest], ['Least correlated', lookup.least_correlated]].map(([title, items]) => (
                  <div key={title as string}>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title as string}</h4>
                    <div className="space-y-1">
                      {(items as ComparisonCorrelationLookup['nearest']).slice(0, 10).map((item) => (
                        <div key={item.comparison_id} className="flex items-center justify-between gap-3 rounded bg-surface px-3 py-2 text-sm">
                          <span className="truncate text-text-primary">{item.comparison_id.replaceAll('_vs_', ' vs ')}</span>
                          <span className="shrink-0 text-text-secondary">r={item.correlation.toFixed(3)} · n={item.support_count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail && detail.proteins.length > 0 && (
            <ComparisonHeatmap proteins={detail.proteins.map((item) => ({ ...item, gene_name: item.gene_name || '' }))} comparisons={detail.comparisons} foldChanges={detail.fold_changes} />
          )}
        </>
      )}

      {/* Venn Diagram — independent of full correlation build */}
      {comparisons.length >= 2 && (
        <div className="rounded-lg border border-border bg-background p-4 space-y-4">
          <div>
            <h3 className="text-sm font-medium text-text-primary mb-3">Venn Diagram</h3>
            <div className="flex items-center gap-3 flex-wrap">
              {comparisons.slice(0, 10).map((comp) => (
                <label
                  key={comp.value}
                  className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={vennComparisons.includes(comp.value)}
                    onChange={() => toggleVennComparison(comp.value)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-xs">{comp.label}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={handleComputeVenn}
                disabled={vennComparisons.length < 2 || vennLoading || thresholdsLoading}
                className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {vennLoading ? 'Computing...' : 'Compute Venn'}
              </button>
            </div>
            {vennError && (
              <p className="mt-2 text-xs text-error">{vennError}</p>
            )}
          </div>
          <VennDiagram data={vennData} sideBySide />
        </div>
      )}

      {!metadata && status.status !== 'running' && (
        <div className="rounded-lg border border-border bg-background p-10 text-center text-text-muted">
          Build the complete correlation artifact to explore all comparisons.
        </div>
      )}
    </div>
  );
}
