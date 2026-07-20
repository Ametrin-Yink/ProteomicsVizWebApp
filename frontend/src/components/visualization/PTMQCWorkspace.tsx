'use client';

import { useEffect, useState } from 'react';

import QCWorkspace from '@/components/visualization/QCWorkspace';
import { VisualizationScopeTabs } from '@/components/visualization/VisualizationScopeTabs';
import type { QCData } from '@/types/api';

interface PTMQCMetrics {
  preprocessing?: Record<string, unknown>;
  results?: {
    protein_layer_available?: boolean;
  };
  plots?: QCData;
  protein_plots?: QCData | null;
}

type QCScope = 'ptm' | 'protein';

export default function PTMQCWorkspace({ sessionId }: { sessionId: string }) {
  const [metrics, setMetrics] = useState<PTMQCMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedComparison, setSelectedComparison] = useState('');
  const [scope, setScope] = useState<QCScope>('ptm');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/sessions/${sessionId}/ptm/qc/plots`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((response) => setMetrics(response.data ?? response))
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'Failed to load PTM QC metrics');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sessionId]);

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
  const conditionList = Array.from(new Set(data?.pca?.conditions ?? []));
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
