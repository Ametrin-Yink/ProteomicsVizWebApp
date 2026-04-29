/**
 * Analysis Page
 * Data Input & Configuration page for proteomics analysis
 */

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Play, ArrowLeft, Loader2 } from 'lucide-react';
import FileUploadZone from '@/components/analysis/FileUploadZone';
import ExperimentTable from '@/components/analysis/ExperimentTable';
import ValidationPanel from '@/components/analysis/ValidationPanel';
import CompoundDisplay from '@/components/analysis/CompoundDisplay';
import ConfigPanel from '@/components/analysis/ConfigPanel';
import { SessionManager } from '@/components/session/SessionManager';
import { useAnalysisStore, canStartAnalysis } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';

function AnalysisContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState<string>('');
  const [isCreatingSession, setIsCreatingSession] = useState(true);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  
  const state = useAnalysisStore();
  const { config, setConfig } = state;
  const canStart = canStartAnalysis(state);
  const { addToast } = useUIStore();
  
  // Reset analysis store when session ID changes
  const { reset: resetAnalysis } = useAnalysisStore();
  useEffect(() => {
    if (sessionId) {
      resetAnalysis();
    }
  }, [sessionId, resetAnalysis]);

  // Initialize session on mount
  useEffect(() => {
    const initSession = async () => {
      setIsCreatingSession(true);
      
      try {
        // First, check for session ID in URL query params (from home page template selection)
        const urlSessionId = searchParams.get('session');
        
        // Validate session ID - must be a valid UUID format, not "undefined" or invalid
        const isValidSessionId = (id: string | null) => id && 
          id !== 'undefined' && 
          id !== 'null' &&
          id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        
        let sessionIdToLoad: string | null = null;
        
        if (isValidSessionId(urlSessionId)) {
          sessionIdToLoad = urlSessionId;
        } else {
          // Try to restore from localStorage
          const storedSessionId = localStorage.getItem('currentSessionId');
          if (isValidSessionId(storedSessionId)) {
            sessionIdToLoad = storedSessionId;
            // Update URL to include the session ID
            router.replace(`/analysis?session=${storedSessionId}`);
          }
        }
        
        if (sessionIdToLoad) {
          try {
            // Try to get the session
            const session = await sessionsApi.get(sessionIdToLoad);
            setSessionId(session.id);
            localStorage.setItem('currentSessionId', session.id);

            // Redirect if session is already processing or completed
            if (session.status === 'processing') {
              router.replace(`/analysis/processing?session_id=${session.id}`);
              return;
            }
            if (session.status === 'completed') {
              router.replace(`/analysis/visualization?session_id=${session.id}`);
              return;
            }

            // Restore config if available (map AnalysisConfig to SessionConfig fields)
            if (session.config && 'conditions' in session.config) {
              const ac = session.config as { conditions?: string[] };
              if (ac.conditions && ac.conditions.length >= 2) {
                setConfig({
                  treatment: ac.conditions[1] || '',
                  control: ac.conditions[0] || '',
                });
              }
            }
            
            addToast('info', 'Session loaded');
            setIsCreatingSession(false);
            return;
          } catch {
            // Session not found, clear localStorage and redirect to home
            localStorage.removeItem('currentSessionId');
            addToast('error', 'Session not found. Please create a new analysis.');
            router.push('/');
            return;
          }
        } else if (urlSessionId) {
          // Invalid session ID in URL (e.g., "undefined", "null", or malformed)
          addToast('error', 'Invalid session. Please create a new analysis.');
          router.push('/');
          return;
        }
        
        // No session in URL or localStorage - redirect to home page to create one
        // Don't auto-create sessions to avoid spam
        addToast('info', 'Please select a template to start analysis');
        router.push('/');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize session';
        addToast('error', `Failed to initialize session: ${message}`);
        router.push('/');
      } finally {
        setIsCreatingSession(false);
      }
    };
    
    initSession();
    
    // Cleanup on unmount
    return () => {
      // Don't reset store on unmount to allow session persistence
    };
    // Only run on mount and when searchParams changes (URL query params)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  
  const handleStartAnalysis = async () => {
    if (!canStart || !sessionId) return;

    setIsStartingAnalysis(true);

    try {
      // Save configuration first
      try {
        await sessionsApi.updateConfig(sessionId, config);
      } catch (configError) {
        console.warn('Config update failed, continuing anyway:', configError);
      }

      // Start processing before navigating - backend will wait for WebSocket
      try {
        await processingApi.start(sessionId);
      } catch (processingError) {
        console.error('Failed to start processing:', processingError);
        addToast('error', 'Failed to start processing. Please try again.');
        setIsStartingAnalysis(false);
        return;
      }

      // Navigate to processing page - WebSocket will connect and receive updates
      router.push(`/analysis/processing?session_id=${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start analysis';
      addToast('error', `Failed to start analysis: ${message}`);
      setIsStartingAnalysis(false);
    }
  };
  
  const handleBack = () => {
    router.push('/');
  };
  
  if (isCreatingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-cyan-500 animate-spin" />
          <h2 className="text-xl font-semibold text-gray-900">Creating Session...</h2>
          <p className="text-gray-500 mt-2">Please wait while we set up your analysis</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-screen" />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  Data Input & Configuration
                </h1>
                <p className="text-sm text-gray-500">
                  Session: {sessionId ? `${sessionId.slice(0, 8)}...` : 'Creating...'}
                </p>
              </div>
            </div>
            
            <button
              data-testid="start-analysis-btn"
              onClick={handleStartAnalysis}
              disabled={!canStart || isStartingAnalysis}
              className={`
                inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium
                transition-all duration-200
                ${canStart && !isStartingAnalysis
                  ? 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm hover:shadow'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }
              `}
            >
              {isStartingAnalysis ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Analysis
                </>
              )}
            </button>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Data Input */}
          <div className="lg:col-span-2 space-y-8">
            {/* File Upload Section */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">1. Data Input</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Upload proteomics data files and optional compound information
                </p>
              </div>
              <div className="p-6">
                <FileUploadZone sessionId={sessionId} />
              </div>
            </section>
            
            {/* Experiment Table Section */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">2. Experiment Structure</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Review and select files for analysis
                </p>
              </div>
              <div className="p-6">
                <ExperimentTable />
              </div>
            </section>
            
            {/* Validation Section */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">3. Validation</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Check experiment setup requirements
                </p>
              </div>
              <div className="p-6">
                <ValidationPanel />
              </div>
            </section>
            
            {/* Compound Display Section */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">4. Compound Information</h2>
                <p className="text-sm text-gray-500 mt-1">
                  View compound structures matched to conditions
                </p>
              </div>
              <div className="p-6">
                <CompoundDisplay />
              </div>
            </section>
          </div>
          
          {/* Right Column - Configuration */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Configuration</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Set analysis parameters
                </p>
              </div>
              <div className="p-6">
                <ConfigPanel />
              </div>
              
              {/* Start Analysis Button (Mobile/Sticky) */}
              <div className="px-6 py-4 border-t border-gray-200 lg:hidden">
                <button
                  data-testid="start-analysis-btn"
                  onClick={handleStartAnalysis}
                  disabled={!canStart || isStartingAnalysis}
                  className={`
                    w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-medium
                    transition-all duration-200
                    ${canStart && !isStartingAnalysis
                      ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }
                  `}
                >
                  {isStartingAnalysis ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Start Analysis
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-cyan-500 animate-spin" />
          <h2 className="text-xl font-semibold text-gray-900">Loading...</h2>
        </div>
      </div>
    }>
      <AnalysisContent />
    </Suspense>
  );
}
