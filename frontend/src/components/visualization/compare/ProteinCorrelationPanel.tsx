'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SearchableSelect, Select } from '@/components/ui/Select';
import FoldChangeBarChart from '@/components/visualization/compare/FoldChangeBarChart';
import ClusterMap from '@/components/visualization/compare/ClusterMap';
import CorrelationBarChart from '@/components/visualization/compare/CorrelationBarChart';
import CorrelationScatter from '@/components/visualization/compare/CorrelationScatter';
import type {
  ProteinCorrelationData,
  CompareRunStatus,
  ClusterMethod,
  ProteinListEntry,
  ProteinFCResult,
} from '@/types/api';
import {
  listProteins,
  runProteinCorrelation,
  getProteinCorrelationStatus,
  getProteinCorrelationData,
} from '@/lib/api';
import { LoaderCircle, AlertCircle } from 'lucide-react';

interface Props {
  sessionId: string;
  comparisons: Array<{ value: string; label: string }>;
}

export default function ProteinCorrelationPanel({ sessionId, comparisons }: Props) {
  const [proteins, setProteins] = useState<ProteinListEntry[]>([]);
  const [selectedProtein, setSelectedProtein] = useState<string>('');
  const [clusterMethod, setClusterMethod] = useState<ClusterMethod>('pca');
  const [colorComparison, setColorComparison] = useState<string>('');
  // Derived: auto-select first comparison when user hasn't picked one
  const effectiveColorComparison = colorComparison || comparisons[0]?.value || '';

  const [status, setStatus] = useState<CompareRunStatus>({ status: 'idle' });
  const [data, setData] = useState<ProteinCorrelationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scatter click-through
  const [selectedSimilar, setSelectedSimilar] = useState<{
    accession: string;
    gene_name: string;
    similarity: number;
    fc: ProteinFCResult[];
  } | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRunning = status.status === 'running';

  // Load available proteins on mount
  useEffect(() => {
    if (!sessionId) return;
    listProteins(sessionId).then((list) => {
      setProteins(list);
    }).catch(() => {});
  }, [sessionId]);

  // Load cached results on mount (survives tab switch / page reload)
  useEffect(() => {
    if (!sessionId) return;
    getProteinCorrelationData(sessionId).then((d) => setData(d)).catch(() => {});
  }, [sessionId]);

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

  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const newStatus = await getProteinCorrelationStatus(sessionId);
      setStatus(newStatus);
      if (newStatus.status === 'completed') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        const result = await getProteinCorrelationData(sessionId);
        setData(result);
        setSelectedSimilar(null);
      } else if (newStatus.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setError(newStatus.error || 'Protein correlation analysis failed');
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
    if (!selectedProtein || !effectiveColorComparison) return;
    setError(null);
    setSelectedSimilar(null);
    try {
      setStatus({ status: 'running' });
      await runProteinCorrelation(sessionId, {
        protein_id: selectedProtein,
        cluster_method: clusterMethod,
        color_comparison: effectiveColorComparison,
      });
      startPolling();
    } catch (err) {
      setStatus({ status: 'error' });
      setError(err instanceof Error ? err.message : 'Failed to start protein correlation');
    }
  };

  // Handle click on similar protein bar chart
  const handleSimilarClick = useCallback((label: string) => {
    if (!data) return;
    const similar = data.similar_proteins.find(
      (c) => c.gene_name === label || c.accession === label
    );
    if (!similar) return;

    setSelectedSimilar({
      accession: similar.accession,
      gene_name: similar.gene_name,
      similarity: similar.similarity,
      fc: similar.fold_changes.filter((f) => f.log_fc != null) as ProteinFCResult[],
    });
  }, [data]);

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
              Protein
            </label>
            <SearchableSelect
              options={proteinOptions}
              value={selectedProtein}
              onChange={setSelectedProtein}
              placeholder="Select protein..."
              searchPlaceholder="Search proteins..."
            />
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
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Cluster Color By
            </label>
            <Select
              options={comparisons}
              value={effectiveColorComparison}
              onChange={(e) => setColorComparison(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleRunAnalysis}
              disabled={isRunning || !selectedProtein || !effectiveColorComparison}
              className="w-full px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isRunning ? 'Running...' : 'Run Analysis'}
            </button>
          </div>
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
          <span className="text-sm text-text-primary">Computing protein correlations...</span>
        </div>
      )}

      {/* Charts */}
      {data && !isRunning && (
        <div className="space-y-6">
          {/* Top row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FoldChangeBarChart
              data={data.selected_protein_fc}
              proteinName={selectedProteinName}
            />
            <ClusterMap
              mode="protein"
              points={data.cluster_coords}
              selectedKey={selectedProtein}
              varExplained={data.cluster_var_explained}
              title={`${clusterMethod.toUpperCase()} — Proteins`}
            />
          </div>

          {/* Bottom row: 3/4 correlation bars + 1/4 scatter */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              <CorrelationBarChart
                data={data.similar_proteins.map((c) => ({
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
                  selectedProtein={data.selected_protein_fc}
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

      {/* Empty state before first run */}
      {!data && !isRunning && (
        <div className="bg-background border border-border rounded-lg p-12 text-center">
          <p className="text-text-muted">
            Select a protein and configure options above, then click Run Analysis
          </p>
        </div>
      )}
    </div>
  );
}
