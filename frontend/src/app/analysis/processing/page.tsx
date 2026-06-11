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
import { processingApi } from '@/lib/api-client';
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
  ChevronDown,
  ChevronUp,
} from 'lucide-react';


// Cancelled display component
const CancelledDisplay: React.FC<{
  onBack: () => void;
}> = ({ onBack }) => (
  <div data-testid="processing-cancelled" className="rounded-lg border border-border bg-surface p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-surface rounded-full">
        <X className="w-6 h-6 text-text-secondary" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-text-primary mb-2">
          Processing Cancelled
        </h3>
        <p className="text-text-secondary mb-4">
          The processing has been cancelled by the user.
        </p>
        <button
          data-testid="cancelled-back-btn"
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 bg-background border border-border hover:bg-surface text-text-primary rounded-lg font-medium transition-colors"
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
  <div data-testid="processing-error" className="rounded-lg border border-error/20 bg-error/5 p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-error/10 rounded-full">
        <AlertCircle className="w-6 h-6 text-error" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-error mb-2">
          Processing Failed
        </h3>
        <p className="text-error mb-4">
          An error occurred during step {error.step}: {error.stepName}
        </p>
        <div className="bg-background rounded-lg p-4 mb-4 border border-error/20">
          <p className="text-sm text-text-primary font-mono">
            {error.message}
          </p>
        </div>
        {error.suggestion && (
          <p data-testid="error-suggestion" className="text-sm text-warning mb-4">
            <strong>Suggestion:</strong> {error.suggestion}
          </p>
        )}
        <div className="flex items-center gap-3">
          {error.recoverable && (
            <button
              data-testid="retry-btn"
              onClick={onRetry}
              className="flex items-center gap-2 px-4 py-2 bg-error hover:bg-error/90 text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Processing
            </button>
          )}
          <button
            data-testid="error-back-btn"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 bg-background border border-border hover:bg-surface text-text-primary rounded-lg font-medium transition-colors"
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
  <div data-testid="processing-complete" className="rounded-lg border border-success/20 bg-success/5 p-6">
    <div className="flex items-start gap-4">
      <div className="p-3 bg-success/10 rounded-full">
        <CheckCircle2 className="w-6 h-6 text-success" />
      </div>
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-success mb-2">
          Processing Complete!
        </h3>
        <p className="text-success mb-4">
          All 8 steps have been completed successfully.
          {duration && (
            <span className="flex items-center gap-1 mt-1">
              <Clock className="w-4 h-4" />
              Total time: {formatDuration(duration)}
            </span>
          )}
        </p>
        <p className="text-sm text-success mb-4">
          Redirecting to visualization page in 2 seconds...
        </p>
        <button
          onClick={onNavigate}
          className="flex items-center gap-2 px-4 py-2 bg-success hover:bg-success/90 text-white rounded-lg font-medium transition-colors"
        >
          <FileText className="w-4 h-4" />
          View Results
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);

