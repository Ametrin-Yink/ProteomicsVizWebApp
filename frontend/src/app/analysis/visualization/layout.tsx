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
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4">
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
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 px-4 pt-4">
          <a href="/" className="hover:text-gray-700">Home</a>
          <span>/</span>
          <a href="/analysis" className="hover:text-gray-700">Analysis</a>
          <span>/</span>
          <span className="text-gray-700">Results</span>
        </nav>

        {/* Navigation Bar */}
        <Suspense fallback={<div className="bg-white border-b border-gray-200 h-14" />}>
          <Navigation />
        </Suspense>

        {/* Page Content */}
        {children}
      </div>
    </div>
  );
}
