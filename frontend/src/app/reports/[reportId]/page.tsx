'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { ChartScatter, Activity, Spline, GitCompare, ChartNetwork, Loader2, AlertCircle, Share2 } from 'lucide-react';
import { ApiProvider } from '@/lib/api-context';
import { reportApiPrefix } from '@/lib/api-client';
import { VisualizationManifestProvider } from '@/lib/visualization-context';
import type { VisualizationManifest } from '@/types/api';
import PTMVolcano from '@/components/visualization/PTMVolcano';
import PTMQCWorkspace from '@/components/visualization/PTMQCWorkspace';

import { ResultsContent } from '@/app/analysis/visualization/page';
import { QCContent } from '@/app/analysis/visualization/qc/page';
import { GSEAAnalysisContent } from '@/app/analysis/visualization/gsea/page';
import { CompareContent } from '@/app/analysis/visualization/compare/page';
import { BioNetContent } from '@/app/analysis/visualization/bionet/page';

const TABS = [
  { id: 'volcano', label: 'Volcano Plot', icon: ChartScatter },
  { id: 'qc', label: 'QC Plots', icon: Activity },
  { id: 'gsea', label: 'GSEA Analysis', icon: Spline },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'bionet', label: 'BioNet', icon: ChartNetwork },
] as const;

type TabId = (typeof TABS)[number]['id'];

function ReportViewerContent() {
  const params = useParams();
  const shareToken = params.reportId as string;
  const apiPrefix = reportApiPrefix(shareToken);

  const [reportMeta, setReportMeta] = useState<{
    name: string; session_name: string; created_at: string; pipeline: string;
  } | null>(null);
  const [manifest, setManifest] = useState<VisualizationManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('volcano');

  useEffect(() => {
    if (!shareToken) return;
    Promise.all([
      fetch(apiPrefix),
      fetch(`${apiPrefix}/visualization/manifest`),
    ])
      .then(async ([reportResponse, manifestResponse]) => {
        if (!reportResponse.ok || !manifestResponse.ok) throw new Error('Report not found');
        return Promise.all([reportResponse.json(), manifestResponse.json()]);
      })
      .then(([data, manifestResponse]) => {
        setReportMeta({
          name: data._report?.name || data.name || '',
          session_name: data._report?.session_name || '',
          created_at: data._report?.created_at || '',
          pipeline: data.pipeline || '',
        });
        setManifest(manifestResponse.data ?? manifestResponse);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [shareToken, apiPrefix]);

  if (loading) {
    return (
      <div className="h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-text-secondary">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error || !reportMeta || !manifest) {
    return (
      <div className="h-screen bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-6 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-error mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-error mb-2">Error Loading Report</h2>
          <p className="text-sm text-error/80">{error || 'Report not found'}</p>
          <p className="mt-3 text-xs text-text-muted">Ask the sender for a current report link.</p>
        </div>
      </div>
    );
  }

  const visibleTabs = reportMeta.pipeline === 'ptm'
    ? TABS.filter((tab) => tab.id === 'volcano' || tab.id === 'qc')
    : TABS;

  return (
    <VisualizationManifestProvider state={{ status: 'ready', manifest }}>
      <ApiProvider apiPrefix={apiPrefix} scope="shared-report">
      <div className="h-screen bg-surface flex flex-col">
        <div className="bg-background border-b border-border px-6 py-3 shrink-0">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">{reportMeta.name}</h1>
              <p className="text-xs text-text-muted">
                {reportMeta.session_name} &middot;{' '}
                {new Date(reportMeta.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
              <Share2 className="h-3.5 w-3.5" /> Shared report
            </div>
          </div>
        </div>

        <div className="bg-background border-b border-border shrink-0">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center py-2">
              <div className="flex items-center gap-1">
                {visibleTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'bg-primary/5 text-primary'
                          : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'volcano' && (reportMeta.pipeline === 'ptm' ? (
            <div className="mx-auto max-w-7xl px-6 py-8">
              <PTMVolcano
                sessionId={shareToken}
                apiPrefix={apiPrefix}
                canPersistVisualizationState={false}
              />
            </div>
          ) : <ResultsContent />)}
          {activeTab === 'qc' && (reportMeta.pipeline === 'ptm' ? (
            <div className="mx-auto max-w-7xl px-6 py-8">
              <PTMQCWorkspace sessionId={shareToken} apiPrefix={apiPrefix} />
            </div>
          ) : <QCContent />)}
          {activeTab === 'gsea' && <GSEAAnalysisContent />}
          {activeTab === 'compare' && <CompareContent />}
          {activeTab === 'bionet' && <BioNetContent />}
        </div>
      </div>
      </ApiProvider>
    </VisualizationManifestProvider>
  );
}

export default function ReportViewerPage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    }>
      <ReportViewerContent />
    </Suspense>
  );
}
