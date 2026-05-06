'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ProteinCorrelationPanel from '@/components/visualization/compare/ProteinCorrelationPanel';
import ComparisonCorrelationPanel from '@/components/visualization/compare/ComparisonCorrelationPanel';
import { getSession } from '@/lib/api';
import { formatGroup } from '@/lib/utils';

function CompareContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [activeTab, setActiveTab] = useState<'protein' | 'comparison'>('protein');
  const [comparisons, setComparisons] = useState<Array<{ value: string; label: string }>>([]);
  const [comparisonCount, setComparisonCount] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((session) => {
      const comps = session?.config?.comparisons;
      if (comps && comps.length > 0) {
        const list = comps.map((c) => ({
          value: `${formatGroup(c.group1)}_vs_${formatGroup(c.group2)}`,
          label: `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`,
        }));
        setComparisons(list);
        setComparisonCount(list.length);
      }
    }).catch(() => {});
  }, [sessionId]);

  if (!sessionId) {
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

        <div className="flex gap-2 mb-6">
          <button
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
            onClick={() => setActiveTab('comparison')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'comparison'
                ? 'bg-primary/10 text-primary'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
            disabled={comparisonCount < 2}
            title={comparisonCount < 2 ? 'Need at least 2 comparisons' : undefined}
          >
            Comparison Correlation
          </button>
        </div>

        {activeTab === 'protein' ? (
          <ProteinCorrelationPanel sessionId={sessionId} comparisons={comparisons} />
        ) : (
          <ComparisonCorrelationPanel sessionId={sessionId} comparisons={comparisons} />
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
      </div>
    }>
      <CompareContent />
    </Suspense>
  );
}
