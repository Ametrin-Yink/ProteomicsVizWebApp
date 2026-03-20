'use client';

import React, { useState, useCallback } from 'react';
import { FileDown, X, Eye, Mail, RotateCcw, Loader2 } from 'lucide-react';
import { reportsApi } from '@/lib/api-client';

interface PDFExportProps {
  sessionId: string;
}

type PDFStatus = 'idle' | 'generating' | 'ready' | 'error' | 'cancelled';

export default function PDFExport({ sessionId }: PDFExportProps) {
  const [status, setStatus] = useState<PDFStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [reportId, setReportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const handleExport = useCallback(async () => {
    setStatus('generating');
    setProgress(0);
    setErrorMessage('');

    // Simulate progress updates
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + 10;
      });
    }, 500);

    try {
      const response = await reportsApi.generate(sessionId);
      clearInterval(progressInterval);
      setProgress(100);
      setReportId(response.report_id);
      setStatus('ready');
    } catch (error) {
      clearInterval(progressInterval);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'PDF generation failed');
    }
  }, [sessionId]);

  const handleCancel = useCallback(() => {
    setStatus('cancelled');
    setProgress(0);
    setReportId(null);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!reportId) return;

    try {
      const blob = await reportsApi.download(sessionId, reportId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `proteomics-analysis-report-${sessionId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Download failed');
    }
  }, [sessionId, reportId]);

  const handlePreview = useCallback(() => {
    setShowPreview(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
  }, []);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMessage('');
    handleExport();
  }, [handleExport]);

  const handleEmail = useCallback(() => {
    // Email functionality placeholder
    alert('Email feature coming soon!');
  }, []);

  // Idle state - show export button
  if (status === 'idle') {
    return (
      <button
        data-testid="export-pdf-btn"
        onClick={handleExport}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Export PDF
      </button>
    );
  }

  // Generating state - show progress
  if (status === 'generating') {
    return (
      <div data-testid="pdf-generating" className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating PDF...</span>
        </div>
        <div data-testid="pdf-progress" className="text-sm text-gray-600">
          {progress}%
        </div>
        <button
          data-testid="cancel-pdf-btn"
          onClick={handleCancel}
          className="flex items-center gap-1 px-3 py-1 text-sm text-red-600 hover:text-red-800 transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    );
  }

  // Ready state - show download and preview buttons
  if (status === 'ready') {
    return (
      <div data-testid="pdf-ready" className="flex items-center gap-2">
        <button
          data-testid="download-pdf-btn"
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Download PDF
        </button>
        <button
          data-testid="preview-pdf-btn"
          onClick={handlePreview}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
        <button
          data-testid="email-pdf-btn"
          onClick={handleEmail}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Mail className="w-4 h-4" />
          Email
        </button>

        {showPreview && (
          <div
            data-testid="pdf-preview-modal"
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={handleClosePreview}
          >
            <div
              className="bg-white rounded-lg w-[90vw] h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold">PDF Preview</h3>
                <button
                  data-testid="close-preview-btn"
                  onClick={handleClosePreview}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div data-testid="pdf-viewer" className="flex-1 p-4 bg-gray-100">
                <div className="w-full h-full bg-white rounded-lg shadow-sm flex items-center justify-center">
                  <p className="text-gray-500">PDF preview will be displayed here</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Cancelled state
  if (status === 'cancelled') {
    return (
      <div data-testid="pdf-cancelled" className="flex items-center gap-4">
        <span className="text-amber-600">PDF generation cancelled</span>
        <button
          data-testid="export-pdf-btn"
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div data-testid="pdf-error" className="flex items-center gap-4">
        <span className="text-red-600">PDF generation failed: {errorMessage}</span>
        <button
          data-testid="retry-pdf-btn"
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return null;
}
