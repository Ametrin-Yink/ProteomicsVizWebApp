'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import QCPlots from '@/components/visualization/QCPlots';
import type { QCData } from '@/types/api';
import { getQCData } from '@/lib/api';

function QCContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id') || searchParams.get('session') || '';

  const [data, setData] = useState<QCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const qcData = await getQCData(sessionId);
        setData(qcData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load QC data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId]);

  if (loading) {
    return (
      <div data-testid="qc-loading" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading QC plots...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="qc-error" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading QC Data</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">QC Plots</h1>
          <p className="text-gray-600 mt-2">
            Quality control visualizations for the proteomics analysis
          </p>
        </div>

        {/* QC Summary Statistics */}
        {data && (
          <div data-testid="qc-summary" className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">QC Summary Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* PSM Statistics */}
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Total Unique PSMs</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.total_psms?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Avg Unique PSMs/Sample</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.avg_psms_per_sample?.toLocaleString() || 'N/A'}
                </span>
              </div>

              {/* Protein Statistics */}
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Total Proteins</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.total_proteins?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Avg Proteins/Sample</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.avg_proteins_per_sample?.toLocaleString() || 'N/A'}
                </span>
              </div>

              {/* CV Statistics - MIN-010: Show separate Protein and PSM CV */}
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Avg Protein CV</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.average_protein_cv?.toFixed(1) || data.average_cv?.toFixed(1) || 'N/A'}%
                </span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Avg PSM CV</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.average_psm_cv?.toFixed(1) || 'N/A'}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* QC Plots Grid */}
        {data ? (
          <QCPlots data={data} />
        ) : (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">No QC data available</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QCPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <QCContent />
    </Suspense>
  );
}
