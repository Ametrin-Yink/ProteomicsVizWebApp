'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import PTMCompare from '@/components/visualization/PTMCompare';
import ProteinCompareWorkspace from '@/components/visualization/compare/ProteinCompareWorkspace';
import { getDataSource } from '@/lib/api-client';
import { useApi } from '@/lib/api-context';
import { formatGroup } from '@/lib/utils';
import { VisualizationPipelineWorkspace } from '@/components/visualization/VisualizationPipelineWorkspace';

function CompareContent() {
  const { apiPrefix } = useApi();

  const [comparisons, setComparisons] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    if (!apiPrefix) return;
    getDataSource(apiPrefix).then((session) => {
      const comps = session?.config?.comparisons;
      if (comps && comps.length > 0) {
        const list = comps.map((c) => ({
          value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
          label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
        }));
        setComparisons(list);
      }
    }).catch(() => {});
  }, [apiPrefix]);

  if (!apiPrefix) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <Link href="/" className="text-primary hover:opacity-80">Start New Analysis</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">Compare Analysis</h1>
        </div>

        <ProteinCompareWorkspace comparisons={comparisons} />
      </div>
    </div>
  );
}

export { CompareContent };

function VisualizationCompareContent() {
  return (
    <VisualizationPipelineWorkspace
      renderPTM={(sessionId) => (
        <div className="flex-1 bg-surface">
          <div className="mx-auto max-w-7xl px-6 py-8">
            <div className="mb-6">
              <h1 className="font-semibold text-text-primary">Compare Analysis</h1>
            </div>
            <PTMCompare sessionId={sessionId} />
          </div>
        </div>
      )}
    >
      <CompareContent />
    </VisualizationPipelineWorkspace>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
      </div>
    }>
      <VisualizationCompareContent />
    </Suspense>
  );
}
