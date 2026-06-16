'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const PLACEHOLDER_CONTENT: Record<string, { title: string; description: string }> = {
  volcano: {
    title: 'PTM Volcano Plot',
    description: 'PTM-specific differential expression volcano plot coming soon. This will visualize post-translational modification site-level fold changes and significance.',
  },
  qc: {
    title: 'PTM QC Plots',
    description: 'PTM quality control plots coming soon. This will provide modification-specific quality metrics and visualization.',
  },
  'site-abundance': {
    title: 'PTM Site Abundance',
    description: 'PTM site-level abundance analysis coming soon. This will show relative abundance of modified sites across conditions.',
  },
  results: {
    title: 'PTM Results',
    description: 'PTM analysis results table coming soon. This will display identified modification sites with statistical analysis.',
  },
  bionet: {
    title: 'PTM BioNet Network',
    description: 'PTM-specific protein-protein interaction network coming soon. This will show modification-aware interaction networks from INDRA database.',
  },
};

const DEFAULT_PLACEHOLDER = {
  title: 'PTM Analysis',
  description: 'PTM visualization tab coming soon.',
};

function PTMPlaceholderContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';
  const tab = searchParams.get('tab') || '';

  const content = PLACEHOLDER_CONTENT[tab] || DEFAULT_PLACEHOLDER;

  if (!sessionId) {
    return (
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <p className="text-lg text-text-primary font-medium mb-2">No session selected</p>
          <p className="text-sm text-text-muted mb-4">Create a new analysis to get started.</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            Start New Analysis
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      <div className="mx-auto px-6 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="font-semibold text-text-primary">{content.title}</h1>
        </div>
        <div className="bg-background rounded-lg border border-border p-8 text-center">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-primary/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-primary/40">&#8987;</span>
            </div>
            <h2 className="text-lg font-medium text-text-primary mb-2">
              Coming Soon
            </h2>
            <p className="text-text-secondary text-sm leading-relaxed">
              {content.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PTMPlaceholderPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading...</p>
        </div>
      </div>
    }>
      <PTMPlaceholderContent />
    </Suspense>
  );
}
