'use client';

import React, { useState } from 'react';
import ProteinCorrelationPanel from '@/components/visualization/compare/ProteinCorrelationPanel';
import ComparisonCorrelationPanel from '@/components/visualization/compare/ComparisonCorrelationPanel';
import ScalableComparisonCorrelationPanel from '@/components/visualization/compare/ScalableComparisonCorrelationPanel';

interface Props {
  comparisons: Array<{ value: string; label: string }>;
  scalableComparison?: boolean;
  onComparisonSearch?: (value: string) => void;
}

export default function ProteinCompareWorkspace({ comparisons, scalableComparison = false, onComparisonSearch }: Props) {
  const [activeTab, setActiveTab] = useState<'protein' | 'comparison'>(
    scalableComparison ? 'comparison' : 'protein',
  );

  return (
    <div className="space-y-6" data-testid="protein-compare-workspace">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('protein')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'protein'
              ? 'bg-primary/10 text-primary'
              : 'text-text-secondary hover:bg-surface hover:text-text-primary'
          }`}
        >
          Protein Correlation
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('comparison')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'comparison'
              ? 'bg-primary/10 text-primary'
              : 'text-text-secondary hover:bg-surface hover:text-text-primary'
          }`}
          disabled={comparisons.length < 2}
          title={comparisons.length < 2 ? 'Need at least 2 comparisons' : undefined}
        >
          Comparison Correlation
        </button>
      </div>

      {activeTab === 'protein' ? (
        <ProteinCorrelationPanel comparisons={comparisons} />
      ) : (
        scalableComparison ? (
          <ScalableComparisonCorrelationPanel comparisons={comparisons} onComparisonSearch={onComparisonSearch} />
        ) : (
          <ComparisonCorrelationPanel comparisons={comparisons} />
        )
      )}
    </div>
  );
}
