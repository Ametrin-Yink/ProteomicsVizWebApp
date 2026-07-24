'use client';

import { useEffect, useState } from 'react';

import QCWorkspace from '@/components/visualization/QCWorkspace';
import { VisualizationScopeTabs } from '@/components/visualization/VisualizationScopeTabs';
import { visualizationApi } from '@/lib/api-client';
import type { QCData, QCOverviewData, QCPerSampleData } from '@/types/api';

interface PTMQCMetrics {
  preprocessing?: Record<string, unknown>;
  results?: {
    protein_layer_available?: boolean;
  };
  plots?: QCData;
  protein_plots?: QCData | null;
}

type QCScope = 'ptm' | 'protein';

export default function PTMQCWorkspace({
  sessionId,
  apiPrefix = `/api/sessions/${sessionId}`,
}: {
  sessionId: string;
  apiPrefix?: string;
}) {
  const [metrics, setMetrics] = useState<PTMQCMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState('');
  const [scope, setScope] = useState<QCScope>('ptm');
  const [overview, setOverview] = useState<QCOverviewData | null>(null);
  const [perSampleData, setPerSampleData] = useState<QCPerSampleData | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    // PTM-specific metadata (filters, preprocessing, results)
    visualizationApi.getPTMQCPlots(apiPrefix, signal)
      .then((response) => setMetrics(response as PTMQCMetrics))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'Failed to load PTM QC metrics');
        }
      })
      .finally(() => { if (!signal.aborted) setLoading(false); });

    // Canonical overview for group abundance, CV, PCA
    visualizationApi.getQCOverview(apiPrefix, 'condition', '', undefined, signal)
      .then(setOverview)
      .catch(() => setOverview(null));

    // Per-sample intensity and completeness for the current scope
    visualizationApi.getQCPerSample(apiPrefix, scope, signal)
      .then(setPerSampleData)
      .catch(() => setPerSampleData(null));

    return () => controller.abort();
  }, [apiPrefix, scope]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-background p-8">
        <div className="flex h-[200px] items-center justify-center text-text-muted">
          Loading PTM QC metrics...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-error/20 bg-error/5 p-8 text-center">
        <p className="mb-2 text-sm text-error">Failed to load PTM QC metrics.</p>
        <p className="text-xs text-text-muted">{error}</p>
      </div>
    );
  }

  if (!metrics?.preprocessing) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p className="text-sm text-text-muted">No PTM QC metrics available.</p>
        <p className="mt-1 text-xs text-text-muted">Run the PTM pipeline to generate QC data.</p>
      </div>
    );
  }

  const proteinAvailable = Boolean(
    metrics.results?.protein_layer_available && metrics.protein_plots,
  );
  const data = scope === 'protein' ? metrics.protein_plots ?? null : metrics.plots ?? null;
  const conditionList = overview?.groups?.length
    ? overview.groups.map((g) => g.group_value)
    : Array.from(new Set(data?.pca?.conditions ?? []));
  const comparisonOptions = Object.keys(data?.pvalue_distributions ?? {}).map((value) => ({
    value,
    label: value.replace(/_vs_/g, ' vs '),
  }));
  const labels = scope === 'protein'
    ? { psm: 'Protein PSM', entity: 'Protein', entityPlural: 'Proteins' }
    : { psm: 'PTM PSM', entity: 'PTM Site', entityPlural: 'PTM Site Groups' };

  return (
    <div data-testid="ptm-qc-workspace">
      <QCWorkspace
        data={data}
        overview={overview}
        perSampleData={perSampleData}
        labels={labels}
        conditionList={conditionList}
        selectedComparison={selectedComparison}
        onComparisonChange={setSelectedComparison}
        comparisonOptions={comparisonOptions}
        scopeTabs={(
          <VisualizationScopeTabs<QCScope>
            value={scope}
            onChange={(nextScope) => {
              setScope(nextScope);
              setSelectedComparison('');
            }}
            options={[
              { key: 'ptm', label: 'PTM' },
              {
                key: 'protein',
                label: 'Protein',
                disabled: !proteinAvailable,
                disabledReason: 'A matched protein PSM file is required for protein-level QC.',
              },
            ]}
          />
        )}
      />
    </div>
  );
}
