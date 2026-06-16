'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PTMVolcano from '@/components/visualization/PTMVolcano';
import PTMResultsTable from '@/components/visualization/PTMResultsTable';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import type { BioNetRunStatus, BioNetSubnetwork } from '@/types/api';

/** Tab configuration for the PTM visualization page. */
const TABS = [
  { key: 'volcano', label: 'Volcano Plot' },
  { key: 'results', label: 'Results Table' },
  { key: 'qc', label: 'QC Metrics' },
  { key: 'site-abundance', label: 'Site Abundance' },
  { key: 'bionet', label: 'BioNet Network' },
];

// ─── QC Metrics Tab ─────────────────────────────────────────────────────────

interface PTMQCMetrics {
  total_sites: number;
  significant_hits: number;
  up_regulated: number;
  down_regulated: number;
  comparisons: string[];
}

function PTMQCTab({ sessionId }: { sessionId: string }) {
  const [metrics, setMetrics] = useState<PTMQCMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/sessions/${sessionId}/ptm/qc/plots`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setMetrics(json.data ?? json);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="bg-background rounded-lg border border-border p-8">
        <div className="flex items-center justify-center h-[200px]">
          <div className="flex items-center gap-2 text-text-muted">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading PTM QC metrics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-error text-sm mb-2">Failed to load PTM QC metrics.</p>
          <p className="text-text-muted text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!metrics || metrics.total_sites === 0) {
    return (
      <div className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No PTM QC metrics available.</p>
          <p className="text-text-muted text-xs mt-1">Run the PTM pipeline to generate QC data.</p>
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'Total Modification Sites', value: metrics.total_sites.toLocaleString(), color: 'text-primary' },
    { label: 'Significant Hits', value: metrics.significant_hits.toLocaleString(), color: 'text-error' },
    { label: 'Up-Regulated', value: metrics.up_regulated.toLocaleString(), color: 'text-[#E73564]' },
    { label: 'Down-Regulated', value: metrics.down_regulated.toLocaleString(), color: 'text-[#00ADEF]' },
    { label: 'Comparisons', value: metrics.comparisons.length.toString(), color: 'text-text-primary' },
  ];

  return (
    <div className="space-y-6" data-testid="ptm-qc-tab">
      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-background rounded-lg border border-border p-4 text-center"
            data-testid={`ptm-qc-card-${card.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-text-muted mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Comparison list */}
      {metrics.comparisons.length > 0 && (
        <div className="bg-background rounded-lg border border-border p-4">
          <h4 className="text-sm font-medium text-text-primary mb-2">Comparisons</h4>
          <ul className="space-y-1">
            {metrics.comparisons.map((comp) => (
              <li key={comp} className="text-sm text-text-secondary font-mono">
                {comp.replace(/_vs_/g, ' vs ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Site Abundance Tab ─────────────────────────────────────────────────────

function PTMSiteAbundanceTab({ sessionId }: { sessionId: string }) {
  return (
    <div className="bg-background rounded-lg border border-border p-8 text-center" data-testid="ptm-site-abundance-tab">
      <div className="max-w-md mx-auto">
        <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl text-primary/40">&#8987;</span>
        </div>
        <h2 className="text-lg font-medium text-text-primary mb-2">
          PTM Site Abundance
        </h2>
        <p className="text-text-secondary text-sm leading-relaxed">
          Site-level abundance analysis will be available after the PTM pipeline completes.
        </p>
        <p className="text-text-muted text-xs mt-3">
          Session: {sessionId.slice(0, 8)}...
        </p>
      </div>
    </div>
  );
}

// ─── BioNet Tab ─────────────────────────────────────────────────────────────

function PTMBioNetTab({ sessionId }: { sessionId: string }) {
  const [subnetwork, setSubnetwork] = useState<BioNetSubnetwork | null>(null);
  const [runStatus, setRunStatus] = useState<BioNetRunStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const apiPrefix = `/api/sessions/${sessionId}`;

    Promise.all([
      fetch(`${apiPrefix}/bionet/status`).then((r) => r.json()),
      fetch(`${apiPrefix}/bionet/subnetwork`).then((r) => r.json()),
    ])
      .then(([statusJson, subnetJson]) => {
        if (cancelled) return;
        const status = statusJson.data ?? statusJson;
        const subnet = subnetJson.data ?? subnetJson;
        setRunStatus(status);
        if (subnet?.nodes?.length > 0) {
          setSubnetwork(subnet);
        }
      })
      .catch(() => {
        // silently fail
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="bg-background rounded-lg border border-border p-8">
        <div className="flex items-center justify-center h-[300px]">
          <div className="flex items-center gap-2 text-text-muted">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading BioNet data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!subnetwork || subnetwork.nodes.length === 0) {
    return (
      <div className="bg-background rounded-lg border border-border p-8 text-center" data-testid="ptm-bionet-tab">
        <div className="max-w-md mx-auto">
          <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-primary/40">&#8987;</span>
          </div>
          <h2 className="text-lg font-medium text-text-primary mb-2">
            PTM BioNet Network
          </h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            {runStatus?.status === 'error'
              ? 'BioNet analysis encountered an error.'
              : 'Run BioNet analysis from the PTM visualization tab to view the interaction network.'}
          </p>
          <Link
            href={`/analysis/visualization/bionet?session_id=${sessionId}`}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity text-sm"
          >
            Open BioNet Page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="ptm-bionet-tab">
      <BioNetNetwork
        nodes={subnetwork.nodes}
        edges={subnetwork.edges}
        pvalueCutoff={0.05}
        logfcCutoff={0.5}
        keyTargets={[]}
      />
      <div className="mt-3 text-center">
        <Link
          href={`/analysis/visualization/bionet?session_id=${sessionId}`}
          className="text-xs text-primary hover:underline"
        >
          Open full BioNet page &rarr;
        </Link>
      </div>
    </div>
  );
}

// ─── Main tab content router ────────────────────────────────────────────────

function PTMPlaceholderContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const tab = searchParams.get('tab') || '';

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

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text-primary">PTM Analysis</h1>
          <p className="text-sm text-text-muted mt-1">
            Session: {sessionId.slice(0, 8)}...
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-0.5 bg-background rounded-lg border border-border w-fit">
          {TABS.map((t) => {
            const isActive = tab === t.key || (!tab && t.key === 'volcano');
            return (
              <Link
                key={t.key}
                href={`/analysis/visualization/ptm-placeholder?session_id=${sessionId}&tab=${t.key}`}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                data-testid={`ptm-tab-${t.key}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Tab content */}
        {(!tab || tab === 'volcano') && <PTMVolcano sessionId={sessionId} />}
        {tab === 'results' && <PTMResultsTable sessionId={sessionId} />}
        {tab === 'qc' && <PTMQCTab sessionId={sessionId} />}
        {tab === 'site-abundance' && <PTMSiteAbundanceTab sessionId={sessionId} />}
        {tab === 'bionet' && <PTMBioNetTab sessionId={sessionId} />}
      </div>
    </div>
  );
}

export default function PTMPlaceholderPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <PTMPlaceholderContent />
    </Suspense>
  );
}
