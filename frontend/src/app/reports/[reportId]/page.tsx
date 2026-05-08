'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  ChartScatter,
  Activity,
  Spline,
  GitCompare,
  ChartNetwork,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ApiProvider, useApi } from '@/lib/api-context';
import { reportApiPrefix, getDataSource, getDEResults, getQCData, getGSEAData, getGSEAPlotData, getGSEAHeatmapData, updateVisualizationState, getBioNetSubnetwork, getComparisonCorrelationData, getProteinCorrelationData, computeVennData } from '@/lib/api';
import { formatComparisonKeyWrapped, formatGroup, isSignificantVolcano, parseDelimited } from '@/lib/utils';

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
  ProteinListEntry,
} from '@/types/api';
import { GSEADatabaseLabels } from '@/types/api';
import { SearchableSelect } from '@/components/ui/Select';

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
          if (session.markers && typeof session.markers === 'object') {
            const restored: Record<string, Set<string>> = {};
            for (const [comp, accessions] of Object.entries(session.markers as Record<string, string[]>)) {
              restored[comp] = new Set(accessions);
            }
            setMarkedProteins(restored);
          }

          // Restore filters
          if (session.volcano_filters) {
            setFilters(session.volcano_filters);
          }
        }
      } catch { /* silently fail */ }
    }
    fetchConfig();
  }, [apiPrefix]);

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
  }, [apiPrefix]);

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
  }, [apiPrefix]);

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

      {!loading && !error && !data && (
        <div className="text-center py-16 text-text-secondary">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No GSEA data available. Run GSEA analysis first.</p>
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

  // Fetch compare data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [session] = await Promise.all([
          getDataSource(apiPrefix).catch(() => null),
        ]);
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

  if (!comparisonData && !proteinData) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No comparison data available in this report.</p>
        <p className="text-sm mt-2 text-text-muted">Run the Compare analysis in the visualization page to generate data for this section.</p>
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

      {activeSubTab === 'comparison' && comparisonData && (
        <div className="space-y-6">
          <div className="bg-background rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold mb-2">Comparison Correlation</h3>
            <p className="text-sm text-text-muted mb-4">
              Correlation between DE results across different comparisons
            </p>
          </div>
          {comparisonData.similarity_matrix && (
            <SimilarityMatrix data={comparisonData.similarity_matrix} />
          )}
          {comparisonData.heatmap && (
            <ComparisonHeatmap data={comparisonData.heatmap} />
          )}
          {comparisonData.bar_chart && (
            <CorrelationBarChart data={comparisonData.bar_chart} />
          )}
        </div>
      )}

      {activeSubTab === 'comparison' && !comparisonData && (
        <div className="text-center py-8 text-text-secondary">
          <p>No comparison correlation data available.</p>
        </div>
      )}

      {activeSubTab === 'protein' && proteinData && (
        <div className="space-y-6">
          <div className="bg-background rounded-lg border border-border p-4">
            <h3 className="text-base font-semibold mb-2">Protein Correlation</h3>
            <p className="text-sm text-text-muted mb-4">
              Correlation patterns across proteins
            </p>
          </div>
          {proteinData.bar_chart && (
            <CorrelationBarChart data={proteinData.bar_chart} />
          )}
          {proteinData.cluster_map && <CorrelationBarChart data={proteinData.cluster_map} />}
        </div>
      )}

      {activeSubTab === 'protein' && !proteinData && (
        <div className="text-center py-8 text-text-secondary">
          <p>No protein correlation data available.</p>
        </div>
      )}

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

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const data = await getBioNetSubnetwork(apiPrefix);
        setSubnetwork(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load BioNet data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [apiPrefix]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No BioNet data available in this report.</p>
        <p className="text-sm mt-2 text-text-muted">{error}</p>
      </div>
    );
  }

  if (!subnetwork || !subnetwork.nodes || !subnetwork.edges) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No BioNet data available.</p>
      </div>
    );
  }

  return (
    <BioNetNetwork
      nodes={subnetwork.nodes}
      edges={subnetwork.edges}
      pvalueCutoff={0.05}
      logfcCutoff={0.5}
      keyTargets={subnetwork.key_targets || []}
    />
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
      .then(setReportMeta)
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
          <a
            href="/reports"
            className="inline-flex items-center px-4 py-2 bg-surface text-text-primary rounded-lg hover:bg-border transition-colors text-sm"
          >
            Back to Reports
          </a>
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
            <a
              href="/reports"
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              &larr; All Reports
            </a>
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
