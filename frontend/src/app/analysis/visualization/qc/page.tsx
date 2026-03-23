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
              <div data-testid="total-psms" className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Total PSMs</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.total_psms?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div data-testid="total-proteins" className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Total Proteins</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.total_proteins?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div data-testid="average-cv" className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Average CV</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.average_cv?.toFixed(1) || 'N/A'}%
                </span>
              </div>
              <div data-testid="completeness-rate" className="bg-gray-50 rounded-lg p-3">
                <span className="text-sm text-gray-500">Completeness</span>
                <span className="ml-2 text-xl font-semibold text-gray-900">
                  {data.completeness_rate?.toFixed(1) || 'N/A'}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* QC Plots Grid */}
        {data ? (
          <>
            {/* PCA Variance Info */}
            {data.pca && (
              <div data-testid="pca-variance" className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">PCA Variance Explained</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-gray-500">PC1 Variance:</span>
                    <span className="ml-2 text-lg font-medium text-blue-600">
                      {data.pca.pc1_variance.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-500">PC2 Variance:</span>
                    <span className="ml-2 text-lg font-medium text-blue-600">
                      {data.pca.pc2_variance.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
            <QCPlots data={data} />
          </>
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
