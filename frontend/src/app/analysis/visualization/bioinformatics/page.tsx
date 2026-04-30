'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import GSEADashboard from '@/components/visualization/GSEADashboard';
import PathwayTable from '@/components/visualization/PathwayTable';
import GSEAPlot from '@/components/visualization/GSEAPlot';
import type { GSEAData, GSEAResult, GSEADatabase } from '@/types/api';
import { GSEADatabaseLabels } from '@/types/api';
import { getGSEAData } from '@/lib/api';

const DATABASES: GSEADatabase[] = ['go_bp', 'go_mf', 'go_cc', 'kegg', 'reactome'];

function BioinformaticsContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [selectedDatabase, setSelectedDatabase] = useState<GSEADatabase>('go_bp');
  const [data, setData] = useState<GSEAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPathway, setSelectedPathway] = useState<GSEAResult | null>(null);

  // Server-side pagination state
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [sortBy, setSortBy] = useState('nes');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [significantOnly, setSignificantOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [totalResults, setTotalResults] = useState(0);

  useEffect(() => {
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
          search,
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
  }, [selectedDatabase, sessionId, page, sortBy, sortOrder, significantOnly, search]);

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
    <div data-testid="bioinformatics-container" className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text">Bioinformatics</h1>
          <p className="text-text-secondary mt-2">
            Gene Set Enrichment Analysis (GSEA) results
          </p>
        </div>

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
            <label className="block text-sm font-medium text-text mb-3">
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
          {data && data.results && Array.isArray(data.results) && data.results.length > 0 ? (
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
                <GSEAPlot pathway={selectedPathway} sessionId={sessionId} database={selectedDatabase} onPathwayUpdated={setSelectedPathway} />
              </div>
            )}

            {/* Pathway Table */}
            <PathwayTable
              data={data.results}
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

export default function BioinformaticsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <BioinformaticsContent />
    </Suspense>
  );
}
