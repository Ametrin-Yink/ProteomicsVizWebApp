/**
 * Processing Page
 * Real-time processing pipeline with WebSocket updates
 * Following AGENTS/10-processing-pipeline.md and AGENTS/11-websocket-protocol.md
 */

'use client';

import React, { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProcessingStore } from '@/stores/processing-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { processingAPI } from '@/lib/api';
import { LogPanel } from '@/components/processing/LogPanel';
import { SessionManager } from '@/components/session/SessionManager';
import { formatDuration } from '@/lib/utils';
import type { LogEntry } from '@/types/processing';

import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ArrowRight,
  Clock,
  FileText,
  X,
} from 'lucide-react';


// Cancelled display component
const CancelledDisplay: React.FC<{
  onBack: () => void;
}> = ({ onBack }) => (
  <div data-testid="processing-cancelled" className="rounded-xl border border-gray-200 bg-gray-50 p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-gray-100 rounded-full">
        <X className="w-6 h-6 text-gray-600" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Processing Cancelled
        </h3>
        <p className="text-gray-600 mb-4">
          The processing has been cancelled by the user.
        </p>
        <button
          data-testid="cancel-btn"
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Configuration
        </button>
      </div>
    </div>
  </div>
);

// Error display component
const ErrorDisplay: React.FC<{
  error: {
    step: number;
    stepName: string;
    message: string;
    recoverable: boolean;
    suggestion?: string;
  };
  onRetry: () => void;
  onBack: () => void;
}> = ({ error, onRetry, onBack }) => (
  <div data-testid="processing-error" className="rounded-xl border border-red-200 bg-red-50 p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-red-100 rounded-full">
        <AlertCircle className="w-6 h-6 text-red-600" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-red-900 mb-2">
          Processing Failed
        </h3>
        <p className="text-red-700 mb-4">
          An error occurred during step {error.step}: {error.stepName}
        </p>
        <div className="bg-white rounded-lg p-4 mb-4 border border-red-200">
          <p className="text-sm text-gray-700 font-mono">
            {error.message}
          </p>
        </div>
        {error.suggestion && (
          <p data-testid="error-suggestion" className="text-sm text-amber-600 mb-4">
            <strong>Suggestion:</strong> {error.suggestion}
          </p>
        )}
        <div className="flex items-center gap-3">
          {error.recoverable && (
            <button
              data-testid="retry-btn"
              onClick={onRetry}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Processing
            </button>
          )}
          <button
            data-testid="cancel-btn"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Configuration
          </button>
        </div>
      </div>
    </div>
  </div>
);

// Completion display component
const CompletionDisplay: React.FC<{
  duration: number | null;
  onNavigate: () => void;
}> = ({ duration, onNavigate }) => (
  <div data-testid="processing-complete" className="rounded-xl border border-green-200 bg-green-50 p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-green-100 rounded-full">
        <CheckCircle2 className="w-6 h-6 text-green-600" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-green-900 mb-2">
          Processing Complete!
        </h3>
        <p className="text-green-700 mb-4">
          All 9 steps have been completed successfully.
          {duration && (
            <span className="flex items-center gap-1 mt-1">
              <Clock className="w-4 h-4" />
              Total time: {formatDuration(duration)}
            </span>
          )}
        </p>
        <p className="text-sm text-green-600 mb-4">
          Redirecting to visualization page in 2 seconds...
        </p>
        <button
          onClick={onNavigate}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
        >
          <FileText className="w-4 h-4" />
          View Results
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);

function ProcessingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const removeRazor = searchParams.get('remove_razor') !== 'false'; // Default true

  const [startError, setStartError] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const {
    logs,
    isConnected,
    isComplete,
    isCancelled,
    error,
    processingDuration,
    sessionId: storeSessionId,
    initializeSteps,
    setSessionId,
    setFirstStepProcessing,
    setCancelled,
    setLogs,
    setComplete,
    syncStepProgress,
    retry,
  } = useProcessingStore();

  // Initialize WebSocket connection
  useWebSocket(storeSessionId);

  // Polling fallback when WebSocket is not connected
  useEffect(() => {
    if (!sessionId || isComplete || error) return;

    // Only poll if WebSocket is not connected
    if (isConnected) return;

    const pollInterval = setInterval(async () => {
      try {
        const logData = await processingAPI.getLogs(sessionId);
        if (logData) {
          // Sync step progress from completed_steps and current_step
          if (logData.completed_steps && logData.current_step) {
            syncStepProgress(logData.completed_steps, logData.current_step);
          }

          // Update logs
          if (logData.logs && logData.logs.length > 0) {
            const logEntries: LogEntry[] = logData.logs.map((log: {
              level: 'info' | 'warning' | 'error';
              message: string;
              timestamp: string;
              step?: number;
            }) => ({
              id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              level: log.level,
              message: log.message,
              timestamp: log.timestamp,
              step: log.step,
            }));
            setLogs(logEntries);
          }

          // Check if completed
          if (logData.is_complete) {
            setComplete({
              session_id: sessionId,
              outputs: (logData.outputs as {
                psm_abundances: string;
                protein_abundances: string;
                diff_expression: string;
                qc_results: string;
                gsea_results: string;
              } | undefined) ?? undefined,
              duration: 0,
            });
            clearInterval(pollInterval);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [sessionId, isConnected, isComplete, error, setComplete, setLogs, syncStepProgress]);

  // Note: Processing is started by the analysis page before navigation.
  // Retry is handled by the handleRetry callback below.
  // No auto-start on page load to avoid 409 conflicts with already-running sessions.

  // Initialize on mount
  useEffect(() => {
    if (!sessionId) return;

    // Fetch historical state FIRST, then initialize steps to match
    // This ensures we don't reset to all-not_started for an already-running session
    const initFromServer = async () => {
      try {
        const logData = await processingAPI.getLogs(sessionId);

        // Initialize steps based on server state
        initializeSteps(removeRazor);

        // Sync step progress from API (recovers missed WebSocket messages)
        if (logData.completed_steps && logData.current_step) {
          syncStepProgress(logData.completed_steps, logData.current_step);
        }

        if (logData.logs && logData.logs.length > 0) {
          // Convert backend logs to LogEntry format with IDs
          const logEntries: LogEntry[] = logData.logs.map((log) => ({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            level: log.level,
            message: log.message,
            timestamp: log.timestamp,
            step: log.step,
          }));
          setLogs(logEntries);
        }

        // Handle already-complete sessions
        if (logData.is_complete) {
          setComplete({
            session_id: sessionId,
            outputs: (logData.outputs as {
              psm_abundances: string;
              protein_abundances: string;
              diff_expression: string;
              qc_results: string;
              gsea_results: string;
            } | undefined) ?? undefined,
            duration: 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch initial state:', err);
        // Fallback: initialize fresh steps
        initializeSteps(removeRazor);
        setFirstStepProcessing();
      }

      // Now set session ID in store — this triggers WebSocket connection
      // Steps are already synced to server state by this point
      setSessionId(sessionId);
    };

    initFromServer();
  }, [sessionId, removeRazor, initializeSteps, syncStepProgress, setLogs, setSessionId, setComplete, setFirstStepProcessing]);

  // Note: Processing is started by the analysis page before navigation
  // This page only connects to WebSocket and displays progress
  // No need to call startProcessing here - it's already running

  // Auto-redirect on completion
  useEffect(() => {
    if (isComplete && sessionId) {
      const timer = setTimeout(() => {
        router.push(`/analysis/visualization?session_id=${sessionId}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, sessionId, router]);

  // Handlers
  const handleRetry = useCallback(async () => {
    if (!sessionId) return;

    setStartError(null);

    try {
      await processingAPI.retryProcessing(sessionId);
      // Reset store only after retry succeeds
      retry();
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : 'Failed to retry processing'
      );
    }
  }, [sessionId, retry]);

  const handleBack = useCallback(() => {
    router.push('/analysis');
  }, [router]);

  const handleCancelClick = useCallback(() => {
    setShowCancelDialog(true);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    if (!sessionId) return;

    setIsCancelling(true);
    try {
      await processingAPI.cancelProcessing(sessionId);
      setCancelled(true);
    } catch (err) {
      console.error('Failed to cancel processing:', err);
    } finally {
      setIsCancelling(false);
      setShowCancelDialog(false);
    }
  }, [sessionId, setCancelled]);

  const handleDismissCancelDialog = useCallback(() => {
    setShowCancelDialog(false);
  }, []);

  const handleNavigateToResults = useCallback(() => {
    if (sessionId) {
      router.push(`/analysis/visualization?session_id=${sessionId}`);
    }
  }, [sessionId, router]);

  // Validation
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            No Session ID
          </h1>
          <p className="text-gray-600 mb-4">
            Please start from the data input page.
          </p>
          <button
            onClick={() => router.push('/analysis')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Go to Data Input
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="processing-page" className="min-h-screen bg-gray-50 flex">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header - reduced z-index to prevent overlay */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleBack}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Activity className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold text-gray-900">
                      Processing Data
                    </h1>
                    <p className="text-xs text-gray-500">
                      Session: {sessionId.slice(0, 8)}...
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {/* Connection status - hidden as per user request */}
              {/* <ConnectionStatus isConnected={isConnected} /> */}
                {!isComplete && !isCancelled && !error && (
                  <button
                    data-testid="cancel-btn"
                    onClick={handleCancelClick}
                    disabled={isCancelling}
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    {isCancelling ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Error state */}
          {error && (
            <div className="mb-8">
              <ErrorDisplay
                error={error}
                onRetry={handleRetry}
                onBack={handleBack}
              />
            </div>
          )}

          {/* Cancelled state */}
          {isCancelled && !error && (
            <div className="mb-8">
              <CancelledDisplay onBack={handleBack} />
            </div>
          )}

          {/* Completion state */}
          {isComplete && !error && (
            <div className="mb-8">
              <CompletionDisplay
                duration={processingDuration}
                onNavigate={handleNavigateToResults}
              />
            </div>
          )}

          {/* Start error */}
          {startError && !error && (
            <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <p className="text-amber-700">{startError}</p>
                <button
                  onClick={handleRetry}
                  className="ml-auto px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded-lg transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Activity Log - full width */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Activity Log
            </h2>
            <LogPanel logs={logs} maxHeight="600px" />
          </div>
          {/* Cancel Confirmation Dialog */}
          {showCancelDialog && (
            <div data-testid="cancel-confirm-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-md w-full mx-4 shadow-2xl">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Cancel Processing?
                </h3>
                <p className="text-gray-600 mb-6">
                  Are you sure you want to cancel the current processing? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    data-testid="dismiss-cancel-btn"
                    onClick={handleDismissCancelDialog}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    No, Continue
                  </button>
                  <button
                    data-testid="confirm-cancel-btn"
                    onClick={handleConfirmCancel}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isCancelling && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    )}
                    Yes, Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    </div>}>
      <ProcessingContent />
    </Suspense>
  );
}
