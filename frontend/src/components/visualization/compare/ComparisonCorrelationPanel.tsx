'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SearchableSelect, Select } from '@/components/ui/Select';
import SimilarityMatrix from '@/components/visualization/compare/SimilarityMatrix';
import VennDiagram from '@/components/visualization/compare/VennDiagram';
import ComparisonHeatmap from '@/components/visualization/compare/ComparisonHeatmap';
import CorrelationBarChart from '@/components/visualization/compare/CorrelationBarChart';
import ClusterMap from '@/components/visualization/compare/ClusterMap';
import type {
  ComparisonCorrelationData,
  CompareRunStatus,
  ClusterMethod,
  VennData,
  VolcanoFilters,
} from '@/types/api';
import {
  runComparisonCorrelation,
  getComparisonCorrelationStatus,
  getComparisonCorrelationData,
  computeVennData,
  getSession,
} from '@/lib/api';
import { LoaderCircle, AlertCircle } from 'lucide-react';
import { formatComparisonKeyWrapped } from '@/lib/utils';

interface Props {
  sessionId: string;
  comparisons: Array<{ value: string; label: string }>;
}

export default function ComparisonCorrelationPanel({ sessionId, comparisons }: Props) {
  const [primaryComparison, setPrimaryComparison] = useState<string>('');
  const effectivePrimary = primaryComparison || comparisons[0]?.value || '';
  const [selectedComparisons, setSelectedComparisons] = useState<string[]>([]);
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('pca');

  const [status, setStatus] = useState<CompareRunStatus>({ status: 'idle' });
  const [data, setData] = useState<ComparisonCorrelationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Venn state
  const [vennComparisons, setVennComparisons] = useState<string[]>([]);
  const [vennData, setVennData] = useState<VennData | null>(null);
  const [vennLoading, setVennLoading] = useState(false);
  const [vennError, setVennError] = useState<string | null>(null);
  const [vennThresholds, setVennThresholds] = useState<VolcanoFilters>({
    foldChange: 1, pValue: 0.05, adjPValue: 0.05, s0: 0.1,
  });

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const comparisonsInitialized = useRef(false);
  const isRunning = status.status === 'running';

  // Auto-select additional comparisons (up to 9) — only on initial load
  useEffect(() => {
    if (!comparisonsInitialized.current && comparisons.length > 0) {
      setSelectedComparisons(comparisons.slice(0, 9).map((c) => c.value));
      comparisonsInitialized.current = true;
    }
  }, [comparisons]);

  // Collect marked proteins from session
  const [markedProteins, setMarkedProteins] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((session) => {
      const markers = session.markers;
      if (markers && typeof markers === 'object' && !Array.isArray(markers)) {
        const obj: Record<string, string[]> = {};
        for (const [comp, accessions] of Object.entries(markers as Record<string, string[]>)) {
          obj[comp] = accessions;
        }
        setMarkedProteins(obj);
      }
      if (session.volcano_filters) {
        setVennThresholds(session.volcano_filters);
      }
    }).catch(() => {});
  }, [sessionId]);

  // Load cached results on mount (survives tab switch / page reload)
  useEffect(() => {
    if (!sessionId) return;
    getComparisonCorrelationData(sessionId).then((d) => setData(d)).catch(() => {});
  }, [sessionId]);

  const availableVennComparisons = useMemo(() => {
    return comparisons.filter((_, i) => i < 10);
  }, [comparisons]);

  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const newStatus = await getComparisonCorrelationStatus(sessionId);
      setStatus(newStatus);
      if (newStatus.status === 'completed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const result = await getComparisonCorrelationData(sessionId);
        setData(result);
      } else if (newStatus.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setError(newStatus.error || 'Comparison correlation analysis failed');
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [sessionId]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const handleRunAnalysis = async () => {
    if (!effectivePrimary || selectedComparisons.length === 0) return;
    setError(null);
    try {
      setStatus({ status: 'running' });
      // Convert Sets to arrays for JSON serialization (Set → {} in JSON, not [])
      const markersForApi: Record<string, string[]> = {};
      for (const [comp, set] of Object.entries(markedProteins)) {
        markersForApi[comp] = Array.from(set);
      }
      await runComparisonCorrelation(sessionId, {
        primary_comparison: effectivePrimary,
        selected_comparisons: selectedComparisons,
        marked_proteins: markersForApi,
        cluster_method: clusterMethod,
      });
      startPolling();
    } catch (err) {
      setStatus({ status: 'error' });
      setError(err instanceof Error ? err.message : 'Failed to start comparison correlation');
    }
  };

  const handleComputeVenn = async () => {
    if (vennComparisons.length < 2) return;
    setVennLoading(true);
    setVennError(null);
    try {
      const result = await computeVennData(sessionId, {
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

  if (!comparisons.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-6 text-center">
        <p className="text-text-muted">No comparisons available. Run the analysis pipeline first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-background border border-border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Primary Comparison
            </label>
            <SearchableSelect
              options={comparisons}
              value={effectivePrimary}
              onChange={setPrimaryComparison}
              placeholder="Select primary..."
              searchPlaceholder="Filter comparisons..."
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Additional Comparisons (up to 9)
            </label>
            <div className="max-h-32 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
              {comparisons.map((comp) => (
                <label
                  key={comp.value}
                  className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer hover:text-text-primary"
                >
                  <input
                    type="checkbox"
                    checked={selectedComparisons.includes(comp.value)}
                    disabled={!selectedComparisons.includes(comp.value) && selectedComparisons.length >= 9}
                    onChange={(e) => {
                      if (e.target.checked) {
                        if (selectedComparisons.length < 9) {
                          setSelectedComparisons((prev) => [...prev, comp.value]);
                        }
                      } else {
                        setSelectedComparisons((prev) => prev.filter((v) => v !== comp.value));
                      }
                    }}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="truncate">{comp.label}</span>
                </label>
              ))}
            </div>
              {selectedComparisons.length >= 9 && (
                <p className="text-xs text-text-muted mt-1">Maximum 9 additional comparisons reached</p>
              )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Cluster Method
            </label>
            <Select
              options={[
                { value: 'pca', label: 'PCA' },
                { value: 'umap', label: 'UMAP' },
                { value: 'tsne', label: 'tSNE' },
              ]}
              value={clusterMethod}
              onChange={(e) => setClusterMethod(e.target.value as ClusterMethod)}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleRunAnalysis}
            disabled={isRunning || !effectivePrimary || selectedComparisons.length === 0}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isRunning ? 'Running...' : 'Run Analysis'}
          </button>
        </div>
        {error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-error">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Running indicator */}
      {isRunning && (
        <div className="bg-background border border-border rounded-lg p-4 flex items-center gap-3">
          <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-text-primary">Computing comparison correlations...</span>
        </div>
      )}

      {/* Results */}
      {data && !isRunning && (
        <div className="space-y-6">
          {/* Row 2: Similarity Matrix (left) + Most/Least Similar Comparisons (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3">
              <SimilarityMatrix
                comparisons={data.similarity_matrix.comparisons}
                matrix={data.similarity_matrix.matrix}
              />
            </div>
            <div className="lg:col-span-2">
              <CorrelationBarChart
                data={data.comparison_similarities.map((c) => ({
                  label: formatComparisonKeyWrapped(c.comparison),
                  correlation: c.similarity,
                }))}
                title="Most / Least Similar Comparisons (RMSD)"
                topN={10}
                ascending
              />
            </div>
          </div>

          {/* Row 3: Venn Diagram (graph left, overlap details right) */}
          <div className="bg-background border border-border rounded-lg p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-text-primary mb-3">Venn Diagram</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {availableVennComparisons.map((comp) => (
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
                  onClick={handleComputeVenn}
                  disabled={vennComparisons.length < 2 || vennLoading}
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

          {/* Row 4: Cluster Map (left) + Comparison Heatmap (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <ClusterMap
              mode="comparison"
              points={data.cluster_coords}
              selectedKey={effectivePrimary}
              title={`${clusterMethod.toUpperCase()} — Comparisons`}
              varExplained={data.cluster_var_explained}
            />
            <div>
              {data.heatmap_data.proteins.length > 0 ? (
                <ComparisonHeatmap
                  proteins={data.heatmap_data.proteins}
                  comparisons={data.heatmap_data.comparisons}
                  foldChanges={data.heatmap_data.fold_changes}
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

      {/* Empty state before first run */}
      {!data && !isRunning && (
        <div className="bg-background border border-border rounded-lg p-12 text-center">
          <p className="text-text-muted">
            Select a primary comparison and additional comparisons above, then click Run Analysis
          </p>
        </div>
      )}
    </div>
  );
}
