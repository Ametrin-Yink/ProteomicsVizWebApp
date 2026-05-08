'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChartScatter,
  Activity,
  Spline,
  GitCompare,
  ChartNetwork,
  Loader2,
  AlertCircle,
  LoaderCircle,
  Check,
  X,
} from 'lucide-react';
import { ApiProvider, useApi } from '@/lib/api-context';
import { reportApiPrefix, getDataSource, getDEResults, getQCData, getGSEAData, updateVisualizationState, getBioNetSubnetwork, getComparisonCorrelationData, getProteinCorrelationData, computeVennData, runGSEA, getGSEAStatus, runProteinCorrelation, getProteinCorrelationStatus, runComparisonCorrelation, getComparisonCorrelationStatus, runBioNet, getBioNetStatus, listProteins } from '@/lib/api';
import { formatGroup, formatComparisonKeyWrapped, isSignificantVolcano, parseDelimited } from '@/lib/utils';

// Shared visualization components
import VolcanoPlot from '@/components/visualization/VolcanoPlot';
import ProteinInfo from '@/components/visualization/ProteinInfo';
import ProteinTable from '@/components/visualization/ProteinTable';
import { FilterPanel } from '@/components/visualization/FilterPanel';
import QCPlots from '@/components/visualization/QCPlots';
import GSEADashboard from '@/components/visualization/GSEADashboard';
import GSEAPlot from '@/components/visualization/GSEAPlot';
import PathwayTable from '@/components/visualization/PathwayTable';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import SimilarityMatrix from '@/components/visualization/compare/SimilarityMatrix';
import VennDiagram from '@/components/visualization/compare/VennDiagram';
import ComparisonHeatmap from '@/components/visualization/compare/ComparisonHeatmap';
import CorrelationBarChart from '@/components/visualization/compare/CorrelationBarChart';
import ClusterMap from '@/components/visualization/compare/ClusterMap';
import FoldChangeBarChart from '@/components/visualization/compare/FoldChangeBarChart';
import CorrelationScatter from '@/components/visualization/compare/CorrelationScatter';

import type {
  DEResult,
  DEResultsData,
  VolcanoFilters,
  QCData,
  GSEAData,
  GSEADatabase,
  GSEAResult,
  BioNetSubnetwork,
  ComparisonCorrelationData,
  ProteinCorrelationData,
  VennData,
} from '@/types/api';
import {
  GSEADatabaseLabels,
  INDRA_SOURCES,
  INDRA_STATEMENT_TYPES,
} from '@/types/api';
import type {
  GSEARunStatus,
  CompareRunStatus,
  ClusterMethod,
  BioNetRunStatus,
  ProteinListEntry,
  ProteinFCResult,
} from '@/types/api';
import { SearchableSelect, Select } from '@/components/ui/Select';

// ─── Tab definitions ────────────────────────────────────────────────────────

const TABS = [
  { id: 'volcano', label: 'Volcano Plot', icon: ChartScatter },
  { id: 'qc', label: 'QC Plots', icon: Activity },
  { id: 'gsea', label: 'GSEA Analysis', icon: Spline },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'bionet', label: 'BioNet', icon: ChartNetwork },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ─── Database constants ─────────────────────────────────────────────────────

const GSEA_DATABASES: GSEADatabase[] = ['go_bp', 'go_mf', 'go_cc', 'kegg', 'reactome'];

// ─── Tab: Volcano ───────────────────────────────────────────────────────────

