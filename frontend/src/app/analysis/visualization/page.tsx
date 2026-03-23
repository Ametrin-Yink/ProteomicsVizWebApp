'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import VolcanoPlot from '@/components/visualization/VolcanoPlot';
import ProteinInfo from '@/components/visualization/ProteinInfo';
import ProteinTable from '@/components/visualization/ProteinTable';
import type { DEResult, DEResultsData, VolcanoFilters } from '@/types/api';
import { getDEResults } from '@/lib/api';
import { SlidersHorizontal, X } from 'lucide-react';

// Mock session ID - in production this would come from context or URL
const SESSION_ID = 'mock-session-id';

function ResultsContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'results';
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || SESSION_ID;

  const [data, setData] = useState<DEResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<VolcanoFilters>({
    foldChange: 2,
    pValue: 0.05,
    adjPValue: 1,
  });

  const [selectedProteins, setSelectedProteins] = useState<Set<string>>(new Set());
  const [selectedProteinData, setSelectedProteinData] = useState<DEResult | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);


  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const results = await getDEResults(sessionId, {
          page: 1,
          per_page: 20000, // Get all for client-side filtering
        });
        setData(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId]);

  const [selectionMode, setSelectionMode] = useState<'click' | 'box' | 'lasso'>('click');

  // Handle protein selection from volcano plot
  const handleSelectProteins = useCallback((proteins: string[], mode?: 'click' | 'box' | 'lasso') => {
    if (mode === 'click') {
      // Click mode: clear previous selection and select only the clicked protein
      setSelectedProteins(new Set(proteins));
    } else {
      // Box/lasso mode: add to existing selection
      setSelectedProteins((prev) => {
        const newSet = new Set(prev);
        proteins.forEach((p) => newSet.add(p));
        return newSet;
      });
    }

    // Set the first selected protein as the active one for info panel
    if (proteins.length > 0 && data) {
      const protein = data.results.find((r) => r.master_protein_accessions === proteins[0]);
      if (protein) {
        setSelectedProteinData(protein);
      }
    }
  }, [data]);

  // Handle protein selection from table
  const handleSelectProteinFromTable = useCallback((protein: DEResult) => {
    setSelectedProteinData(protein);
    setSelectedProteins((prev) => {
      const newSet = new Set(prev);
      newSet.add(protein.master_protein_accessions);
      return newSet;
    });
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedProteins(new Set());
    setSelectedProteinData(null);
  }, []);

  // Calculate DE counts based on current filters
  const deCounts = React.useMemo(() => {
    if (!data) return { total: 0, up: 0, down: 0 };

    const significant = data.results.filter(
      (r) =>
        Math.abs(r.log_fc) >= filters.foldChange &&
        r.pval <= filters.pValue &&
        r.adj_pval <= filters.adjPValue
    );

    return {
      total: significant.length,
      up: significant.filter((r) => r.log_fc > 0).length,
      down: significant.filter((r) => r.log_fc < 0).length,
    };
  }, [data, filters]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading Results</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div data-testid="no-results-message" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p className="text-lg">No results available</p>
          <a 
            data-testid="start-analysis-link"
            href="/analysis" 
            className="text-blue-600 hover:text-blue-800 mt-4 inline-block"
          >
            Start a new analysis
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Results</h1>
          <p className="text-gray-600 mt-2">
            Differential expression analysis results with interactive volcano plot
          </p>
        </div>

        {/* General Info Panel */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8" data-testid="general-info-panel">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">Total Proteins Identified</div>
            <div className="text-2xl font-bold text-gray-900" data-testid="total-proteins">{data.total_proteins}</div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">Total DE Proteins</div>
            <div className="text-2xl font-bold text-gray-900" data-testid="significant-proteins">{deCounts.total}</div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">Upregulated</div>
            <div className="text-2xl font-bold text-pink-600" data-testid="upregulated-count">{deCounts.up}</div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500 mb-1">Downregulated</div>
            <div className="text-2xl font-bold text-blue-600" data-testid="downregulated-count">{deCounts.down}</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Volcano Plot */}
          <div className="lg:col-span-2 space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-gray-700">
                  <SlidersHorizontal className="w-4 h-4" />
                  <span className="font-medium">Filters</span>
                </div>

                {selectedProteins.size > 0 && (
                  <div data-testid="selection-count" className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">
                      {selectedProteins.size} selected
                    </span>
                    <button
                      onClick={clearSelection}
                      className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800"
                    >
                      <X className="w-4 h-4" />
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Filter controls - always visible */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Fold Change Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      data-testid="logfc-threshold-slider"
                      type="range"
                      min="0"
                      max="5"
                      step="0.5"
                      value={filters.foldChange}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          foldChange: parseFloat(e.target.value),
                        }))
                      }
                      className="flex-1"
                    />
                    <input
                      data-testid="logfc-threshold-input"
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      value={filters.foldChange}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0 && value <= 5) {
                          setFilters((prev) => ({
                            ...prev,
                            foldChange: value,
                          }));
                        }
                      }}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    P-value Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      data-testid="pvalue-threshold-slider"
                      type="range"
                      min="0.001"
                      max="1"
                      step="0.001"
                      value={filters.pValue}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          pValue: parseFloat(e.target.value),
                        }))
                      }
                      className="flex-1"
                    />
                    <input
                      data-testid="pvalue-threshold-input"
                      type="number"
                      min="0.001"
                      max="1"
                      step="0.001"
                      value={filters.pValue}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0.001 && value <= 1) {
                          setFilters((prev) => ({
                            ...prev,
                            pValue: value,
                          }));
                        }
                      }}
                      className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Adj P-value Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      data-testid="adjpvalue-threshold-slider"
                      type="range"
                      min="0.001"
                      max="1"
                      step="0.001"
                      value={filters.adjPValue}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          adjPValue: parseFloat(e.target.value),
                        }))
                      }
                      className="flex-1"
                    />
                    <input
                      data-testid="adjpvalue-threshold-input"
                      type="number"
                      min="0.001"
                      max="1"
                      step="0.001"
                      value={filters.adjPValue}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value);
                        if (!isNaN(value) && value >= 0.001 && value <= 1) {
                          setFilters((prev) => ({
                            ...prev,
                            adjPValue: value,
                          }));
                        }
                      }}
                      className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Volcano Plot */}
            <VolcanoPlot
              data={data.results}
              filters={filters}
              selectedProteins={selectedProteins}
              onSelectProteins={handleSelectProteins}
              onSelectionModeChange={setSelectionMode}
            />

            {/* Protein Table */}
            <ProteinTable
              data={data.results}
              selectedProteins={selectedProteins}
               onSelectProtein={handleSelectProteinFromTable}
              showSelectedOnly={showSelectedOnly}
              onToggleShowSelected={() => setShowSelectedOnly(!showSelectedOnly)}
            />
          </div>

          {/* Right Column - Protein Info */}
          <div className="lg:col-span-1">
            {selectedProteins.size === 1 ? (
              <ProteinInfo protein={selectedProteinData} sessionId={sessionId} />
            ) : selectedProteins.size > 1 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="text-center text-gray-500 py-8">
                  <p className="text-lg font-medium">Multiple Proteins Selected</p>
                  <p className="text-sm mt-2">{selectedProteins.size} proteins selected.</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Select a single protein to view detailed information.
                  </p>
                  <button
                    onClick={clearSelection}
                    className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : (
              <ProteinInfo protein={null} sessionId={sessionId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    </div>}>
      <ResultsContent />
    </Suspense>
  );
}
