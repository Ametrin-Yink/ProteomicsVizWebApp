'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PTMVolcano from '@/components/visualization/PTMVolcano';
import PTMCompare from '@/components/visualization/PTMCompare';
import BioNetNetwork from '@/components/visualization/BioNetNetwork';
import QCPlots from '@/components/visualization/QCPlots';
import type { BioNetRunStatus, BioNetSubnetwork, QCData } from '@/types/api';

// ─── QC Metrics Tab ─────────────────────────────────────────────────────────

interface PTMQCMetrics {
  filters?: Record<string, { input_psms?: number; quality_filtered_psms?: number }>;
  preprocessing?: {
    passing_site_count?: number;
    localization?: Record<string, number>;
    normalization?: { method?: string; applied?: boolean; complete_feature_count?: number; warning?: string | null };
    quantified_protein_count?: number;
  };
  results?: {
    ptm_rows?: number;
    ptm_estimated?: number;
    ptm_significant_bh_0_05?: number;
    protein_layer_available?: boolean;
    adjusted_layer_available?: boolean;
  };
  plots?: QCData;
  protein_plots?: QCData | null;
}

export function PTMQCTab({ sessionId }: { sessionId: string }) {
  const [metrics, setMetrics] = useState<PTMQCMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState('');
  const [layer, setLayer] = useState<'ptm' | 'protein'>('ptm');

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

  if (!metrics || !metrics.preprocessing) {
    return (
      <div className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No PTM QC metrics available.</p>
          <p className="text-text-muted text-xs mt-1">Run the PTM pipeline to generate QC data.</p>
        </div>
      </div>
    );
  }

  const proteinAvailable = Boolean(
    metrics.results?.protein_layer_available && metrics.protein_plots,
  );
  const plots = layer === 'protein' ? metrics.protein_plots : metrics.plots;
  const conditions = Array.from(new Set(plots?.pca?.conditions ?? []));
  const comparisonOptions = Object.keys(plots?.pvalue_distributions ?? {}).map((value) => ({
    value,
    label: value.replace(/_vs_/g, ' vs '),
  }));
  const entityLabel = layer === 'protein' ? 'Protein' : 'PTM Site';
  const psmLabel = layer === 'protein' ? 'Protein PSM' : 'PTM PSM';
  const entityPlural = layer === 'protein' ? 'Proteins' : 'PTM Site Groups';
  const summaryCards = [
    { label: `Total Unique ${psmLabel}s`, value: plots?.total_psms?.toLocaleString() ?? 'N/A' },
    { label: `Avg ${psmLabel}s/Sample`, value: plots?.avg_psms_per_sample?.toLocaleString() ?? 'N/A' },
    { label: `Total ${entityPlural}`, value: plots?.total_proteins?.toLocaleString() ?? 'N/A' },
    { label: `Avg ${entityPlural}/Sample`, value: plots?.avg_proteins_per_sample?.toLocaleString() ?? 'N/A' },
    { label: `Avg ${entityLabel} CV`, value: plots?.average_protein_cv == null ? 'N/A' : `${plots.average_protein_cv.toFixed(1)}%` },
    { label: `Avg ${psmLabel} CV`, value: plots?.average_psm_cv == null ? 'N/A' : `${plots.average_psm_cv.toFixed(1)}%` },
  ];

  return (
    <div className="space-y-6" data-testid="ptm-qc-tab">
      <div className="flex gap-1 rounded-lg border border-border bg-background p-3">
        <button
          type="button"
          onClick={() => { setLayer('ptm'); setSelectedComparison(''); }}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            layer === 'ptm' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
          }`}
        >
          PTM
        </button>
        <button
          type="button"
          disabled={!proteinAvailable}
          title={proteinAvailable ? 'Show protein-level QC' : 'A matched protein PSM file is required for protein-level QC.'}
          onClick={() => { setLayer('protein'); setSelectedComparison(''); }}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            layer === 'protein' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
          } ${!proteinAvailable ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          Protein
        </button>
      </div>

      <div data-testid="ptm-qc-summary" className="rounded-lg border border-border bg-background p-4">
        <h2 className="mb-4 text-base font-semibold text-text-primary">QC Summary Statistics</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-lg bg-surface p-3">
              <span className="text-sm text-text-secondary">{card.label}</span>
              <span className="ml-2 text-xl font-semibold text-text-primary">{card.value}</span>
            </div>
          ))}
        </div>
      </div>

      {plots ? (
        <QCPlots
          key={layer}
          data={plots}
          conditionList={conditions}
          selectedComparison={selectedComparison}
          onComparisonChange={setSelectedComparison}
          comparisonOptions={comparisonOptions}
          labels={{ psm: psmLabel, entity: entityLabel }}
        />
      ) : (
        <div className="rounded-lg border border-border bg-background p-5 text-center">
          <p className="text-text-secondary">No {entityLabel.toLowerCase()} abundance matrix is available for QC plots.</p>
        </div>
      )}
    </div>
  );
}

// ─── Site Abundance Tab ─────────────────────────────────────────────────────

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
          <h1 className="font-semibold text-text-primary">
            {!tab || tab === 'volcano' || tab === 'results'
              ? 'Differential Expression Results'
              : tab === 'qc' ? 'QC Plots' : tab === 'compare' ? 'Compare Analysis' : 'PTM Analysis'}
          </h1>
          {tab === 'qc' && (
            <p className="mt-2 text-text-secondary">
              Quality control visualizations for the PTM analysis
            </p>
          )}
        </div>

        {/* Tab content */}
        {(!tab || tab === 'volcano' || tab === 'results') && (
          <PTMVolcano sessionId={sessionId} />
        )}
        {tab === 'qc' && <PTMQCTab sessionId={sessionId} />}
        {tab === 'compare' && <PTMCompare sessionId={sessionId} />}
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