function VolcanoTab() {
  const { apiPrefix } = useApi();

  const [data, setData] = useState<DEResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionConfig, setSessionConfig] = useState<{
    treatment?: string; control?: string; experiment: string;
    comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  } | null>(null);
  const [selectedComparison, setSelectedComparison] = useState<string>('');
  const comparisonInitialized = useRef(false);

  const [filters, setFilters] = useState<VolcanoFilters>({
    foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1,
  });

  const [selectedProteins, setSelectedProteins] = useState<Set<string>>(new Set());
  const [selectedProteinData, setSelectedProteinData] = useState<DEResult | null>(null);
  const [markedProteins, setMarkedProteins] = useState<Record<string, Set<string>>>({});

  // Fetch DE results
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const results = await getDEResults(apiPrefix, {
          page: 1, per_page: 20000,
          comparison: selectedComparison || undefined,
        });
        setData(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [apiPrefix, selectedComparison]);

  // Fetch session config
  useEffect(() => {
    async function fetchConfig() {
      try {
        const session = await getDataSource(apiPrefix);
        if (session) {
          const experiment = session.files?.proteomics?.[0]?.experiment ?? '';
          const comparisons = session.config?.comparisons;
          const cfg = {
            treatment: session.config?.treatment ?? '',
            control: session.config?.control ?? '',
            experiment,
            comparisons,
          };
          setSessionConfig(cfg);

          if (!comparisonInitialized.current) {
            if (comparisons && comparisons.length > 0) {
              const first = comparisons[0];
              setSelectedComparison(`${formatGroup(first.group1)}_vs_${formatGroup(first.group2)}`);
            } else if (cfg.treatment && cfg.control) {
              setSelectedComparison('');
            }
            comparisonInitialized.current = true;
          }

          // Restore markers
          if (session.markers && typeof session.markers === 'object' && !Array.isArray(session.markers)) {
            const restored: Record<string, Set<string>> = {};
            for (const [comp, accessions] of Object.entries(session.markers)) {
              restored[comp] = new Set(accessions as string[]);
            }
            setMarkedProteins(restored);
          } else if (Array.isArray(session.markers) && session.markers.length > 0) {
            // Migrate old flat format
            const compKey = selectedComparison || 'default';
            setMarkedProteins({ [compKey]: new Set(session.markers) });
          }

          // Restore filters
          if (session.volcano_filters) {
            setFilters(session.volcano_filters);
          }
        }
      } catch { /* silently fail */ }
    }
    fetchConfig();
  }, [apiPrefix, selectedComparison]);

  const comparisonOptions = useMemo(() => {
    if (!sessionConfig?.comparisons) return [];
    return sessionConfig.comparisons.map((c) => ({
      value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
      label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
    }));
  }, [sessionConfig?.comparisons]);

  const comparisonLabel = useMemo(() => {
    if (selectedComparison) return selectedComparison.replace(/_vs_/g, ' vs ');
    if (sessionConfig?.treatment && sessionConfig?.control) {
      return `${sessionConfig.treatment} vs ${sessionConfig.control}`;
    }
    return undefined;
  }, [selectedComparison, sessionConfig]);

  const deCounts = useMemo(() => {
    if (!data) return { total: 0, up: 0, down: 0 };
    const significant = data.results.filter(
      (r) => isSignificantVolcano(r.log_fc, r.pval, r.adj_pval, filters)
    );
    return {
      total: significant.length,
      up: significant.filter((r) => r.log_fc > 0).length,
      down: significant.filter((r) => r.log_fc < 0).length,
    };
  }, [data, filters]);

  const handleSelectProteins = useCallback((proteins: string[]) => {
    setSelectedProteins(new Set(proteins));
    if (proteins.length > 0 && data) {
      const clickedProtein = proteins[0];
      const protein = data.results.find((r) =>
        r.master_protein_accessions === clickedProtein ||
        parseDelimited(r.master_protein_accessions).includes(clickedProtein) ||
        parseDelimited(clickedProtein).some(p => r.master_protein_accessions.includes(p))
      );
      if (protein) setSelectedProteinData(protein);
    }
  }, [data]);

  const handleSelectProteinFromTable = useCallback((protein: DEResult) => {
    setSelectedProteinData(protein);
    setSelectedProteins(new Set([protein.master_protein_accessions]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedProteins(new Set());
    setSelectedProteinData(null);
  }, []);

  const handleToggleMark = useCallback((protein: DEResult) => {
    const compKey = selectedComparison || comparisonOptions[0]?.value || '';
    if (!compKey) return;
    setMarkedProteins((prev) => {
      const next = { ...prev };
      if (!next[compKey]) next[compKey] = new Set<string>();
      const compSet = new Set(next[compKey]);
      if (compSet.has(protein.master_protein_accessions)) {
        compSet.delete(protein.master_protein_accessions);
      } else {
        compSet.add(protein.master_protein_accessions);
      }
      next[compKey] = compSet;
      return next;
    });
  }, [selectedComparison, comparisonOptions]);

  const handleClearAllMarks = useCallback(() => {
    const compKey = selectedComparison || comparisonOptions[0]?.value || '';
    if (!compKey) return;
    setMarkedProteins((prev) => {
      const next = { ...prev };
      delete next[compKey];
      return next;
    });
  }, [selectedComparison, comparisonOptions]);

  const handleMarkAllSignificant = useCallback(() => {
    if (!data) return;
    const compKey = selectedComparison || comparisonOptions[0]?.value || '';
    if (!compKey) return;
    const significant = data.results
      .filter((r) => isSignificantVolcano(r.log_fc, r.pval, r.adj_pval, filters))
      .map((r) => r.master_protein_accessions);
    setMarkedProteins((prev) => ({
      ...prev,
      [compKey]: new Set(significant),
    }));
  }, [data, selectedComparison, comparisonOptions, filters]);

  // Batch mark: mark significant proteins across multiple comparisons
  const [batchMarkOpen, setBatchMarkOpen] = useState(false);
  const [batchMarkComparisons, setBatchMarkComparisons] = useState<Set<string>>(new Set());
  const [batchMarkLoading, setBatchMarkLoading] = useState(false);
  const batchMarkRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!batchMarkOpen) return;
    const handler = (e: MouseEvent) => {
      if (batchMarkRef.current && !batchMarkRef.current.contains(e.target as Node)) {
        setBatchMarkOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [batchMarkOpen]);

  const toggleBatchComparison = (value: string) => {
    setBatchMarkComparisons((prev) => {
      const next = new Set(prev);
      if (next.has(value)) { next.delete(value); } else { next.add(value); }
      return next;
    });
  };

  const toggleAllBatchComparisons = () => {
    if (batchMarkComparisons.size === comparisonOptions.length) {
      setBatchMarkComparisons(new Set());
    } else {
      setBatchMarkComparisons(new Set(comparisonOptions.map((c) => c.value)));
    }
  };

  const handleBatchMark = async () => {
    if (batchMarkComparisons.size === 0) return;
    setBatchMarkLoading(true);
    setBatchMarkOpen(false);
    try {
      const newMarked = { ...markedProteins };
      for (const comp of batchMarkComparisons) {
        const results = await getDEResults(apiPrefix, {
          comparison: comp,
          per_page: 20000,
        });
        const significant = results.results
          .filter((r) => isSignificantVolcano(r.log_fc, r.pval, r.adj_pval, filters))
          .map((r) => r.master_protein_accessions);
        newMarked[comp] = new Set(significant);
      }
      setMarkedProteins(newMarked);
    } catch { /* silently fail */ }
    finally { setBatchMarkLoading(false); }
  };

  // Save markers debounced
  useEffect(() => {
    const markersObj: Record<string, string[]> = {};
    for (const [comp, set] of Object.entries(markedProteins)) {
      if (set.size > 0) markersObj[comp] = Array.from(set);
    }
    const timer = setTimeout(async () => {
      try { await updateVisualizationState(apiPrefix, { markers: markersObj }); } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [markedProteins, apiPrefix]);

  // Save filters debounced
  useEffect(() => {
    const timer = setTimeout(async () => {
      try { await updateVisualizationState(apiPrefix, { volcano_filters: filters }); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [filters, apiPrefix]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="mt-3 text-text-secondary text-sm">Loading volcano data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-lg p-5">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No differential expression data available</p>
      </div>
    );
  }

  return (
    <div data-testid="report-volcano-container">
      {/* Info Bar */}
      <div className="flex items-center gap-3 mb-6 text-sm bg-background border border-border rounded-lg px-5 py-3 flex-wrap">
        <span className="font-semibold text-text-primary">{sessionConfig?.experiment || 'Report Results'}</span>
        <div className="w-px h-4 bg-border" />
        {comparisonOptions.length > 0 ? (
          <SearchableSelect
            options={comparisonOptions}
            value={selectedComparison}
            onChange={setSelectedComparison}
            placeholder="Select comparison..."
            searchPlaceholder="Filter comparisons..."
            className="min-w-[280px]"
          />
        ) : (
          <span className="text-text-secondary">
            {sessionConfig
              ? `${sessionConfig.experiment}: ${sessionConfig.treatment} vs ${sessionConfig.control}`
              : 'Treatment vs Control'}
          </span>
        )}
        <div className="w-px h-4 bg-border" />
        <span className="text-text-secondary">{data.total_proteins?.toLocaleString() || 0} proteins</span>
        <div className="w-px h-4 bg-border" />
        <span className="text-text-secondary">
          {deCounts.total} DE (
          <span className="text-primary font-semibold">{deCounts.up}↑</span>
          {' '}
          <span className="text-secondary font-semibold">{deCounts.down}↓</span>
          )
        </span>
        <div className="w-px h-4 bg-border" />
        {/* Batch Mark */}
        <div className="relative" ref={batchMarkRef}>
          <button
            onClick={() => setBatchMarkOpen((v) => !v)}
            disabled={batchMarkLoading}
            className="px-3 py-1.5 text-xs font-medium bg-surface hover:bg-border/30 text-text-secondary rounded-lg transition-colors disabled:opacity-50"
          >
            {batchMarkLoading ? 'Marking...' : 'Mark Significant in Batch'}
          </button>
          {batchMarkOpen && (
            <div className="absolute top-full mt-1 left-0 w-72 bg-background border border-border rounded-lg shadow-lg z-50 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={batchMarkComparisons.size === comparisonOptions.length}
                  onChange={toggleAllBatchComparisons}
                  className="rounded border-border"
                />
                Select All
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 border-t border-border pt-2">
                {comparisonOptions.map((comp) => (
                  <label key={comp.value} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                    <input
                      type="checkbox"
                      checked={batchMarkComparisons.has(comp.value)}
                      onChange={() => toggleBatchComparison(comp.value)}
                      className="rounded border-border"
                    />
                    {comp.label}
                  </label>
                ))}
              </div>
              <button
                onClick={handleBatchMark}
                disabled={batchMarkComparisons.size === 0}
                className="w-full px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                Mark {batchMarkComparisons.size > 0 ? `${batchMarkComparisons.size} comparison(s)` : ''}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <VolcanoPlot
            data={data.results}
            filters={filters}
            selectedProteins={selectedProteins}
            markedProteins={markedProteins[selectedComparison || comparisonOptions[0]?.value || ''] ?? new Set()}
            onSelectProteins={handleSelectProteins}
            onClearSelection={clearSelection}
            comparisonLabel={comparisonLabel}
          />

          <FilterPanel
            foldChange={filters.foldChange}
            pValue={filters.pValue}
            adjPValue={filters.adjPValue}
            s0={filters.s0}
            onChange={(newFilters) => setFilters(newFilters)}
            onReset={() => setFilters({ foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 })}
          />

          <ProteinTable
            data={data.results}
            selectedProteins={selectedProteins}
            onSelectProtein={handleSelectProteinFromTable}
            filters={filters}
            sessionConfig={sessionConfig}
            markedProteins={markedProteins[selectedComparison || comparisonOptions[0]?.value || ''] ?? new Set()}
            onToggleMark={handleToggleMark}
            onClearAllMarks={handleClearAllMarks}
            onMarkAllSignificant={handleMarkAllSignificant}
            comparisonLabel={comparisonLabel}
          />
        </div>

        <div className="lg:col-span-1">
          {selectedProteins.size > 1 ? (
            <div className="bg-background rounded-lg border border-border p-6">
              <div className="text-center text-text-secondary py-8">
                <p className="text-lg font-medium">Multiple Proteins Selected</p>
                <p className="text-sm mt-2">{selectedProteins.size} proteins selected.</p>
                <p className="text-sm text-text-muted mt-1">
                  Select a single protein to view detailed information.
                </p>
                <button onClick={clearSelection} className="mt-4 px-4 py-2 bg-surface hover:bg-border/30 text-text-secondary rounded-lg text-sm font-medium transition-colors">
                  Clear Selection
                </button>
              </div>
            </div>
          ) : (
            <ProteinInfo
              protein={selectedProteins.size === 1 ? selectedProteinData : null}
              filters={filters}
              comparison={selectedComparison || undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: QC ────────────────────────────────────────────────────────────────

function QCTab() {
  const { apiPrefix } = useApi();
  const [data, setData] = useState<QCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState('');
  const [comparisonOptions, setComparisonOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [qcData, session] = await Promise.all([
          getQCData(apiPrefix),
          getDataSource(apiPrefix).catch(() => null),
        ]);
        setData(qcData);

        if (session?.config?.comparisons) {
          const opts = session.config.comparisons.map((c) => ({
            value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
            label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
          }));
          setComparisonOptions(opts);
          if (opts.length > 0 && !selectedComparison) {
            setSelectedComparison(opts[0].value);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load QC data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [apiPrefix, selectedComparison]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-lg p-5">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No QC data available</p>
      </div>
    );
  }

  return (
    <QCPlots
      data={data}
      selectedComparison={selectedComparison}
      onComparisonChange={setSelectedComparison}
      comparisonOptions={comparisonOptions}
    />
  );
}

// ─── Tab: GSEA ──────────────────────────────────────────────────────────────

function GSEATab() {
  const { apiPrefix } = useApi();
  const [selectedDatabase, setSelectedDatabase] = useState<GSEADatabase>('go_bp');
  const [data, setData] = useState<GSEAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState('');
  const [comparisonOptions, setComparisonOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedPathway, setSelectedPathway] = useState<GSEAResult | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('nes');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [significantOnly, setSignificantOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [totalResults, setTotalResults] = useState(0);
  const pageSize = 50;

  // On-demand run state
  const [runDatabases, setRunDatabases] = useState<GSEADatabase[]>(['go_bp', 'kegg', 'reactome']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [runParams, setRunParams] = useState({ min_size: 15, max_size: 500, permutations: 1000 });
  const [runError, setRunError] = useState<string | null>(null);
  const [gseaRunStatus, setGseaRunStatus] = useState<GSEARunStatus | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<GSEARunStatus | null>(null);
  const isRunning = gseaRunStatus?.status === 'running';

  // Debounce search
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [search]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setSelectedPathway(null);
      try {
        const gseaData = await getGSEAData(apiPrefix, selectedDatabase, {
          page, per_page: pageSize,
          sort_by: sortBy, sort_order: sortOrder,
          significant_only: significantOnly,
          search: debouncedSearch,
          comparison: selectedComparison || undefined,
        });
        if (!cancelled) {
          setData(gseaData);
          setTotalResults(gseaData.total || 0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load GSEA data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [apiPrefix, selectedDatabase, page, sortBy, sortOrder, significantOnly, debouncedSearch, selectedComparison]);

  // Fetch comparisons
  useEffect(() => {
    getDataSource(apiPrefix).then(session => {
      if (session?.config?.comparisons) {
        const opts = session.config.comparisons.map((c) => ({
          value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
          label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
        }));
        setComparisonOptions(opts);
        if (opts.length > 0 && !selectedComparison) {
          setSelectedComparison(opts[0].value);
        }
      }
    }).catch(() => {});
  }, [apiPrefix, selectedComparison]);

  // Poll GSEA run status
  const fetchParamsRef = useRef({ selectedDatabase, pageSize, sortBy, sortOrder, significantOnly, debouncedSearch, selectedComparison });
  fetchParamsRef.current = { selectedDatabase, pageSize, sortBy, sortOrder, significantOnly, debouncedSearch, selectedComparison };

  const pollStatus = useCallback(async () => {
    try {
      const status = await getGSEAStatus(apiPrefix);
      if (lastStatusRef.current?.status === status.status) {
        const prev = lastStatusRef.current.databases || {};
        const next = status.databases || {};
        const changed = Object.keys(next).some((k) => prev[k] !== next[k]);
        if (!changed) return;
      }
      lastStatusRef.current = status;
      setGseaRunStatus(status);
      if (status.status === 'completed' || status.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (status.status === 'error') {
          setRunError(status.error || 'GSEA run failed');
        }
        if (status.status === 'completed') {
          const p = fetchParamsRef.current;
          const gseaData = await getGSEAData(apiPrefix, p.selectedDatabase, {
            page: 1, per_page: p.pageSize, sort_by: p.sortBy, sort_order: p.sortOrder,
            significant_only: p.significantOnly, search: p.debouncedSearch,
            comparison: p.selectedComparison || undefined,
          });
          setData(gseaData);
          setTotalResults(gseaData.total || 0);
        }
      }
    } catch { /* silently ignore polling errors */ }
  }, [apiPrefix]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Check GSEA status on mount
  useEffect(() => {
    let cancelled = false;
    getGSEAStatus(apiPrefix).then(async (status) => {
      if (cancelled) return;
      lastStatusRef.current = status;
      setGseaRunStatus(status);
      if (status.status === 'running') {
        startPolling();
      } else if (status.status === 'completed') {
        const p = fetchParamsRef.current;
        const gseaData = await getGSEAData(apiPrefix, p.selectedDatabase, {
          page: 1, per_page: p.pageSize, sort_by: p.sortBy, sort_order: p.sortOrder,
          significant_only: p.significantOnly, search: p.debouncedSearch,
          comparison: p.selectedComparison || undefined,
        });
        if (!cancelled) {
          setData(gseaData);
          setTotalResults(gseaData.total || 0);
        }
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const handleRunGSEA = async () => {
    if (!selectedComparison || runDatabases.length === 0) return;
    setRunError(null);
    try {
      await runGSEA(apiPrefix, {
        comparison: selectedComparison,
        databases: runDatabases,
        min_size: runParams.min_size,
        max_size: runParams.max_size,
        permutations: runParams.permutations,
      });
      startPolling();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'GSEA run failed');
    }
  };

  return (
    <div>
      {/* Comparison Selector */}
      {comparisonOptions.length > 0 && (
        <div className="bg-background rounded-lg border border-border p-4 mb-4">
          <label className="block text-sm font-medium text-text-primary mb-3">Select Comparison</label>
          <SearchableSelect
            options={comparisonOptions}
            value={selectedComparison}
            onChange={setSelectedComparison}
            placeholder="Select comparison..."
            searchPlaceholder="Filter comparisons..."
          />
        </div>
      )}

      {/* Run GSEA Section */}
      {selectedComparison && (
        <div className="bg-background rounded-lg border border-border p-4 mb-4">
          {isRunning ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-text-primary">
                  GSEA in progress: {gseaRunStatus.comparison?.replace(/_vs_/g, ' vs ')}
                </span>
                <span className="text-xs text-text-muted">
                  You can navigate away and return
                </span>
              </div>
              <div className="space-y-1.5">
                {Object.entries(gseaRunStatus.databases || {}).map(([db, dbStatus]) => (
                  <div key={db} className="flex items-center gap-2 text-sm">
                    {dbStatus === 'completed' ? (
                      <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : dbStatus === 'error' ? (
                      <X className="w-4 h-4 text-error flex-shrink-0" />
                    ) : (
                      <LoaderCircle className="w-4 h-4 animate-spin text-primary flex-shrink-0" />
                    )}
                    <span className={dbStatus === 'completed' ? 'text-green-600' : dbStatus === 'error' ? 'text-error' : 'text-text-secondary'}>
                      {GSEADatabaseLabels[db as GSEADatabase] || db}
                    </span>
                    <span className="text-text-muted text-xs">
                      {dbStatus === 'completed' ? 'Done' : dbStatus === 'running' ? 'Running' : dbStatus === 'error' ? 'Failed' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-text-primary">
                  Run GSEA for: {selectedComparison.replace(/_vs_/g, ' vs ')}
                </span>
                <button onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-text-muted hover:text-text-secondary">
                  {showAdvanced ? 'Hide' : 'Show'} Advanced
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {GSEA_DATABASES.map((db) => (
                  <label key={db} className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer">
                    <input type="checkbox" checked={runDatabases.includes(db)}
                      onChange={(e) => {
                        if (e.target.checked) setRunDatabases(prev => [...prev, db]);
                        else setRunDatabases(prev => prev.filter(d => d !== db));
                      }}
                      className="rounded border-border text-primary focus:ring-primary" />
                    {GSEADatabaseLabels[db]}
                  </label>
                ))}
              </div>
              {showAdvanced && (
                <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-surface rounded-lg">
                  <div><label className="block text-xs text-text-muted mb-1">Min Size</label>
                    <input type="number" value={runParams.min_size}
                      onChange={(e) => setRunParams(prev => ({ ...prev, min_size: parseInt(e.target.value) || 15 }))}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md" /></div>
                  <div><label className="block text-xs text-text-muted mb-1">Max Size</label>
                    <input type="number" value={runParams.max_size}
                      onChange={(e) => setRunParams(prev => ({ ...prev, max_size: parseInt(e.target.value) || 500 }))}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md" /></div>
                  <div><label className="block text-xs text-text-muted mb-1">Permutations</label>
                    <input type="number" value={runParams.permutations}
                      onChange={(e) => setRunParams(prev => ({ ...prev, permutations: parseInt(e.target.value) || 1000 }))}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md" /></div>
                </div>
              )}
              <button onClick={handleRunGSEA} disabled={isRunning || runDatabases.length === 0}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity">
                {isRunning ? 'Starting...' : 'Run GSEA'}
              </button>
              {runError && <p className="mt-2 text-sm text-error">{runError}</p>}
            </>
          )}
        </div>
      )}

      {/* Database Selector */}
      <div className="bg-background rounded-lg border border-border p-4 mb-6">
        <label className="block text-sm font-medium text-text-primary mb-3">Select Database</label>
        <div className="flex flex-wrap gap-2">
          {GSEA_DATABASES.map((db) => (
            <button
              key={db}
              onClick={() => setSelectedDatabase(db)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedDatabase === db
                  ? 'bg-primary text-white'
                  : 'bg-surface text-text-secondary hover:bg-border/30'
              }`}
            >
              {GSEADatabaseLabels[db]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        </div>
      )}

      {error && (
        <div className="bg-error/5 border border-error/20 rounded-lg p-5">
          <p className="text-error">{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-6">
          <GSEADashboard
            data={data}
            selectedPathway={selectedPathway}
            onSelectPathway={setSelectedPathway}
          />

          {selectedPathway && (
            <GSEAPlot
              pathway={selectedPathway}
              database={selectedDatabase}
              comparison={selectedComparison || undefined}
              onPathwayUpdated={setSelectedPathway}
            />
          )}

          <PathwayTable
            data={data.results ?? []}
            selectedPathway={selectedPathway}
            onSelectPathway={setSelectedPathway}
            totalResults={totalResults}
            currentPage={page}
            pageSize={pageSize}
            onPageChange={setPage}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={(key, order) => { setSortBy(key); setSortOrder(order); setPage(1); }}
            significantOnly={significantOnly}
            onSignificantOnlyChange={(val) => { setSignificantOnly(val); setPage(1); }}
            search={search}
            onSearchChange={(val) => { setSearch(val); setPage(1); }}
          />
        </div>
      )}

      {!loading && !error && !data && !isRunning && (
        <div className="text-center py-16 text-text-secondary">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No GSEA data available. Run GSEA analysis first.</p>
        </div>
      )}

      {!loading && !error && !data && isRunning && (
        <div className="bg-background border border-border rounded-lg p-4 flex items-center gap-3">
          <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-text-primary">GSEA computation in progress...</span>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Compare ───────────────────────────────────────────────────────────

function CompareTab() {
  const { apiPrefix } = useApi();
  const [comparisonData, setComparisonData] = useState<ComparisonCorrelationData | null>(null);
  const [proteinData, setProteinData] = useState<ProteinCorrelationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'comparison' | 'protein' | 'venn'>('comparison');
  const [comparisons, setComparisons] = useState<Array<{ value: string; label: string }>>([]);
  const [vennData, setVennData] = useState<VennData | null>(null);
  const [vennLoading, setVennLoading] = useState(false);
  const [vennError, setVennError] = useState<string | null>(null);

  // Protein correlation state
  const [proteins, setProteins] = useState<ProteinListEntry[]>([]);
  const [selectedProtein, setSelectedProtein] = useState<string>('');
  const [proteinClusterMethod, setProteinClusterMethod] = useState<ClusterMethod>('pca');
  const [proteinColorComparison, setProteinColorComparison] = useState<string>('');
  const [proteinStatus, setProteinStatus] = useState<CompareRunStatus>({ status: 'idle' });
  const [proteinRunError, setProteinRunError] = useState<string | null>(null);
  const proteinPollRef = useRef<NodeJS.Timeout | null>(null);
  const isProteinRunning = proteinStatus.status === 'running';
  const effectiveColorComparison = proteinColorComparison || comparisons[0]?.value || '';
  const [selectedSimilar, setSelectedSimilar] = useState<{
    accession: string; gene_name: string; similarity: number; fc: ProteinFCResult[];
  } | null>(null);

  // Comparison correlation state
  const [primaryComparison, setPrimaryComparison] = useState<string>('');
  const effectivePrimary = primaryComparison || comparisons[0]?.value || '';
  const [selectedComparisons, setSelectedComparisons] = useState<string[]>([]);
  const [compClusterMethod, setCompClusterMethod] = useState<ClusterMethod>('pca');
  const [compStatus, setCompStatus] = useState<CompareRunStatus>({ status: 'idle' });
  const [compRunError, setCompRunError] = useState<string | null>(null);
  const compPollRef = useRef<NodeJS.Timeout | null>(null);
  const isCompRunning = compStatus.status === 'running';
  const comparisonsInitialized = useRef(false);

  // Fetch compare data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const session = await getDataSource(apiPrefix).catch(() => null);
        if (session?.config?.comparisons) {
          const opts = session.config.comparisons.map((c) => ({
            value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
            label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
          }));
          setComparisons(opts);
        }

        // Try to fetch existing correlation data
        const [compData, protData] = await Promise.all([
          getComparisonCorrelationData(apiPrefix).catch(() => null),
          getProteinCorrelationData(apiPrefix).catch(() => null),
        ]);
        if (compData) setComparisonData(compData);
        if (protData) setProteinData(protData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load comparison data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [apiPrefix]);

  // Load proteins for selector
  useEffect(() => {
    listProteins(apiPrefix).then(setProteins).catch(() => {});
  }, [apiPrefix]);

  // Auto-select comparisons on init
  useEffect(() => {
    if (!comparisonsInitialized.current && comparisons.length > 0) {
      setSelectedComparisons(comparisons.slice(0, 9).map((c) => c.value));
      comparisonsInitialized.current = true;
    }
  }, [comparisons]);

  // Protein correlation polling
  const pollProteinStatus = useCallback(async () => {
    try {
      const newStatus = await getProteinCorrelationStatus(apiPrefix);
      setProteinStatus(newStatus);
      if (newStatus.status === 'completed') {
        if (proteinPollRef.current) { clearInterval(proteinPollRef.current); proteinPollRef.current = null; }
        const result = await getProteinCorrelationData(apiPrefix);
        setProteinData(result);
        setSelectedSimilar(null);
      } else if (newStatus.status === 'error') {
        if (proteinPollRef.current) { clearInterval(proteinPollRef.current); proteinPollRef.current = null; }
        setProteinRunError(newStatus.error || 'Protein correlation analysis failed');
      }
    } catch { /* silently ignore */ }
  }, [apiPrefix]);

  const startProteinPolling = useCallback(() => {
    if (proteinPollRef.current) return;
    pollProteinStatus();
    proteinPollRef.current = setInterval(pollProteinStatus, 2000);
  }, [pollProteinStatus]);

  // Comparison correlation polling
  const pollCompStatus = useCallback(async () => {
    try {
      const newStatus = await getComparisonCorrelationStatus(apiPrefix);
      setCompStatus(newStatus);
      if (newStatus.status === 'completed') {
        if (compPollRef.current) { clearInterval(compPollRef.current); compPollRef.current = null; }
        const result = await getComparisonCorrelationData(apiPrefix);
        setComparisonData(result);
      } else if (newStatus.status === 'error') {
        if (compPollRef.current) { clearInterval(compPollRef.current); compPollRef.current = null; }
        setCompRunError(newStatus.error || 'Comparison correlation analysis failed');
      }
    } catch { /* silently ignore */ }
  }, [apiPrefix]);

  const startCompPolling = useCallback(() => {
    if (compPollRef.current) return;
    pollCompStatus();
    compPollRef.current = setInterval(pollCompStatus, 2000);
  }, [pollCompStatus]);

  // Check status on mount
  useEffect(() => {
    getProteinCorrelationStatus(apiPrefix).then((s) => {
      setProteinStatus(s);
      if (s.status === 'running') startProteinPolling();
    }).catch(() => {});
    getComparisonCorrelationStatus(apiPrefix).then((s) => {
      setCompStatus(s);
      if (s.status === 'running') startCompPolling();
    }).catch(() => {});
  }, [apiPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (proteinPollRef.current) clearInterval(proteinPollRef.current);
      if (compPollRef.current) clearInterval(compPollRef.current);
    };
  }, []);

  // Protein correlation handlers
  const handleRunProteinCorrelation = async () => {
    if (!selectedProtein || !effectiveColorComparison) return;
    setProteinRunError(null);
    setSelectedSimilar(null);
    try {
      setProteinStatus({ status: 'running' });
      await runProteinCorrelation(apiPrefix, {
        protein_id: selectedProtein,
        cluster_method: proteinClusterMethod,
        color_comparison: effectiveColorComparison,
      });
      startProteinPolling();
    } catch (err) {
      setProteinStatus({ status: 'error' });
      setProteinRunError(err instanceof Error ? err.message : 'Failed to start protein correlation');
    }
  };

  // Comparison correlation handlers
  const handleRunComparisonCorrelation = async () => {
    if (!effectivePrimary || selectedComparisons.length === 0) return;
    setCompRunError(null);
    try {
      setCompStatus({ status: 'running' });
      const markersForApi: Record<string, string[]> = {};
      for (const [comp, setVal] of Object.entries(markedProteins)) {
        markersForApi[comp] = Array.from(setVal);
      }
      await runComparisonCorrelation(apiPrefix, {
        primary_comparison: effectivePrimary,
        selected_comparisons: selectedComparisons,
        marked_proteins: markersForApi,
        cluster_method: compClusterMethod,
      });
      startCompPolling();
    } catch (err) {
      setCompStatus({ status: 'error' });
      setCompRunError(err instanceof Error ? err.message : 'Failed to start comparison correlation');
    }
  };

  // Venn computation
  const [vennSelectedComparisons, setVennSelectedComparisons] = useState<string[]>([]);
  const handleComputeVenn = useCallback(async () => {
    if (vennSelectedComparisons.length < 2) return;
    setVennLoading(true);
    setVennError(null);
    try {
      const result = await computeVennData(apiPrefix, {
        comparisons: vennSelectedComparisons,
        pvalue_threshold: 0.05,
        logfc_threshold: 1,
      });
      setVennData(result);
    } catch (err) {
      setVennError(err instanceof Error ? err.message : 'Venn computation failed');
    } finally {
      setVennLoading(false);
    }
  }, [apiPrefix, vennSelectedComparisons]);

  // Similar protein click handler
  const handleSimilarClick = useCallback((label: string) => {
    if (!proteinData) return;
    const similar = proteinData.similar_proteins.find(
      (c) => c.gene_name === label || c.accession === label
    );
    if (!similar) return;
    const fcData = similar.fold_changes?.filter((f) => f.log_fc != null) ?? proteinData.selected_protein_fc;
    setSelectedSimilar({
      accession: similar.accession,
      gene_name: similar.gene_name,
      similarity: similar.similarity,
      fc: fcData as ProteinFCResult[],
    });
  }, [proteinData]);

  // Protein options for selector
  const proteinOptions = useMemo(() => {
    return proteins.map((p) => ({
      value: p.accession,
      label: p.gene_name ? `${p.gene_name} (${p.accession})` : p.accession,
    }));
  }, [proteins]);

  const selectedProteinName = useMemo(() => {
    const p = proteins.find((p) => p.accession === selectedProtein);
    return p?.gene_name || selectedProtein;
  }, [proteins, selectedProtein]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-lg p-5">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Sub-tab selector */}
      <div className="flex items-center gap-1 mb-6 bg-background border border-border rounded-lg p-1 w-fit">
        {(['comparison', 'protein', 'venn'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              activeSubTab === tab
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab === 'comparison' ? 'Comparison Correlation' : tab === 'protein' ? 'Protein Correlation' : 'Venn Diagram'}
          </button>
        ))}
      </div>

      {/* ── Protein Correlation Tab ── */}
      {activeSubTab === 'protein' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-background border border-border rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Protein</label>
                <SearchableSelect
                  options={proteinOptions}
                  value={selectedProtein}
                  onChange={setSelectedProtein}
                  placeholder="Select protein..."
                  searchPlaceholder="Search proteins..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Cluster Method</label>
                <Select
                  options={[
                    { value: 'pca', label: 'PCA' },
                    { value: 'umap', label: 'UMAP' },
                    { value: 'tsne', label: 'tSNE' },
                  ]}
                  value={proteinClusterMethod}
                  onChange={(e) => setProteinClusterMethod(e.target.value as ClusterMethod)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Cluster Color By</label>
                <Select
                  options={comparisons}
                  value={effectiveColorComparison}
                  onChange={(e) => setProteinColorComparison(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleRunProteinCorrelation}
                  disabled={isProteinRunning || !selectedProtein || !effectiveColorComparison}
                  className="w-full px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  {isProteinRunning ? 'Running...' : 'Run Analysis'}
                </button>
              </div>
            </div>
            {proteinRunError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{proteinRunError}</span>
              </div>
            )}
          </div>

          {/* Running indicator */}
          {isProteinRunning && (
            <div className="bg-background border border-border rounded-lg p-4 flex items-center gap-3">
              <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-text-primary">Computing protein correlations...</span>
            </div>
          )}

          {/* Results */}
          {proteinData && !isProteinRunning && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FoldChangeBarChart
                  data={proteinData.selected_protein_fc}
                  proteinName={selectedProteinName}
                />
                <ClusterMap
                  mode="protein"
                  points={proteinData.cluster_coords}
                  selectedKey={selectedProtein}
                  colorBy={proteinData.color_fc_map}
                  varExplained={proteinData.cluster_var_explained}
                  title={`${proteinClusterMethod.toUpperCase()} — Proteins`}
                />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3">
                  <CorrelationBarChart
                    data={proteinData.similar_proteins.map((c) => ({
                      label: c.gene_name || c.accession,
                      correlation: c.similarity,
                    }))}
                    title="Most / Least Similar Proteins (RMSD)"
                    topN={10}
                    ascending
                    onItemClick={handleSimilarClick}
                  />
                </div>
                <div className="lg:col-span-1">
                  {selectedSimilar ? (
                    <CorrelationScatter
                      selectedProtein={proteinData.selected_protein_fc}
                      correlatedProtein={selectedSimilar.fc}
                      correlation={selectedSimilar.similarity}
                      selectedName={selectedProteinName}
                      correlatedName={selectedSimilar.gene_name || selectedSimilar.accession}
                    />
                  ) : (
                    <div className="bg-background border border-border rounded-lg p-4 flex items-center justify-center min-h-[350px]">
                      <p className="text-text-muted text-sm text-center">
                        Click a protein in the bar chart to view pairwise scatter
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!proteinData && !isProteinRunning && (
            <div className="bg-background border border-border rounded-lg p-12 text-center">
              <p className="text-text-muted">Select a protein and configure options above, then click Run Analysis</p>
            </div>
          )}
        </div>
      )}

      {/* ── Comparison Correlation Tab ── */}
      {activeSubTab === 'comparison' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="bg-background border border-border rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Primary Comparison</label>
                <SearchableSelect
                  options={comparisons}
                  value={effectivePrimary}
                  onChange={setPrimaryComparison}
                  placeholder="Select primary..."
                  searchPlaceholder="Filter comparisons..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-primary mb-1.5">Additional Comparisons (up to 9)</label>
                <div className="max-h-32 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {comparisons.map((comp) => (
                    <label key={comp.value} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary">
                      <input
                        type="checkbox"
                        checked={selectedComparisons.includes(comp.value)}
                        disabled={!selectedComparisons.includes(comp.value) && selectedComparisons.length >= 9}
                        onChange={() => {
                          if (selectedComparisons.includes(comp.value)) {
                            setSelectedComparisons((prev) => prev.filter((v) => v !== comp.value));
                          } else if (selectedComparisons.length < 9) {
                            setSelectedComparisons((prev) => [...prev, comp.value]);
                          }
                        }}
                        className="rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="truncate">{comp.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1.5">Cluster Method</label>
                <Select
                  options={[
                    { value: 'pca', label: 'PCA' },
                    { value: 'umap', label: 'UMAP' },
                    { value: 'tsne', label: 'tSNE' },
                  ]}
                  value={compClusterMethod}
                  onChange={(e) => setCompClusterMethod(e.target.value as ClusterMethod)}
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={handleRunComparisonCorrelation}
                disabled={isCompRunning || !effectivePrimary || selectedComparisons.length === 0}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {isCompRunning ? 'Running...' : 'Run Analysis'}
              </button>
            </div>
            {compRunError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-error">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{compRunError}</span>
              </div>
            )}
          </div>

          {/* Running indicator */}
          {isCompRunning && (
            <div className="bg-background border border-border rounded-lg p-4 flex items-center gap-3">
              <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-text-primary">Computing comparison correlations...</span>
            </div>
          )}

          {/* Results */}
          {comparisonData && !isCompRunning && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                  <SimilarityMatrix
                    comparisons={comparisonData.similarity_matrix.comparisons}
                    matrix={comparisonData.similarity_matrix.matrix}
                  />
                </div>
                <div className="lg:col-span-2">
                  <CorrelationBarChart
                    data={comparisonData.comparison_similarities.map((c) => ({
                      label: formatComparisonKeyWrapped(c.comparison),
                      correlation: c.similarity,
                    }))}
                    title="Most / Least Similar Comparisons (RMSD)"
                    topN={10}
                    ascending
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ClusterMap
                  mode="comparison"
                  points={comparisonData.cluster_coords}
                  selectedKey={effectivePrimary}
                  title={`${compClusterMethod.toUpperCase()} — Comparisons`}
                  varExplained={comparisonData.cluster_var_explained}
                />
                <div>
                  {comparisonData.heatmap_data?.proteins?.length > 0 ? (
                    <ComparisonHeatmap
                      proteins={comparisonData.heatmap_data.proteins}
                      comparisons={comparisonData.heatmap_data.comparisons}
                      foldChanges={comparisonData.heatmap_data.fold_changes}
                    />
                  ) : (
                    <div className="bg-background border border-border rounded-lg p-6 text-center text-text-muted">
                      No heatmap data available
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!comparisonData && !isCompRunning && (
            <div className="bg-background border border-border rounded-lg p-12 text-center">
              <p className="text-text-muted">Select a primary comparison and additional comparisons, then click Run Analysis</p>
            </div>
          )}
        </div>
      )}

      {/* ── Venn Diagram Tab ── */}
      {activeSubTab === 'venn' && (
        <div className="space-y-6">
          <div className="bg-background rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold mb-2">Venn Diagram</h3>
            <p className="text-sm text-text-muted mb-4">
              Compare DE proteins across different comparisons
            </p>
            {comparisons.length > 0 && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-text-primary">Select comparisons (min 2):</label>
                <div className="flex flex-wrap gap-2">
                  {comparisons.map((comp) => {
                    const selected = vennSelectedComparisons.includes(comp.value);
                    return (
                      <button
                        key={comp.value}
                        onClick={() => {
                          setVennSelectedComparisons((prev) =>
                            selected ? prev.filter((v) => v !== comp.value) : [...prev, comp.value]
                          );
                        }}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          selected
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-surface text-text-secondary border border-border hover:bg-border/30'
                        }`}
                      >
                        {comp.label}
                      </button>
                    );
                  })}
                </div>
                {vennSelectedComparisons.length >= 2 && (
                  <button
                    onClick={handleComputeVenn}
                    disabled={vennLoading}
                    className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {vennLoading ? 'Computing...' : 'Compute Venn Diagram'}
                  </button>
                )}
              </div>
            )}
          </div>

          {vennLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}

          {vennError && (
            <div className="bg-error/5 border border-error/20 rounded-lg p-4">
              <p className="text-sm text-error">{vennError}</p>
            </div>
          )}

          {vennData && !vennLoading && (
            <div className="bg-background rounded-lg border border-border p-4">
              <VennDiagram data={vennData} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: BioNet ────────────────────────────────────────────────────────────

function BioNetTab() {
  const { apiPrefix } = useApi();
  const [subnetwork, setSubnetwork] = useState<BioNetSubnetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config state
  const [selectedComparison, setSelectedComparison] = useState('');
  const [comparisons, setComparisons] = useState<Array<{ group1: Record<string, string>; group2: Record<string, string> }>>([]);
  const [adjPvalueCutoff, setAdjPvalueCutoff] = useState(0.05);
  const [logfcCutoff, setLogfcCutoff] = useState(0.5);
  const [statementTypes, setStatementTypes] = useState<string[]>([...INDRA_STATEMENT_TYPES]);
  const [allStatementTypesSelected, setAllStatementTypesSelected] = useState(true);
  const [paperCountCutoff, setPaperCountCutoff] = useState(1);
  const [evidenceCountCutoff, setEvidenceCountCutoff] = useState(1);
  const [sourcesFilter, setSourcesFilter] = useState<string[]>([...INDRA_SOURCES]);
  const [allSourcesSelected, setAllSourcesSelected] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [keyTargetsInput, setKeyTargetsInput] = useState('');
  const [sessionMarkers, setSessionMarkers] = useState<Record<string, string[]>>({});

  const keyTargets = useMemo(
    () => keyTargetsInput.split(',').map((s) => s.trim()).filter(Boolean),
    [keyTargetsInput]
  );

  // Run state
  const [runStatus, setRunStatus] = useState<BioNetRunStatus | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<BioNetRunStatus | null>(null);
  const isRunning = runStatus?.status === 'running';

  const DEFAULT_STATEMENT_TYPES = [...INDRA_STATEMENT_TYPES];
  const DEFAULT_SOURCES = [...INDRA_SOURCES];

  // Fetch session config
  useEffect(() => {
    getDataSource(apiPrefix).then((session) => {
      if (session?.config?.comparisons) {
        setComparisons(session.config.comparisons);
        const comps = session.config.comparisons;
        if (comps.length > 0) {
          const first = comps[0];
          setSelectedComparison(formatGroup(first.group1) + '_vs_' + formatGroup(first.group2));
        }
      }
      if (session?.markers && typeof session.markers === 'object' && !Array.isArray(session.markers)) {
        setSessionMarkers(session.markers as Record<string, string[]>);
      }
    }).catch(() => {});
  }, [apiPrefix]);

  // Fetch existing BioNet data
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const data = await getBioNetSubnetwork(apiPrefix);
        if (!cancelled) setSubnetwork(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load BioNet data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [apiPrefix]);

  // Polling
  const pollStatus = useCallback(async () => {
    try {
      const status = await getBioNetStatus(apiPrefix);
      if (lastStatusRef.current?.status === status.status && lastStatusRef.current?.node_count === status.node_count) {
        return;
      }
      lastStatusRef.current = status;
      setRunStatus(status);
      if (status.status === 'completed' || status.status === 'error') {
        if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
        if (status.status === 'error') {
          setRunError(status.error || 'BioNet analysis failed');
        }
        if (status.status === 'completed') {
          const data = await getBioNetSubnetwork(apiPrefix);
          setSubnetwork(data);
        }
      }
    } catch { /* silently ignore */ }
  }, [apiPrefix]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Check status on mount
  useEffect(() => {
    let cancelled = false;
    getBioNetStatus(apiPrefix).then(async (status) => {
      if (cancelled) return;
      lastStatusRef.current = status;
      setRunStatus(status);
      if (status.status === 'running') {
        startPolling();
      } else if (status.status === 'completed') {
        const data = await getBioNetSubnetwork(apiPrefix);
        if (!cancelled) setSubnetwork(data);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    };
  }, []);

  // Run BioNet
  const handleRunBioNet = async () => {
    if (!selectedComparison) return;
    setRunError(null);
    try {
      await runBioNet(apiPrefix, {
        comparison: selectedComparison,
        pvalue_cutoff: adjPvalueCutoff,
        logfc_cutoff: logfcCutoff,
        statement_types: allStatementTypesSelected ? DEFAULT_STATEMENT_TYPES : statementTypes,
        paper_count_cutoff: paperCountCutoff,
        evidence_count_cutoff: evidenceCountCutoff,
        correlation_cutoff: null,
        sources_filter: allSourcesSelected ? null : sourcesFilter,
      });
      startPolling();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'BioNet run failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  if (error && !subnetwork && !isRunning) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No BioNet data available in this report.</p>
        <p className="text-sm mt-2 text-text-muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Comparison Selector */}
      {comparisons.length > 0 && (
        <div className="bg-background rounded-lg border border-border p-4">
          <label className="block text-sm font-medium text-text-primary mb-3">Select Comparison</label>
          <SearchableSelect
            options={comparisons.map((c) => {
              const g1 = formatGroup(c.group1);
              const g2 = formatGroup(c.group2);
              return { value: `${g1}_vs_${g2}`, label: `${g1} vs ${g2}` };
            })}
            value={selectedComparison}
            onChange={setSelectedComparison}
            placeholder="Select comparison..."
            searchPlaceholder="Filter comparisons..."
          />
        </div>
      )}

      {/* Config Card */}
      {selectedComparison && (
        <div className="bg-background rounded-lg border border-border p-4">
          {isRunning ? (
            <div className="flex items-center gap-3">
              <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium text-text-primary">
                BioNet analysis in progress: {runStatus?.comparison?.replace(/_vs_/g, ' vs ')}
              </span>
              <span className="text-xs text-text-muted">Querying INDRA database...</span>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-medium text-text-primary mb-4">
                Parameters &mdash; {selectedComparison.replace(/_vs_/g, ' vs ')}
              </h3>

              {/* Basic params */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Adjusted p-value cutoff</label>
                  <input type="number" step="0.01" min="0" max="1" value={adjPvalueCutoff}
                    onChange={(e) => setAdjPvalueCutoff(parseFloat(e.target.value) || 0.05)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">|Log2FC| cutoff</label>
                  <input type="number" step="0.1" min="0" value={logfcCutoff}
                    onChange={(e) => setLogfcCutoff(parseFloat(e.target.value) || 0.5)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Paper count &ge;</label>
                  <input type="number" step="1" min="1" value={paperCountCutoff}
                    onChange={(e) => setPaperCountCutoff(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Evidence count &ge;</label>
                  <input type="number" step="1" min="1" value={evidenceCountCutoff}
                    onChange={(e) => setEvidenceCountCutoff(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary" />
                </div>
              </div>

              {/* Statement types */}
              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1">Interaction Types</label>
                <div className="p-3 bg-surface rounded border border-border">
                  <label className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                    <input type="checkbox" checked={allStatementTypesSelected}
                      onChange={() => {
                        setAllStatementTypesSelected(!allStatementTypesSelected);
                        if (!allStatementTypesSelected) setStatementTypes(DEFAULT_STATEMENT_TYPES);
                      }}
                      className="rounded" />
                    All interaction types (INDRA)
                  </label>
                  {!allStatementTypesSelected && (
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
                      {INDRA_STATEMENT_TYPES.map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-xs text-text-primary">
                          <input type="checkbox" checked={statementTypes.includes(t)}
                            onChange={() => setStatementTypes((prev) =>
                              prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                            )}
                            className="rounded" />
                          {t}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Key targets */}
              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1">Key Targets (comma-separated gene names or UniProt IDs)</label>
                <div className="flex gap-2 items-start">
                  <input type="text" value={keyTargetsInput}
                    onChange={(e) => setKeyTargetsInput(e.target.value)}
                    placeholder="e.g., TP53, AKT1, MYC"
                    className="flex-1 max-w-md px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary" />
                  <button type="button"
                    onClick={() => {
                      const markers = sessionMarkers[selectedComparison];
                      if (markers && markers.length > 0) {
                        setKeyTargetsInput((prev) => {
                          const existing = new Set(prev.split(',').map((s) => s.trim()).filter(Boolean));
                          markers.forEach((m) => existing.add(m));
                          return Array.from(existing).join(', ');
                        });
                      }
                    }}
                    disabled={!sessionMarkers[selectedComparison]?.length}
                    className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-secondary hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Load marked proteins from volcano plot"
                  >
                    Load marked proteins
                  </button>
                </div>
              </div>

              {/* Advanced toggle */}
              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-primary hover:underline mb-3">
                {showAdvanced ? 'Hide' : 'Show'} Advanced &mdash; Knowledge Sources
              </button>

              {/* Sources filter */}
              {showAdvanced && (
                <div className="mb-3 p-3 bg-surface rounded border border-border">
                  <label className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                    <input type="checkbox" checked={allSourcesSelected}
                      onChange={() => {
                        setAllSourcesSelected(!allSourcesSelected);
                        if (!allSourcesSelected) setSourcesFilter(DEFAULT_SOURCES);
                      }}
                      className="rounded" />
                    All sources
                  </label>
                  {!allSourcesSelected && (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
                      {INDRA_SOURCES.map((src) => (
                        <label key={src} className="flex items-center gap-1.5 text-xs text-text-primary">
                          <input type="checkbox" checked={sourcesFilter.includes(src)}
                            onChange={() => setSourcesFilter((prev) =>
                              prev.includes(src) ? prev.filter((x) => x !== src) : [...prev, src]
                            )}
                            className="rounded" />
                          {src}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Run button + error */}
              <div className="flex items-center gap-3">
                <button onClick={handleRunBioNet}
                  className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
                  Run BioNet Analysis
                </button>
                {runError && <span className="text-xs text-error">{runError}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Network */}
      {(runStatus?.status === 'completed' || subnetwork) && subnetwork?.nodes?.length > 0 && (
        <div className="bg-background rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-text-primary">Interaction Network</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                {subnetwork.nodes.length} proteins, {subnetwork.edges.length} interactions
                {runStatus?.comparison && ` · Query: ${runStatus.comparison.replace(/_vs_/g, ' vs ')}`}
              </p>
            </div>
          </div>
          <BioNetNetwork
            nodes={subnetwork.nodes}
            edges={subnetwork.edges}
            pvalueCutoff={adjPvalueCutoff}
            logfcCutoff={logfcCutoff}
            keyTargets={keyTargets}
          />
        </div>
      )}

      {!isRunning && !subnetwork && (
        <div className="text-center py-16 text-text-secondary">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No BioNet data available. Run the analysis above.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ReportViewerPage() {
  const params = useParams();
  const reportId = params.reportId as string;
  const apiPrefix = reportApiPrefix(reportId);

  const [reportMeta, setReportMeta] = useState<{
    report: { name: string; session_name: string; created_at: string };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('volcano');

  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/reports/${encodeURIComponent(reportId)}`)
      .then(r => { if (!r.ok) throw new Error('Report not found'); return r.json(); })
      .then(data => {
        // Backend returns { _report, ...sessionFields } — extract report metadata
        setReportMeta({
          report: {
            name: data._report?.name || '',
            session_name: data._report?.session_name || '',
            created_at: data._report?.created_at || '',
          },
        });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [reportId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-text-secondary">Loading report...</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error || !reportMeta) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-6 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-error mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-error mb-2">Error Loading Report</h2>
          <p className="text-sm text-error/80 mb-4">{error || 'Report not found'}</p>
          <Link
            href="/reports"
            className="inline-flex items-center px-4 py-2 bg-surface text-text-primary rounded-lg hover:bg-border transition-colors text-sm"
          >
            Back to Reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ApiProvider apiPrefix={apiPrefix}>
      <div className="min-h-screen bg-surface flex flex-col">
        {/* Header */}
        <div className="bg-background border-b border-border px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">{reportMeta.report.name}</h1>
              <p className="text-xs text-text-muted">
                {reportMeta.report.session_name} &middot;{' '}
                {new Date(reportMeta.report.created_at).toLocaleDateString()}
              </p>
            </div>
            <Link
              href="/reports"
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              &larr; All Reports
            </Link>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="bg-background border-b border-border sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center py-2">
              <div className="flex items-center gap-1">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'bg-primary/5 text-primary'
                          : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
          {activeTab === 'volcano' && <VolcanoTab />}
          {activeTab === 'qc' && <QCTab />}
          {activeTab === 'gsea' && <GSEATab />}
          {activeTab === 'compare' && <CompareTab />}
          {activeTab === 'bionet' && <BioNetTab />}
        </div>
      </div>
    </ApiProvider>
  );
}
