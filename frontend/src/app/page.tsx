/**
 * Home Page / Dashboard
 *
 * Functional starting point with quick actions and workflow overview.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SessionManager } from '@/components/session/SessionManager';
import { MassSpecIcon } from '@/components/ui/MassSpecIcon';
import {
  Upload,
  Sliders,
  TrendingUp,
  BookOpen,
  Plus,
  ArrowRight,
  Loader2,
  Dna,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSessionStore } from '@/stores/sessionStore';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';

const workflowSteps = [
  {
    icon: Upload,
    label: 'Upload & configure',
  },
  {
    icon: Sliders,
    label: 'Set parameters',
  },
  {
    icon: TrendingUp,
    label: 'Explore results',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = React.useState<Record<string, boolean>>({});
  const addSession = useSessionStore((s) => s.addSession);
  const resetAnalysis = useAnalysisStore((s) => s.reset);
  const setAnalysisType = useAnalysisStore((s) => s.setAnalysisType);
  const addToast = useUIStore((s) => s.addToast);

  const handleCreateSession = async (type: 'tmt' | 'dia' | 'ptm') => {
    if (isCreating[type]) return;
    setIsCreating((prev) => ({ ...prev, [type]: true }));
    try {
      const now = new Date();
      const name = `Analysis ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const newSession = await sessionsApi.create(name, 'multi_condition_comparison');
      resetAnalysis();
      setAnalysisType(type);
      // Save file_type to backend session config
      await sessionsApi.updateConfig(newSession.id, {
        ...useAnalysisStore.getState().config,
        file_type: type === 'ptm' ? undefined : type,
      }).catch(() => {});
      addSession(newSession);
      router.push(`/new/upload?session=${newSession.id}&type=${type}`);
    } catch (e) {
      console.error('Failed to create session:', e);
      addToast('error', 'Failed to create analysis session. Please try again.');
    } finally {
      setIsCreating((prev) => ({ ...prev, [type]: false }));
    }
  };

  const handleNewAnalysis = async () => {
    if (isCreating['new']) return;
    setIsCreating((prev) => ({ ...prev, ['new']: true }));
    try {
      const now = new Date();
      const name = `Analysis ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const newSession = await sessionsApi.create(name, 'multi_condition_comparison');
      resetAnalysis();
      addSession(newSession);
      router.push(`/new/type?session=${newSession.id}`);
    } catch (e) {
      console.error('Failed to create session:', e);
      addToast('error', 'Failed to create analysis session. Please try again.');
    } finally {
      setIsCreating((prev) => ({ ...prev, ['new']: false }));
    }
  };

  return (
    <div className="flex w-full h-full">
      <SessionManager className="h-full" />

      <main className="flex-1 h-full overflow-y-auto bg-surface">
        <div className="max-w-2xl mx-auto px-6 py-10">
          {/* Brand */}
          <div className="flex items-center gap-3 mb-8" data-testid="welcome-title">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <MassSpecIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-text-primary">
                ProteomicsViz
              </h1>
              <p className="text-sm text-text-secondary">
                Proteomics data analysis platform
              </p>
            </div>
          </div>

          {/* Quick-start buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Button
              variant="primary"
              size="md"
              fullWidth
              leftIcon={isCreating['tmt'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              onClick={() => handleCreateSession('tmt')}
              disabled={isCreating['tmt']}
              data-testid="new-tmt-btn"
            >
              New TMT Analysis
            </Button>
            <Button
              variant="primary"
              size="md"
              fullWidth
              leftIcon={isCreating['dia'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dna className="w-4 h-4" />}
              onClick={() => handleCreateSession('dia')}
              disabled={isCreating['dia']}
              data-testid="new-dia-btn"
            >
              New DIA Analysis
            </Button>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              leftIcon={isCreating['ptm'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              onClick={() => handleCreateSession('ptm')}
              disabled={isCreating['ptm']}
              data-testid="new-ptm-btn"
            >
              New PTM Analysis
            </Button>
          </div>

          {/* Guided flow link */}
          <div className="mb-8 text-center">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={isCreating['new'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              onClick={handleNewAnalysis}
              disabled={isCreating['new']}
              data-testid="new-analysis-btn"
            >
              New Analysis (guided)
            </Button>
            <p className="text-xs text-text-muted mt-1">
              Choose analysis type step by step
            </p>
          </div>

          {/* Workflow overview */}
          <div data-testid="getting-started" className="mb-8">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
              Analysis workflow
            </h2>
            <div className="flex items-stretch gap-0 bg-background border border-border rounded-lg overflow-hidden">
              {workflowSteps.map((step, idx) => {
                const Icon = step.icon;
                return (
                  <React.Fragment key={step.label}>
                    <div className="flex-1 flex flex-col items-center gap-2 px-4 py-4 text-center">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-xs text-text-secondary leading-tight">
                        {step.label}
                      </span>
                    </div>
                    {idx < workflowSteps.length - 1 && (
                      <div className="flex items-center self-center text-text-muted flex-shrink-0">
                        <ArrowRight className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Documentation link */}
          <div className="text-center">
            <Link
              href="/about"
              data-testid="help-link"
              className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-secondary-dark font-medium transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              Documentation
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
