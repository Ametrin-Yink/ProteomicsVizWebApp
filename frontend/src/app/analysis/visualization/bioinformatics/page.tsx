'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import GSEADashboard from '@/components/visualization/GSEADashboard';
import PathwayTable from '@/components/visualization/PathwayTable';
import GSEAPlot from '@/components/visualization/GSEAPlot';
import type { GSEAData, GSEAResult, GSEADatabase } from '@/types/api';
import { GSEADatabaseLabels } from '@/types/api';
import { getGSEAData } from '@/lib/api';

const DATABASES: GSEADatabase[] = ['go_bp', 'go_mf', 'go_cc', 'kegg', 'reactome'];

function BioinformaticsContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [selectedDatabase, setSelectedDatabase] = useState<GSEADatabase>('go_bp');
  const [data, setData] = useState<GSEAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPathway, setSelectedPathway] = useState<GSEAResult | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      setSelectedPathway(null);
      try {
        const gseaData = await getGSEAData(sessionId, selectedDatabase);
        setData(gseaData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load GSEA data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedDatabase, sessionId]);

  if (loading) {
    return (
      <div data-testid="gsea-loading" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading GSEA results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="gsea-error" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading GSEA Data</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="bioinformatics-container" className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Bioinformatics</h1>
          <p className="text-gray-600 mt-2">
            Gene Set Enrichment Analysis (GSEA) results
          </p>
        </div>

        {/* Database Selector */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Select Database
          </label>
          <div data-testid="database-select" className="flex flex-wrap gap-2">
            {DATABASES.map((db) => (
              <button
                key={db}
                onClick={() => setSelectedDatabase(db)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedDatabase === db
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {GSEADatabaseLabels[db]}
              </button>
            ))}
          </div>
          <div data-testid="current-database" className="mt-2 text-sm text-gray-600">
            Current: {GSEADatabaseLabels[selectedDatabase]}
          </div>
        </div>

        {/* Content */}
        {data && data.results && Array.isArray(data.results) && data.results.length > 0 ? (
          <div className="space-y-8">
            {/* GSEA Dashboard */}
            <GSEADashboard
              data={data}
              selectedPathway={selectedPathway}
              onSelectPathway={setSelectedPathway}
            />

            {/* Pathway Details and Plot */}
            {selectedPathway && (
              <div className="w-full">
                <GSEAPlot pathway={selectedPathway} />
              </div>
            )}

            {/* Pathway Table */}
            <PathwayTable
              data={data.results}
              selectedPathway={selectedPathway}
              onSelectPathway={setSelectedPathway}
            />
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No GSEA data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BioinformaticsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <BioinformaticsContent />
    </Suspense>
  );
}
