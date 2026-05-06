'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import GSEADashboard from '@/components/visualization/GSEADashboard';
import PathwayTable from '@/components/visualization/PathwayTable';
import GSEAPlot from '@/components/visualization/GSEAPlot';
import type { GSEAData, GSEAResult, GSEADatabase, GSEARunStatus } from '@/types/api';
import { GSEADatabaseLabels } from '@/types/api';
import { getGSEAData, getSession, runGSEA, getGSEAStatus } from '@/lib/api';
import { formatGroup } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';

const DATABASES: GSEADatabase[] = ['go_bp', 'go_mf', 'go_cc', 'kegg', 'reactome'];

function GSEAAnalysisContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [selectedDatabase, setSelectedDatabase] = useState<GSEADatabase>('go_bp');
  const [data, setData] = useState<GSEAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionConfig, setSessionConfig] = useState<{
    comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>;
  } | null>(null);
  const [selectedComparison, setSelectedComparison] = useState<string>('');
  const [runDatabases, setRunDatabases] = useState<GSEADatabase[]>(['go_bp', 'kegg', 'reactome']);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [runParams, setRunParams] = useState({ min_size: 15, max_size: 500, permutations: 1000 });
  const [runningGSEA, setRunningGSEA] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedPathway, setSelectedPathway] = useState<GSEAResult | null>(null);
  const [gseaRunStatus, setGseaRunStatus] = useState<GSEARunStatus | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Server-side pagination state
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [sortBy, setSortBy] = useState('nes');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [significantOnly, setSignificantOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [totalResults, setTotalResults] = useState(0);

  // Debounce search input
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [search]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      setSelectedPathway(null);
      try {
        const gseaData = await getGSEAData(sessionId, selectedDatabase, {
          page,
          per_page: pageSize,
          sort_by: sortBy,
          sort_order: sortOrder,
          significant_only: significantOnly,
          search: debouncedSearch,
          comparison: selectedComparison || undefined,
        });
        if (!cancelled) {
          setData(gseaData);
          // Backend returns total in the response
          setTotalResults((gseaData as unknown as Record<string, unknown>).total as number || 0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load GSEA data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitialLoad(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [selectedDatabase, sessionId, page, sortBy, sortOrder, significantOnly, debouncedSearch, selectedComparison]);

  // Fetch session config for comparisons
  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then(session => {
      if (session?.config) {
        setSessionConfig({ comparisons: session.config.comparisons });
        const comps = session.config.comparisons;
        if (comps && comps.length > 0) {
          const first = comps[0];
          setSelectedComparison(formatGroup(first.group1) + '_vs_' + formatGroup(first.group2));
        }
      }
    }).catch(() => {});
  }, [sessionId]);

  // Poll GSEA run status
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const status = await getGSEAStatus(sessionId);
      setGseaRunStatus(status);
      if (status.status === 'completed' || status.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setRunningGSEA(false);
        if (status.status === 'error') {
          setRunError(status.error || 'GSEA run failed');
        }
        if (status.status === 'completed') {
          setPage(1);
          const gseaData = await getGSEAData(sessionId, selectedDatabase, {
            page: 1, per_page: pageSize, sort_by: sortBy, sort_order: sortOrder,
            significant_only: significantOnly, search: debouncedSearch,
            comparison: selectedComparison || undefined,
          });
          setData(gseaData);
          setTotalResults((gseaData as unknown as Record<string, unknown>).total as number || 0);
        }
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [sessionId, selectedDatabase, pageSize, sortBy, sortOrder, significantOnly, debouncedSearch, selectedComparison]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Check GSEA status on mount — resume polling if run in progress, load if completed
  useEffect(() => {
    if (!sessionId) return;
    getGSEAStatus(sessionId).then((status) => {
      setGseaRunStatus(status);
      if (status.status === 'running') {
        startPolling();
      } else if (status.status === 'completed' && !data) {
        // Results were computed while user was away — fetch them
        setPage(1);
      }
    }).catch(() => {});
    // Only run on mount / session change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    setRunningGSEA(true);
    setRunError(null);
    try {
      await runGSEA(sessionId, {
        comparison: selectedComparison,
        databases: runDatabases,
        min_size: runParams.min_size,
        max_size: runParams.max_size,
        permutations: runParams.permutations,
      });
      // Run started — begin polling for progress
      setGseaRunStatus({
        status: 'running',
        comparison: selectedComparison,
        databases: Object.fromEntries(runDatabases.map((db) => [db, 'running'])),
      });
      startPolling();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'GSEA run failed');
      setRunningGSEA(false);
    }
  };

  if (!sessionId) {
    return (
      <div data-testid="no-session-selected" className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <p className="text-sm text-text-muted mb-4">Create a new analysis to get started.</p>
          <Link
            data-testid="start-analysis-link"
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    );
  }

  // Full-page loading only on initial load
  if (loading && initialLoad) {
    return (
      <div className="flex-1 bg-surface">
        <div className="mx-auto px-6 py-8 max-w-7xl">
        <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
        <div className="h-12 bg-border/30 rounded-lg mb-6 animate-pulse" />
        <div className="h-48 bg-border/30 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-5 max-w-md">
          <h2 className="text-base font-semibold text-error mb-2">Error Loading GSEA Data</h2>
          <p className="text-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="gsea-container" className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">GSEA Analysis</h1>
          <p className="text-text-secondary mt-2">
            Gene Set Enrichment Analysis (GSEA) results
          </p>
        </div>

        {/* Comparison Selector */}
        {sessionConfig?.comparisons && sessionConfig.comparisons.length > 0 && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            <label className="block text-sm font-medium text-text-primary mb-3">Select Comparison</label>
            <SearchableSelect
              options={sessionConfig.comparisons.map((c) => {
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

        {/* Run GSEA Section */}
        {selectedComparison && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            {gseaRunStatus?.status === 'running' ? (
              /* Progress panel while GSEA is running */
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
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
                        <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : dbStatus === 'error' ? (
                        <svg className="w-4 h-4 text-error flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
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
              /* Run controls when not running */
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
                  {DATABASES.map((db) => (
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
                <button onClick={handleRunGSEA} disabled={runningGSEA || runDatabases.length === 0}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity">
                  {runningGSEA ? 'Starting...' : 'Run GSEA'}
                </button>
                {runError && <p className="mt-2 text-sm text-error">{runError}</p>}
              </>
            )}
          </div>
        )}

        {/* Content with inline loading overlay */}
        <div className="relative">
          {loading && !initialLoad && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 rounded-lg">
              <div className="flex items-center gap-2 text-text-secondary">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent"></div>
                <span className="text-sm">Loading...</span>
              </div>
            </div>
          )}

          {/* Database Selector */}
          <div className="bg-background rounded-lg border border-border p-4 mb-8">
            <label className="block text-sm font-medium text-text-primary mb-3">
              Select Database
            </label>
            <div data-testid="database-select" className="flex flex-wrap gap-2">
              {DATABASES.map((db) => (
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
            <div data-testid="current-database" className="mt-2 text-sm text-text-secondary">
              Current: {GSEADatabaseLabels[selectedDatabase]}
            </div>
          </div>

          {/* Content */}
          {data ? (
            <div className="space-y-6">
              {/* GSEA Dashboard */}
              <GSEADashboard
                data={data}
                selectedPathway={selectedPathway}
                onSelectPathway={setSelectedPathway}
              />

            {/* Pathway Details and Plot */}
            {selectedPathway && (
              <div className="w-full">
                <GSEAPlot pathway={selectedPathway} sessionId={sessionId} database={selectedDatabase} comparison={selectedComparison || undefined} onPathwayUpdated={setSelectedPathway} />
              </div>
            )}

            {/* Pathway Table */}
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
        ) : (
          <div className="bg-surface rounded-lg border border-border p-5 text-center">
            <p className="text-text-secondary">No GSEA data available</p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default function GSEAAnalysisPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <GSEAAnalysisContent />
    </Suspense>
  );
}
