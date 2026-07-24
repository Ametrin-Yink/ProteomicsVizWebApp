'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import QCWorkspace from '@/components/visualization/QCWorkspace';
import PTMQCWorkspace from '@/components/visualization/PTMQCWorkspace';
import type {
  QCData,
  QCDifferentialData,
  QCOverviewData,
  QCPerSampleData,
} from '@/types/api';
import { visualizationApi } from '@/lib/api-client';
import { useApi } from '@/lib/api-context';
import { VisualizationPipelineWorkspace } from '@/components/visualization/VisualizationPipelineWorkspace';
import { useDebounce } from '@/hooks/use-debounce';
import QCSampleHealthTable from '@/components/visualization/QCSampleHealthTable';

function QCContent() {
  const { apiPrefix } = useApi();

  const [data, setData] = useState<QCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<QCOverviewData | null>(null);
  const [perSampleData, setPerSampleData] = useState<QCPerSampleData | null>(null);
  const [differential, setDifferential] = useState<QCDifferentialData | null>(null);
  const [groupBy, setGroupBy] = useState<'condition' | 'batch'>('condition');
  const [groupSearch, setGroupSearch] = useState('');
  const [comparisonOptions, setComparisonOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [comparisonSearch, setComparisonSearch] = useState('');
  const [selectedComparison, setSelectedComparison] = useState<string>('');
  const debouncedComparisonSearch = useDebounce(comparisonSearch, 250);
  const debouncedGroupSearch = useDebounce(groupSearch, 250);

  useEffect(() => {
    if (!apiPrefix) return;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const [qcData, overviewData, qcPerSample, comparisonPage] = await Promise.all([
          visualizationApi.getQCData(apiPrefix),
          visualizationApi.getQCOverview(apiPrefix, 'condition'),
          visualizationApi.getQCPerSample(apiPrefix),
          visualizationApi.getComparisonCatalog(apiPrefix),
        ]);
        setData(qcData);
        setOverview(overviewData);
        setPerSampleData(qcPerSample);
        const options = comparisonPage.items.map((comparison) => ({
          value: comparison.comparison_id,
          label: comparison.display_label,
        }));
        setComparisonOptions(options);
        setSelectedComparison((current) => current || options[0]?.value || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load QC data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [apiPrefix]);

  useEffect(() => {
    if (!apiPrefix) return;
    const controller = new AbortController();
    visualizationApi.getQCOverview(
      apiPrefix,
      groupBy,
      debouncedGroupSearch,
      undefined,
      controller.signal,
    )
      .then(setOverview)
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Failed to load QC overview');
      });
    return () => controller.abort();
  }, [apiPrefix, debouncedGroupSearch, groupBy]);

  useEffect(() => {
    if (!apiPrefix || !selectedComparison) return;
    const controller = new AbortController();
    visualizationApi.getQCDifferential(apiPrefix, selectedComparison, controller.signal)
      .then(setDifferential)
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Failed to load differential QC');
      });
    return () => controller.abort();
  }, [apiPrefix, selectedComparison]);

  useEffect(() => {
    if (!apiPrefix) return;
    const controller = new AbortController();
    visualizationApi.getComparisonCatalog(
      apiPrefix,
      debouncedComparisonSearch,
      undefined,
      controller.signal,
    ).then((page) => {
      const next = page.items.map((comparison) => ({
        value: comparison.comparison_id,
        label: comparison.display_label,
      }));
      setComparisonOptions((current) => {
        const selected = current.find((option) => option.value === selectedComparison);
        return selected && !next.some((option) => option.value === selected.value)
          ? [selected, ...next]
          : next;
      });
    }).catch((caught: unknown) => {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Failed to search comparisons');
    });
    return () => controller.abort();
  }, [apiPrefix, debouncedComparisonSearch, selectedComparison]);

  if (!apiPrefix) {
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

        <QCWorkspace
          data={data}
          overview={overview}
          perSampleData={perSampleData}
          differential={differential}
          labels={{ psm: 'PSM', entity: 'Protein', entityPlural: 'Proteins' }}
          conditionList={overview?.groups.map((group) => group.group_value)}
          groupBy={groupBy}
          onGroupByChange={(value) => {
            setGroupBy(value);
            setGroupSearch('');
          }}
          groupSearch={groupSearch}
          onGroupSearch={setGroupSearch}
          selectedComparison={selectedComparison}
          onComparisonChange={setSelectedComparison}
          onComparisonSearch={setComparisonSearch}
          comparisonOptions={comparisonOptions}
        />
        <QCSampleHealthTable apiPrefix={apiPrefix} />
      </div>
    </div>
  );
}

export { QCContent };

function VisualizationQCContent() {
  return (
    <VisualizationPipelineWorkspace
      renderPTM={(sessionId) => (
        <div className="flex-1 bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-8">
            <div className="mb-6">
              <h1 className="font-semibold text-text-primary">QC Plots</h1>
              <p className="mt-2 text-text-secondary">
                Quality control visualizations for the PTM analysis
              </p>
            </div>
            <PTMQCWorkspace sessionId={sessionId} />
          </div>
        </div>
      )}
    >
      <QCContent />
    </VisualizationPipelineWorkspace>
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
      <VisualizationQCContent />
    </Suspense>
  );
}