// Queued display component
function QueuedDisplay({ queuePosition, queueLength }: { queuePosition: number; queueLength: number }) {
  return (
    <div data-testid="processing-queued" className="mb-8">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-6 h-6 text-primary" />
            </div>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-primary mb-1">Queued for Processing</h3>
            <p className="text-sm text-primary mb-4">
              Another analysis is currently running. Your session is next in line.
            </p>
            <div className="flex items-center gap-3 text-sm text-primary">
              <div className="flex items-center gap-2">
                <span className="font-medium">Queue position:</span>
                <span className="text-lg font-bold">#{queuePosition}</span>
              </div>
              <span className="text-text-muted">|</span>
              <div>
                <span className="font-medium">{queueLength} session{queueLength !== 1 ? 's' : ''} waiting</span>
              </div>
            </div>
            <p className="text-xs text-text-muted mt-3">
              This page will automatically update when your analysis starts.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const removeRazor = searchParams.get('remove_razor') !== 'false'; // Default true

  const pipeline = (searchParams.get('pipeline') as 'msqrob2' | 'msstats') || 'msqrob2';
  const [startError, setStartError] = useState<string | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [statusCollapsed, setStatusCollapsed] = useState(false);

  const {
    logs,
    isConnected,
    isComplete,
    isCancelled,
    isQueued,
    queuePosition,
    queueLength,
    error,
    processingDuration,
    sessionId: storeSessionId,
    initializeSteps,
    setSessionId,
    setFirstStepProcessing,
    setCancelled,
    setLogs,
    setComplete,
    setQueued,
    clearQueued,
    syncStepProgress,
    retry,
    reset: resetStore,
  } = useProcessingStore();

  // Reset store when session ID changes — prevents state from leaking between sessions
  useEffect(() => {
    if (!sessionId) return;
    resetStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Initialize WebSocket connection
  useWebSocket(storeSessionId);

  // Always poll as safety net for completion detection (works alongside WebSocket)
  // Polling provides reliable fallback when WebSocket drops during long R processing.
  // Uses recursive setTimeout to prevent overlapping requests from racing on state.
  useEffect(() => {
    if (!sessionId || isComplete || error) return;

    let active = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!active) return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const logData = await processingApi.getLogs(sessionId);
        clearTimeout(timeoutId);

        if (!active) return;

        if (logData) {
          // Sync step progress from completed_steps and current_step
          if (logData.completed_steps && logData.current_step) {
            syncStepProgress(logData.completed_steps, logData.current_step);
          }

          // Check status endpoint for queue/processing state
          if (!isConnected) {
            try {
              const statusData = await processingApi.getStatus(sessionId);
              if (statusData.queue_position && statusData.queue_position > 0) {
                setQueued(statusData.queue_position, statusData.queue_length ?? 0);
              } else if (statusData.state === 'queued') {
                setQueued(1, 0);
              } else if (statusData.state === 'processing') {
                clearQueued();
              }
            } catch {
              // Status check failed, ignore
            }
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

          // Check if completed — this is the critical safety net
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
            return; // Stop polling
          }
        }
      } catch (err) {
        if (err instanceof TypeError && err.message.includes('fetch')) {
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Request timed out, will retry
        } else {
          console.error('Polling error:', err);
        }
      }

      if (active) {
        timeoutId = setTimeout(poll, 3000);
      }
    };

    timeoutId = setTimeout(poll, 3000);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [sessionId, isConnected, isComplete, error, setComplete, setLogs, syncStepProgress, setQueued, clearQueued]);

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
        const logData = await processingApi.getLogs(sessionId);

        // Initialize steps based on server state
        initializeSteps(removeRazor, pipeline);

        // Sync step progress from API (recovers missed WebSocket messages)
        if (logData.completed_steps && logData.current_step) {
          syncStepProgress(logData.completed_steps, logData.current_step);
        }

        // If no pipeline state yet, check status endpoint for queue/processing state
        if (!logData || (logData.completed_steps.length === 0 && logData.current_step === 0)) {
          try {
            const statusData = await processingApi.getStatus(sessionId);
            if (statusData.queue_position && statusData.queue_position > 0) {
              setQueued(statusData.queue_position, statusData.queue_length ?? 0);
            } else if (statusData.state === 'queued') {
              setQueued(1, 0);
            } else if (statusData.state === 'processing') {
              clearQueued();
            }
          } catch {
            // Status check failed, ignore
          }
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
        initializeSteps(removeRazor, pipeline);
        setFirstStepProcessing();
      }

      // Now set session ID in store — this triggers WebSocket connection
      // Steps are already synced to server state by this point
      setSessionId(sessionId);
    };

    initFromServer();
  }, [sessionId, removeRazor, pipeline, initializeSteps, syncStepProgress, setLogs, setSessionId, setComplete, setFirstStepProcessing, setQueued, clearQueued]);

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
      await processingApi.retry(sessionId);
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
      await processingApi.cancel(sessionId);
      setCancelled(true);
    } catch (err) {
      console.error('Failed to cancel processing:', err);
      // Still navigate back — the user wants to leave this page
      handleBack();
    } finally {
      setIsCancelling(false);
      setShowCancelDialog(false);
    }
  }, [sessionId, setCancelled, handleBack]);

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
      <div className="flex-1 bg-surface flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
          <h1 className="font-semibold text-text-primary mb-2">
            No Session ID
          </h1>
          <p className="text-text-secondary mb-4">
            Please start from the data input page.
          </p>
          <button
            onClick={() => router.push('/analysis')}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
          >
            Go to Data Input
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="processing-page" className="flex-1 bg-surface flex">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header - reduced z-index to prevent overlay */}
        <header className="sticky top-0 z-30 bg-surface border-b border-border">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-4">
                <button
                  onClick={handleBack}
                  className="p-2 text-text-muted hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Activity className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h1 className="font-semibold text-text-primary">
                      Processing Data
                    </h1>
                    <p className="text-xs text-text-muted">
                      Session: {sessionId.slice(0, 8)}...
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {!isComplete && !isCancelled && !error && !isQueued && (
                  <button
                    data-testid="cancel-processing-btn"
                    onClick={handleCancelClick}
                    disabled={isCancelling}
                    className="flex items-center gap-2 px-3 py-1.5 bg-error/10 text-error hover:bg-error/15 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
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
        <main className="w-full px-4 sm:px-6 lg:px-8 py-8">

          {/* Queued state */}
          {isQueued && (
            <QueuedDisplay queuePosition={queuePosition} queueLength={queueLength} />
          )}

          {/* Terminal state cards - collapsible */}
          {(error || isCancelled || isComplete || startError) && (
            <div className="mb-4">
              <button
                onClick={() => setStatusCollapsed(!statusCollapsed)}
                className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-2"
              >
                {statusCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                {statusCollapsed ? 'Show' : 'Hide'} processing status
              </button>
              {!statusCollapsed && (
                <div className="space-y-4">
                  {error && <ErrorDisplay error={error} onRetry={handleRetry} onBack={handleBack} />}
                  {isCancelled && !error && <CancelledDisplay onBack={handleBack} />}
                  {isComplete && !error && (
                    <CompletionDisplay duration={processingDuration} onNavigate={handleNavigateToResults} />
                  )}
                  {startError && !error && (
                    <div className="rounded-xl border border-warning/20 bg-warning/5 p-4">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-warning" />
                        <p className="text-warning">{startError}</p>
                        <button onClick={handleRetry}
                          className="ml-auto px-3 py-1.5 bg-warning hover:bg-warning/90 text-white text-sm rounded-lg transition-colors">
                          Retry
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Processing Logs */}
          <LogPanel logs={logs} maxHeight="600px" />
          {/* Cancel Confirmation Dialog */}
          {showCancelDialog && (
            <div data-testid="cancel-confirm-dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-background rounded-xl border border-border p-6 max-w-md w-full mx-4 shadow-2xl">
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                  Cancel Processing?
                </h3>
                <p className="text-text-secondary mb-6">
                  Are you sure you want to cancel the current processing? This action cannot be undone.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    data-testid="dismiss-cancel-btn"
                    onClick={handleDismissCancelDialog}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-background border border-border hover:bg-surface text-text-primary rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    No, Continue
                  </button>
                  <button
                    data-testid="confirm-cancel-btn"
                    onClick={handleConfirmCancel}
                    disabled={isCancelling}
                    className="px-4 py-2 bg-error hover:bg-error/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
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
    <Suspense fallback={<div className="flex-1 bg-surface flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-text-secondary">Loading...</p>
      </div>
    </div>}>
      <ProcessingContent />
    </Suspense>
  );
}
