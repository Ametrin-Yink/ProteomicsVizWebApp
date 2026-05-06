'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import QCPlots from '@/components/visualization/QCPlots';
import type { QCData } from '@/types/api';
import { getQCData, getSession } from '@/lib/api';
import { formatGroup } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/Select';

function QCContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [data, setData] = useState<QCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conditionList, setConditionList] = useState<string[]>([]);
  const [comparisons, setComparisons] = useState<Array<{ group1: Record<string, string>; group2: Record<string, string> }>>([]);
  const [selectedComparison, setSelectedComparison] = useState<string>('');

  useEffect(() => {
    if (!sessionId) return;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const qcData = await getQCData(sessionId);
        setData(qcData);
        // Build condition list from session config
        const session = await getSession(sessionId);
        if (session?.config) {
          const config = session.config;
          const conditions = new Set<string>();
          if (config.comparisons && config.comparisons.length > 0) {
            config.comparisons.forEach((comp) => {
              Object.keys(comp.group1 || {}).forEach((c) => conditions.add(c));
              Object.keys(comp.group2 || {}).forEach((c) => conditions.add(c));
            });
          }
          if (config.treatment) conditions.add(config.treatment);
          if (config.control) conditions.add(config.control);
          setConditionList(Array.from(conditions));
          if (config.comparisons && config.comparisons.length > 0) {
            setComparisons(config.comparisons);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load QC data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId]);

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

  if (loading) {
    return (
      <div className="flex-1 bg-surface">
        <div className="mx-auto px-6 py-8 max-w-7xl">
        <div className="h-8 bg-border/30 rounded-lg w-48 mb-6 animate-pulse" />
        <div className="h-12 bg-border/30 rounded-lg mb-6 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="h-20 bg-border/30 rounded-lg animate-pulse" />
          <div className="h-20 bg-border/30 rounded-lg animate-pulse" />
          <div className="h-20 bg-border/30 rounded-lg animate-pulse" />
          <div className="h-20 bg-border/30 rounded-lg animate-pulse" />
        </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-5 max-w-md">
          <h2 className="text-base font-semibold text-error mb-2">Error Loading QC Data</h2>
          <p className="text-error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">QC Plots</h1>
          <p className="text-text-secondary mt-2">
            Quality control visualizations for the proteomics analysis
          </p>
        </div>

        {/* QC Summary Statistics */}
        {data && (
          <div data-testid="qc-summary" className="mb-6 bg-background rounded-lg border border-border p-4">
            <h2 className="text-base font-semibold text-text-primary mb-4">QC Summary Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* PSM Statistics */}
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Total Unique PSMs</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.total_psms?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Avg Unique PSMs/Sample</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.avg_psms_per_sample?.toLocaleString() || 'N/A'}
                </span>
              </div>

              {/* Protein Statistics */}
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Total Proteins</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.total_proteins?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Avg Proteins/Sample</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.avg_proteins_per_sample?.toLocaleString() || 'N/A'}
                </span>
              </div>

              {/* CV Statistics - MIN-010: Show separate Protein and PSM CV */}
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Avg Protein CV</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.average_protein_cv?.toFixed(1) || data.average_cv?.toFixed(1) || 'N/A'}%
                </span>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <span className="text-sm text-text-secondary">Avg PSM CV</span>
                <span className="ml-2 text-xl font-semibold text-text-primary">
                  {data.average_psm_cv?.toFixed(1) || 'N/A'}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Comparison selector for p-value distribution */}
        {comparisons.length > 0 && (
          <div className="mb-4 bg-background rounded-lg border border-border p-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              P-value Distribution: Select Comparison
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

        {/* QC Plots Grid */}
        {data ? (
          <QCPlots data={data} conditionList={conditionList.length > 0 ? conditionList : undefined} selectedComparison={selectedComparison || undefined} />
        ) : (
          <div className="bg-surface rounded-lg border border-border p-5 text-center">
            <p className="text-text-secondary">No QC data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QCPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <QCContent />
    </Suspense>
  );
}
