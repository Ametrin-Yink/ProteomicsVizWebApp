'use client';

import React, { useEffect, useState } from 'react';
import SimilarityMatrix from '@/components/visualization/compare/SimilarityMatrix';
import ProteinCompareWorkspace from '@/components/visualization/compare/ProteinCompareWorkspace';
import { VisualizationScopeTabs } from '@/components/visualization/VisualizationScopeTabs';
import { sessionApiPrefix, visualizationApi } from '@/lib/api-client';
import type { PTMComparisonSummary, PTMResultLayer } from '@/types/api';

const LAYERS: Array<{ key: PTMResultLayer; label: string }> = [
  { key: 'ptm', label: 'PTM' },
  { key: 'protein', label: 'Protein' },
  { key: 'adjusted', label: 'Protein-adjusted PTM' },
];

export default function PTMCompare({ sessionId }: { sessionId: string }) {
  const [summaries, setSummaries] = useState<Partial<Record<PTMResultLayer, PTMComparisonSummary>>>({});
  const [layer, setLayer] = useState<PTMResultLayer>('ptm');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const apiPrefix = sessionApiPrefix(sessionId);
    Promise.all(LAYERS.map(async ({ key }) => [
      key,
      await visualizationApi.getPTMComparisonSummary(apiPrefix, key, controller.signal),
    ] as const))
      .then((entries) => {
        if (active) setSummaries(Object.fromEntries(entries));
      })
      .catch((reason) => {
        if (active && !(reason instanceof Error && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'Failed to load PTM comparisons');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionId]);

  const summary = summaries[layer] ?? summaries.ptm;
  const comparisons = summary?.comparisons ?? [];
  const comparisonOptions = comparisons.map((comparison) => ({
    value: comparison,
    label: comparison.replace(/_vs_/g, ' vs '),
  }));

  if (loading) return <div className="h-96 animate-pulse rounded-lg bg-border/30" />;
  if (error) return <div className="rounded-lg border border-error/20 bg-error/5 p-5 text-error">{error}</div>;
  if (comparisons.length < 2) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <h2 className="text-lg font-medium text-text-primary">At least two comparisons are required</h2>
        <p className="mt-2 text-sm text-text-muted">
          This session has {comparisons.length} comparison. Add another comparison and rerun the PTM analysis to compare matched feature changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="ptm-compare">
      <div className="rounded-lg border border-border bg-background p-4">
        <h2 className="font-semibold text-text-primary">Comparison Correlation</h2>
        <p className="mt-1 text-sm text-text-muted">
          Pearson correlation of log2 fold changes using feature IDs quantified in both comparisons.
        </p>
        <div className="mt-4">
          <VisualizationScopeTabs<PTMResultLayer>
            value={layer}
            onChange={setLayer}
            options={LAYERS.map((item) => ({
              ...item,
              disabled: !summaries[item.key]?.available_for_all,
              disabledReason: 'This result layer is not available for every comparison.',
            }))}
          />
        </div>
      </div>

      {layer === 'protein' ? (
        <ProteinCompareWorkspace comparisons={comparisonOptions} />
      ) : (
        <>
          <SimilarityMatrix
            comparisons={comparisons}
            matrix={(summary?.matrix ?? []).map((row) => (
              row.map((value) => value ?? Number.NaN)
            ))}
            title={`${LAYERS.find((item) => item.key === layer)?.label} Comparison Correlation`}
            metricLabel="Pearson r"
            range={[-1, 1]}
          />

          <div className="overflow-hidden rounded-lg border border-border bg-background">
        <div className="border-b border-border p-4">
          <h3 className="font-semibold text-text-primary">Matched-feature evidence</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface text-text-secondary">
            <tr>
              <th className="px-4 py-3 text-left">Comparison pair</th>
              <th className="px-4 py-3 text-right">Matched features</th>
              <th className="px-4 py-3 text-right">Pearson r</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(summary?.pairs ?? []).map((pair) => (
              <tr key={`${pair.left}:${pair.right}`}>
                <td className="px-4 py-3 text-text-primary">
                  {pair.left.replace(/_vs_/g, ' vs ')} ↔ {pair.right.replace(/_vs_/g, ' vs ')}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">{pair.matched.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-text-primary">
                  {pair.correlation === null ? 'N/A' : pair.correlation.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </>
      )}
    </div>
  );
}
