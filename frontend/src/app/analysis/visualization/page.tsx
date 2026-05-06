'use client';

import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import VolcanoPlot from '@/components/visualization/VolcanoPlot';
import ProteinInfo from '@/components/visualization/ProteinInfo';
import ProteinTable from '@/components/visualization/ProteinTable';
import type { DEResult, DEResultsData, VolcanoFilters } from '@/types/api';
import { getDEResults, getSession, updateSessionVisualizationState } from '@/lib/api';
import { FilterPanel } from '@/components/visualization/FilterPanel';
import { formatGroup, isSignificantVolcano, parseDelimited } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';


function ResultsContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session');

  const [data, setData] = useState<DEResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionConfig, setSessionConfig] = useState<{ treatment?: string; control?: string; experiment: string; comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }> } | null>(null);
  const [selectedComparison, setSelectedComparison] = useState<string>('');
  const comparisonInitialized = React.useRef(false);

  const [filters, setFilters] = useState<VolcanoFilters>({
    foldChange: 1,
    pValue: 0.05,
    adjPValue: 1,
    s0: 0.1, // 10% of foldChange threshold
  });

  // Persist filters to localStorage for PDFExport to read
  useEffect(() => {
    try {
      localStorage.setItem('volcano_filters', JSON.stringify(filters));
    } catch {}
  }, [filters]);

  const [selectedProteins, setSelectedProteins] = useState<Set<string>>(new Set());
  const [selectedProteinData, setSelectedProteinData] = useState<DEResult | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [markedProteins, setMarkedProteins] = useState<Set<string>>(new Set());


  // Fetch data on mount and when comparison changes
  useEffect(() => {
    async function fetchData() {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        const results = await getDEResults(sessionId, {
          page: 1,
          per_page: 20000,
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
  }, [sessionId, selectedComparison]);

  // Fetch session config and restore visualization state
  useEffect(() => {
    if (!sessionId) return;
    async function fetchSessionConfig() {
      const session = await getSession(sessionId!);
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

        // Auto-select first comparison on initial load
        if (!comparisonInitialized.current) {
          if (comparisons && comparisons.length > 0) {
            const first = comparisons[0];
            setSelectedComparison(`${formatGroup(first.group1)}_vs_${formatGroup(first.group2)}`);
          } else if (cfg.treatment && cfg.control) {
            setSelectedComparison('');
          }
          comparisonInitialized.current = true;
        }

        // Restore markers from session (always reset, don't carry over from previous session)
        if (session.markers && session.markers.length > 0) {
          setMarkedProteins(new Set(session.markers));
        } else {
          setMarkedProteins(new Set());
        }

        // Restore volcano filters from session (always reset, fall back to defaults)
        if (session.volcano_filters) {
          setFilters(session.volcano_filters);
        } else {
          setFilters({ foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 });
        }
      }
    }

    fetchSessionConfig();
  }, [sessionId]);

  // Handle protein selection from volcano plot
  const handleSelectProteins = useCallback((proteins: string[]) => {
    setSelectedProteins(new Set(proteins));

    // Set the first selected protein as the active one for info panel
    if (proteins.length > 0 && data) {
      // Handle proteins with multiple UniProt IDs (e.g., "P00367; P49448")
      const clickedProtein = proteins[0];
      const protein = data.results.find((r) => {
        // Check if the clicked protein matches the full accessions string
        // or if the clicked protein is contained within the accessions
        return r.master_protein_accessions === clickedProtein ||
               parseDelimited(r.master_protein_accessions).includes(clickedProtein) ||
               parseDelimited(clickedProtein).some(p => r.master_protein_accessions.includes(p));
      });
      if (protein) {
        setSelectedProteinData(protein);
      }
    }
  }, [data]);

  // Handle protein selection from table - single select only (like double-click)
  const handleSelectProteinFromTable = useCallback((protein: DEResult) => {
    setSelectedProteinData(protein);
    setSelectedProteins(new Set([protein.master_protein_accessions]));
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedProteins(new Set());
    setSelectedProteinData(null);
  }, []);

  // Handle marker toggle from table
  const handleToggleMark = useCallback((protein: DEResult) => {
    setMarkedProteins((prev) => {
      const next = new Set(prev);
      if (next.has(protein.master_protein_accessions)) {
        next.delete(protein.master_protein_accessions);
      } else {
        next.add(protein.master_protein_accessions);
      }
      return next;
    });
  }, []);

  // Clear all markers
  const handleClearAllMarks = useCallback(() => {
    setMarkedProteins(new Set());
  }, []);

  // Save markers to backend when they change (debounced)
  useEffect(() => {
    const markersArray = Array.from(markedProteins);
    if (!sessionId) return;
    const timer = setTimeout(async () => {
      try {
        await updateSessionVisualizationState(sessionId, { markers: markersArray });
      } catch {
        // Silently fail — markers are still in local state
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [markedProteins, sessionId]);

  // Save filters to backend when they change (debounced)
  useEffect(() => {
    if (!sessionId) return;
    const timer = setTimeout(async () => {
      try {
        await updateSessionVisualizationState(sessionId, { volcano_filters: filters });
      } catch {
        // Silently fail — filters are still in local state
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [filters, sessionId]);

  const comparisonOptions = useMemo(() => {
    if (!sessionConfig?.comparisons) return [];
    return sessionConfig.comparisons.map((c) => {
      const g1 = formatGroup(c.group1);
      const g2 = formatGroup(c.group2);
      return {
        value: `${g1}_vs_${g2}`,
        label: `${g1} vs ${g2}`,
      };
    });
  }, [sessionConfig?.comparisons]);

  const comparisonLabel = useMemo(() => {
    if (selectedComparison) {
      return selectedComparison.replace(/_vs_/g, ' vs ');
    }
    if (sessionConfig?.treatment && sessionConfig?.control) {
      return `${sessionConfig.treatment} vs ${sessionConfig.control}`;
    }
    return undefined;
  }, [selectedComparison, sessionConfig]);

  // Calculate DE counts based on current filters
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

  if (loading) {
    return (
      <div className="flex-1 bg-surface">
        <div className="mx-auto px-6 py-8 max-w-7xl">
          <div className="h-8 bg-border/30 rounded-lg w-64 mb-6 animate-pulse" />
          <div className="h-12 bg-border/30 rounded-lg mb-6 animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="h-48 bg-border/30 rounded-lg animate-pulse" />
              <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
            </div>
            <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-5 max-w-md">
          <h2 className="text-base font-semibold text-error mb-2">Error Loading Results</h2>
          <p className="text-error">{error}</p>
        </div>
      </div>
    );
  }

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

  if (!data) {
    return (
      <div data-testid="no-results-message" className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary">No results available</p>
          <a
            data-testid="start-analysis-link"
            href="/analysis"
            className="text-primary hover:opacity-80 mt-4 inline-block"
          >
            Start a new analysis
          </a>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="volcano-container" className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">Differential Expression Results</h1>
        </div>

        {/* General Info Panel */}
        <div className="flex items-center gap-3 mb-6 text-sm bg-background border border-border rounded-lg px-5 py-3 flex-wrap" data-testid="general-info-panel">
          <span className="font-semibold text-text-primary">{sessionConfig?.experiment || 'Results'}</span>
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
          <span className="text-text-secondary">{data.total_proteins.toLocaleString()} proteins</span>
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
          {/* Left Column - Volcano Plot */}
          <div className="lg:col-span-2 space-y-6">
            {/* Volcano Plot */}
            <VolcanoPlot
              data={data.results}
              filters={filters}
              selectedProteins={selectedProteins}
              markedProteins={markedProteins}
              onSelectProteins={handleSelectProteins}
              onClearSelection={clearSelection}
              comparisonLabel={comparisonLabel}
            />

            {/* Filters (collapsed by default) */}
            <FilterPanel
              foldChange={filters.foldChange}
              pValue={filters.pValue}
              adjPValue={filters.adjPValue}
              s0={filters.s0}
              onChange={(newFilters) => setFilters(newFilters)}
              onReset={() => setFilters({ foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 })}
            />

            {/* Protein Table */}
            <ProteinTable
              data={data.results}
              selectedProteins={selectedProteins}
               onSelectProtein={handleSelectProteinFromTable}
              showSelectedOnly={showSelectedOnly}
              onToggleShowSelected={() => setShowSelectedOnly(!showSelectedOnly)}
              filters={filters}
              sessionConfig={sessionConfig}
              markedProteins={markedProteins}
              onToggleMark={handleToggleMark}
              onClearAllMarks={handleClearAllMarks}
              comparisonLabel={comparisonLabel}
            />
          </div>

          {/* Right Column - Protein Info */}
          <div className="lg:col-span-1">
            {selectedProteins.size > 1 ? (
              <div className="bg-background rounded-lg border border-border p-6">
                <div className="text-center text-text-secondary py-8">
                  <p className="text-lg font-medium">Multiple Proteins Selected</p>
                  <p className="text-sm mt-2">{selectedProteins.size} proteins selected.</p>
                  <p className="text-sm text-text-muted mt-1">
                    Select a single protein to view detailed information.
                  </p>
                  <button
                    onClick={clearSelection}
                    className="mt-4 px-4 py-2 bg-surface hover:bg-border/30 text-text-secondary rounded-lg text-sm font-medium transition-colors"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : (
              <ProteinInfo
                protein={selectedProteins.size === 1 ? selectedProteinData : null}
                sessionId={sessionId}
                filters={filters}
                comparison={selectedComparison || undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-text-secondary">Loading...</p>
      </div>
    </div>}>
      <ResultsContent />
    </Suspense>
  );
}
