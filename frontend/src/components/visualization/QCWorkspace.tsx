'use client';

import type { ReactNode } from 'react';

import QCPlots from '@/components/visualization/QCPlots';
import type { QCData } from '@/types/api';

interface QCWorkspaceProps {
  data: QCData | null;
  labels: {
    psm: string;
    entity: string;
    entityPlural: string;
  };
  conditionList?: string[];
  selectedComparison: string;
  onComparisonChange: (value: string) => void;
  comparisonOptions: Array<{ value: string; label: string }>;
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
  labels,
  conditionList,
  selectedComparison,
  onComparisonChange,
  comparisonOptions,
  scopeTabs,
}: QCWorkspaceProps) {
  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 text-center">
        <p className="text-text-secondary">No QC data available</p>
      </div>
    );
  }

  const summaryCards = [
    { label: `Total Unique ${labels.psm}s`, value: formatCount(data.total_psms) },
    { label: `Avg Unique ${labels.psm}s/Sample`, value: formatCount(data.avg_psms_per_sample) },
    { label: `Total ${labels.entityPlural}`, value: formatCount(data.total_proteins) },
    { label: `Avg ${labels.entityPlural}/Sample`, value: formatCount(data.avg_proteins_per_sample) },
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

      <QCPlots
        data={data}
        conditionList={conditionList}
        selectedComparison={selectedComparison}
        onComparisonChange={onComparisonChange}
        comparisonOptions={comparisonOptions}
        labels={{ psm: labels.psm, entity: labels.entity }}
      />
    </div>
  );
}
