'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BarChart3, Activity, Dna } from 'lucide-react';
import PDFExport from '@/components/visualization/PDFExport';
import { SessionManager } from '@/components/session/SessionManager';

const tabs = [
  {
    id: 'results',
    label: 'Results',
    href: '/analysis/visualization',
    icon: BarChart3,
  },
  {
    id: 'qc',
    label: 'QC Plots',
    href: '/analysis/visualization/qc',
    icon: Activity,
  },
  {
    id: 'bioinformatics',
    label: 'Bioinformatics',
    href: '/analysis/visualization/bioinformatics',
    icon: Dna,
  },
];

function Navigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  // Determine active tab from pathname
  const getActiveTab = () => {
    if (pathname.includes('/qc')) return 'qc';
    if (pathname.includes('/bioinformatics')) return 'bioinformatics';
    return 'results';
  };

  const activeTab = getActiveTab();

  return (
    <div className="bg-background border-b border-border sticky top-0 z-10">
      <div className="mx-auto px-6">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <Link
                  key={tab.id}
                  href={`${tab.href}?session_id=${sessionId}`}
                  data-testid={`${tab.id}-tab`}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/5 text-primary'
                      : 'text-text-secondary hover:bg-surface hover:text-text'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <PDFExport sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

export default function VisualizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm px-6 pt-3">
          <a href="/" className="text-text-secondary hover:text-text">Home</a>
          <span className="text-text-muted">/</span>
          <a href="/analysis" className="text-text-secondary hover:text-text">Analysis</a>
          <span className="text-text-muted">/</span>
          <span className="text-text font-medium">Results</span>
        </nav>

        {/* Navigation Bar */}
        <Suspense fallback={<div className="bg-background border-b border-border h-14" />}>
          <Navigation />
        </Suspense>

        {/* Page Content */}
        {children}
      </div>
    </div>
  );
}
