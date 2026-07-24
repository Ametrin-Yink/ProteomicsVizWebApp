'use client';

import { useEffect, type ReactNode } from 'react';

import QCPlots from '@/components/visualization/QCPlots';
import type { QCData, QCDifferentialData, QCOverviewData, QCPerSampleData } from '@/types/api';

interface QCWorkspaceProps {
  data: QCData | null;
  overview?: QCOverviewData | null;
  perSampleData?: QCPerSampleData | null;
  differential?: QCDifferentialData | null;
  labels: {
    psm: string;
    entity: string;
    entityPlural: string;
  };
  conditionList?: string[];
  selectedComparison: string;
  onComparisonChange: (value: string) => void;
  comparisonOptions: Array<{ value: string; label: string }>;
  onComparisonSearch?: (value: string) => void;
  groupBy?: 'condition' | 'batch';
  onGroupByChange?: (value: 'condition' | 'batch') => void;
  groupSearch?: string;
  onGroupSearch?: (value: string) => void;
  scopeTabs?: ReactNode;
}

function formatCount(value: number | undefined): string {
  return value == null ? 'N/A' : value.toLocaleString();
}

function formatPercent(value: number | undefined): string {
  return value == null ? 'N/A' : `${value.toFixed(1)}%`;
}

export default function QCWorkspace({
  data,
  overview,
  perSampleData,
  differential,
  labels,
  conditionList,
  selectedComparison,
  onComparisonChange,
  comparisonOptions,
  onComparisonSearch,
  groupBy = 'condition',
  onGroupByChange,
  groupSearch = '',
  onGroupSearch,
  scopeTabs,
}: QCWorkspaceProps) {
  const effectiveSelectedComparison = selectedComparison || comparisonOptions[0]?.value || '';

  useEffect(() => {
    if (!selectedComparison && effectiveSelectedComparison) {
      onComparisonChange(effectiveSelectedComparison);
    }
  }, [effectiveSelectedComparison, onComparisonChange, selectedComparison]);

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 text-center">
        <p className="text-text-secondary">No QC data available</p>
      </div>
    );
  }

  const summaryCards = [
    { label: `Total Unique ${labels.psm}s`, value: formatCount(data.total_psms) },
    { label: `Avg Detected ${labels.psm}s/Sample`, value: formatCount(data.avg_psms_per_sample) },
    { label: `Total ${labels.entityPlural}`, value: formatCount(data.total_proteins) },
    { label: `Avg Detected ${labels.entityPlural}/Sample`, value: formatCount(data.avg_proteins_per_sample) },
    {
      label: `Avg ${labels.entity} CV`,
      value: formatPercent(data.average_protein_cv ?? data.average_cv),
    },
    { label: `Avg ${labels.psm} CV`, value: formatPercent(data.average_psm_cv) },
  ];

  return (
    <div className="space-y-6">
      {scopeTabs}
      <div data-testid="qc-summary" className="rounded-lg border border-border bg-background p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Analysis Summary</h2>
            <p className="mt-1 text-xs text-text-muted">Experiment-wide quality metrics</p>
          </div>
          {overview && (
            <div className="flex flex-wrap gap-1.5 text-xs text-text-secondary">
              <span className="rounded-full bg-surface px-2 py-1">{overview.normalization_method}</span>
              <span className="rounded-full bg-surface px-2 py-1">Imputation: {overview.imputation_method}</span>
              <span className="rounded-full bg-surface px-2 py-1">Processed log2</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-lg bg-surface p-3">
              <span className="text-sm text-text-secondary">{card.label}</span>
              <span className="ml-2 text-xl font-semibold text-text-primary">{card.value}</span>
            </div>
          ))}
        </div>
      </div>

      <QCPlots
        data={data}
        overview={overview}
        perSampleData={perSampleData}
        differential={differential}
        conditionList={conditionList}
        groupBy={groupBy}
        onGroupByChange={onGroupByChange}
        groupSearch={groupSearch}
        onGroupSearch={onGroupSearch}
        selectedComparison={effectiveSelectedComparison}
        onComparisonChange={onComparisonChange}
        onComparisonSearch={onComparisonSearch}
        comparisonOptions={comparisonOptions}
        labels={{ psm: labels.psm, entity: labels.entity }}
      />
    </div>
  );
}
