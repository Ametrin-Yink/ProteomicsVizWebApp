'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import type { BioNetRunStatus, BioNetSubnetwork } from '@/types/api';
import { INDRA_SOURCES, INDRA_STATEMENT_TYPES } from '@/types/api';
import { getBioNetStatus, getBioNetSubnetwork, runBioNet, getDataSource, sessionApiPrefix } from '@/lib/api';
import { formatGroup } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';
import { LoaderCircle } from 'lucide-react';

const DEFAULT_SOURCES = [...INDRA_SOURCES];
const DEFAULT_STATEMENT_TYPES = [...INDRA_STATEMENT_TYPES];

function BioNetContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const apiPrefix = sessionApiPrefix(sessionId);

  // Config state
  const [selectedComparison, setSelectedComparison] = useState('');
  const [comparisons, setComparisons] = useState<Array<{ group1: Record<string, string>; group2: Record<string, string> }>>([]);
  const [adjPvalueCutoff, setAdjPvalueCutoff] = useState(0.05);
  const [logfcCutoff, setLogfcCutoff] = useState(0.5);
  const [statementTypes, setStatementTypes] = useState<string[]>(DEFAULT_STATEMENT_TYPES);
  const [allStatementTypesSelected, setAllStatementTypesSelected] = useState(true);
  const [paperCountCutoff, setPaperCountCutoff] = useState(1);
  const [evidenceCountCutoff, setEvidenceCountCutoff] = useState(1);
  const [sourcesFilter, setSourcesFilter] = useState<string[]>(DEFAULT_SOURCES);
  const [allSourcesSelected, setAllSourcesSelected] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Key targets & volcano markers
  const [keyTargetsInput, setKeyTargetsInput] = useState('');
  const [sessionMarkers, setSessionMarkers] = useState<Record<string, string[]>>({});
  const keyTargets = useMemo(
    () => keyTargetsInput.split(',').map((s) => s.trim()).filter(Boolean),
    [keyTargetsInput]
  );

  // Run state
  const [runStatus, setRunStatus] = useState<BioNetRunStatus | null>(null);
  const [subnetwork, setSubnetwork] = useState<BioNetSubnetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<BioNetRunStatus | null>(null);
  const isRunning = runStatus?.status === 'running';

  // Fetch session config for comparisons and markers
  useEffect(() => {
    if (!sessionId) return;
    getDataSource(sessionApiPrefix(sessionId)).then((session) => {
      if (session?.config?.comparisons) {
        setComparisons(session.config.comparisons);
        const comps = session.config.comparisons;
        if (comps.length > 0) {
          const first = comps[0];
          setSelectedComparison(
            formatGroup(first.group1) + '_vs_' + formatGroup(first.group2)
          );
        }
      }
      // Read per-comparison markers from volcano plot
      if (session?.markers && typeof session.markers === 'object' && !Array.isArray(session.markers)) {
        setSessionMarkers(session.markers as Record<string, string[]>);
      }
    }).catch(() => {});
  }, [sessionId]);

  // Polling
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const status = await getBioNetStatus(apiPrefix);
      if (
        lastStatusRef.current?.status === status.status &&
        lastStatusRef.current?.node_count === status.node_count
      ) {
        return;
      }
      lastStatusRef.current = status;
      setRunStatus(status);

      if (status.status === 'completed' || status.status === 'error') {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        if (status.status === 'error') {
          setRunError(status.error || 'BioNet analysis failed');
        }
        if (status.status === 'completed') {
          const data = await getBioNetSubnetwork(apiPrefix);
          setSubnetwork(data);
          setLoading(false);
        }
      }
    } catch {
      // silently ignore polling errors
    }
  }, [sessionId, apiPrefix]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 2000);
  }, [pollStatus]);

  // Check status on mount
  useEffect(() => {
    if (!sessionId) return;
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
      setLoading(false);
    }).catch(() => { setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup polling
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
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

  // No session
  if (!sessionId) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <p className="text-sm text-text-muted mb-4">Create a new analysis to get started.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    );
  }

  // Initial load skeleton
  if (loading) {
    return (
      <div className="flex-1 bg-surface">
        <div className="mx-auto px-6 py-8 max-w-7xl">
          <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
          <div className="h-32 bg-border/30 rounded-lg mb-6 animate-pulse" />
          <div className="h-96 bg-border/30 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">BioNet Network Analysis</h1>
          <p className="text-text-secondary mt-2">
            Protein-protein interaction network from INDRA literature-mined database
          </p>
        </div>

        {/* Comparison Selector */}
        {comparisons.length > 0 && (
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              Select Comparison
            </label>
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
          <div className="bg-background rounded-lg border border-border p-4 mb-4">
            {isRunning ? (
              <div className="flex items-center gap-3">
                <LoaderCircle className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium text-text-primary">
                  BioNet analysis in progress: {runStatus?.comparison?.replace(/_vs_/g, ' vs ')}
                </span>
                <span className="text-xs text-text-muted">
                  Querying INDRA database... You can navigate away and return
                </span>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-medium text-text-primary mb-4">
                  Parameters &mdash; {selectedComparison.replace(/_vs_/g, ' vs ')}
                </h3>

                {/* Basic params */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Adjusted p-value cutoff
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={adjPvalueCutoff}
                      onChange={(e) => setAdjPvalueCutoff(parseFloat(e.target.value) || 0.05)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      |Log2FC| cutoff
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={logfcCutoff}
                      onChange={(e) => setLogfcCutoff(parseFloat(e.target.value) || 0.5)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Paper count &ge;
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={paperCountCutoff}
                      onChange={(e) => setPaperCountCutoff(parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">
                      Evidence count &ge;
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={evidenceCountCutoff}
                      onChange={(e) => setEvidenceCountCutoff(parseInt(e.target.value) || 1)}
                      className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                  </div>
                </div>

                {/* Statement types */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">
                    Interaction Types
                  </label>
                  <div className="p-3 bg-surface rounded border border-border">
                    <label className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                      <input
                        type="checkbox"
                        checked={allStatementTypesSelected}
                        onChange={() => {
                          setAllStatementTypesSelected(!allStatementTypesSelected);
                          if (!allStatementTypesSelected) {
                            setStatementTypes(DEFAULT_STATEMENT_TYPES);
                          }
                        }}
                        className="rounded"
                      />
                      All interaction types (INDRA)
                    </label>
                    {!allStatementTypesSelected && (
                      <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5">
                        {INDRA_STATEMENT_TYPES.map((t) => (
                          <label
                            key={t}
                            className="flex items-center gap-1.5 text-xs text-text-primary"
                          >
                            <input
                              type="checkbox"
                              checked={statementTypes.includes(t)}
                              onChange={() =>
                                setStatementTypes((prev) =>
                                  prev.includes(t)
                                    ? prev.filter((x) => x !== t)
                                    : [...prev, t]
                                )
                              }
                              className="rounded"
                            />
                            {t}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Key targets */}
                <div className="mb-3">
                  <label className="block text-xs text-text-secondary mb-1">
                    Key Targets (comma-separated gene names or UniProt IDs)
                  </label>
                  <div className="flex gap-2 items-start">
                    <input
                      type="text"
                      value={keyTargetsInput}
                      onChange={(e) => setKeyTargetsInput(e.target.value)}
                      placeholder="e.g., TP53, AKT1, MYC"
                      className="flex-1 max-w-md px-2 py-1.5 text-sm border border-border rounded bg-background text-text-primary"
                    />
                    <button
                      type="button"
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
                      className="px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-secondary hover:bg-background disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      title="Load marked proteins from volcano plot"
                    >
                      Load marked proteins
                    </button>
                  </div>
                  {sessionMarkers[selectedComparison]?.length > 0 && (
                    <p className="text-xs text-text-muted mt-1">
                      {sessionMarkers[selectedComparison].length} marked protein(s) available for this comparison
                    </p>
                  )}
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-primary hover:underline mb-3"
                >
                  {showAdvanced ? 'Hide' : 'Show'} Advanced &mdash; Knowledge Sources
                </button>

                {/* Sources filter */}
                {showAdvanced && (
                  <div className="mb-3 p-3 bg-surface rounded border border-border">
                    <label className="flex items-center gap-2 text-xs text-text-secondary mb-2">
                      <input
                        type="checkbox"
                        checked={allSourcesSelected}
                        onChange={() => {
                          setAllSourcesSelected(!allSourcesSelected);
                          if (!allSourcesSelected) {
                            setSourcesFilter(DEFAULT_SOURCES);
                          }
                        }}
                        className="rounded"
                      />
                      All sources
                    </label>
                    {!allSourcesSelected && (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-1.5">
                        {INDRA_SOURCES.map((src) => (
                          <label
                            key={src}
                            className="flex items-center gap-1.5 text-xs text-text-primary"
                          >
                            <input
                              type="checkbox"
                              checked={sourcesFilter.includes(src)}
                              onChange={() =>
                                setSourcesFilter((prev) =>
                                  prev.includes(src)
                                    ? prev.filter((x) => x !== src)
                                    : [...prev, src]
                                )
                              }
                              className="rounded"
                            />
                            {src}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Run button + error */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleRunBioNet}
                    className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                  >
                    Run BioNet Analysis
                  </button>
                  {runError && (
                    <span className="text-xs text-error">{runError}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Network Viz Card */}
        {(runStatus?.status === 'completed' || subnetwork) && subnetwork && (
          <div className="bg-background rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-medium text-text-primary">
                  Interaction Network
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  {subnetwork.nodes.length} proteins, {subnetwork.edges.length} interactions
                  {runStatus?.comparison && ` · Query: ${runStatus.comparison.replace(/_vs_/g, ' vs ')}`}
                </p>
              </div>
            </div>

            {subnetwork.nodes.length === 0 ? (
              <div className="text-center py-16 text-text-muted text-sm">
                <p className="mb-2">No protein interactions found in INDRA for this comparison.</p>
                <p>Try relaxing the p-value or |log2FC| cutoff.</p>
              </div>
            ) : (
              <BioNetNetwork
                nodes={subnetwork.nodes}
                edges={subnetwork.edges}
                pvalueCutoff={adjPvalueCutoff}
                logfcCutoff={logfcCutoff}
                keyTargets={keyTargets}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BioNetPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 bg-surface">
          <div className="mx-auto px-6 py-8 max-w-7xl">
            <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
            <div className="h-32 bg-border/30 rounded-lg mb-6 animate-pulse" />
          </div>
        </div>
      }
    >
      <BioNetContent />
    </Suspense>
  );
}
