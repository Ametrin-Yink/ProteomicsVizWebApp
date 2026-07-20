'use client';

import React, { useEffect, useMemo, useState } from 'react';
import SimilarityMatrix from '@/components/visualization/compare/SimilarityMatrix';
import ProteinCompareWorkspace from '@/components/visualization/compare/ProteinCompareWorkspace';

type Layer = 'ptm_model' | 'protein_model' | 'adjusted_model';

interface ComparisonData {
  label: string;
  ptm_model: Record<string, unknown>[];
  protein_model: Record<string, unknown>[];
  adjusted_model: Record<string, unknown>[];
}

const LAYERS: Array<{ key: Layer; label: string }> = [
  { key: 'ptm_model', label: 'PTM' },
  { key: 'protein_model', label: 'Protein' },
  { key: 'adjusted_model', label: 'Protein-adjusted PTM' },
];

function featureMap(rows: Record<string, unknown>[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.Protein ?? row.ProteinName ?? '');
    const value = Number(row.log2FC);
    if (id && Number.isFinite(value)) result.set(id, value);
  }
  return result;
}

function pearson(left: number[], right: number[]): number {
  if (left.length < 2 || left.length !== right.length) return Number.NaN;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

export default function PTMCompare({ sessionId }: { sessionId: string }) {
  const [comparisons, setComparisons] = useState<ComparisonData[]>([]);
  const [layer, setLayer] = useState<Layer>('ptm_model');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/ptm/results`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((response) => setComparisons(response.data?.comparisons ?? []))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load PTM comparisons'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const analysis = useMemo(() => {
    const maps = comparisons.map((comparison) => featureMap(comparison[layer]));
    const matrix = comparisons.map((_, rowIndex) => comparisons.map((__, columnIndex) => {
      if (rowIndex === columnIndex) return 1;
      const shared = Array.from(maps[rowIndex].keys()).filter((id) => maps[columnIndex].has(id));
      return pearson(
        shared.map((id) => maps[rowIndex].get(id) as number),
        shared.map((id) => maps[columnIndex].get(id) as number),
      );
    }));
    const pairs = [] as Array<{ left: string; right: string; matched: number; correlation: number }>;
    for (let leftIndex = 0; leftIndex < comparisons.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < comparisons.length; rightIndex += 1) {
        pairs.push({
          left: comparisons[leftIndex].label,
          right: comparisons[rightIndex].label,
          matched: Array.from(maps[leftIndex].keys()).filter((id) => maps[rightIndex].has(id)).length,
          correlation: matrix[leftIndex][rightIndex],
        });
      }
    }
    return { matrix, pairs };
  }, [comparisons, layer]);

  const comparisonOptions = comparisons.map((comparison) => ({
    value: comparison.label,
    label: comparison.label.replace(/_vs_/g, ' vs '),
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
        <div className="mt-4 flex flex-wrap gap-1">
          {LAYERS.map((item) => {
            const disabled = comparisons.some((comparison) => comparison[item.key].length === 0);
            return (
              <button
                key={item.key}
                type="button"
                disabled={disabled}
                onClick={() => setLayer(item.key)}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  layer === item.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {layer === 'protein_model' ? (
        <ProteinCompareWorkspace comparisons={comparisonOptions} />
      ) : (
        <>
          <SimilarityMatrix
            comparisons={comparisons.map((comparison) => comparison.label)}
            matrix={analysis.matrix}
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
            {analysis.pairs.map((pair) => (
              <tr key={`${pair.left}:${pair.right}`}>
                <td className="px-4 py-3 text-text-primary">
                  {pair.left.replace(/_vs_/g, ' vs ')} ↔ {pair.right.replace(/_vs_/g, ' vs ')}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">{pair.matched.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono text-text-primary">
                  {Number.isFinite(pair.correlation) ? pair.correlation.toFixed(3) : 'N/A'}
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
