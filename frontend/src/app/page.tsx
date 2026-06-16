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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSessionStore } from '@/stores/sessionStore';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';

const workflowSteps = [
  {
    icon: Upload,
    label: 'Upload PSM files',
  },
  {
    icon: Sliders,
    label: 'Configure pipeline',
  },
  {
    icon: TrendingUp,
    label: 'Explore results',
  },
];

export default function HomePage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = React.useState(false);
  const addSession = useSessionStore((s) => s.addSession);
  const resetAnalysis = useAnalysisStore((s) => s.reset);
  const addToast = useUIStore((s) => s.addToast);

  const handleNewAnalysis = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const now = new Date();
      const name = `Analysis ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const newSession = await sessionsApi.create(name, 'multi_condition_comparison');
      resetAnalysis();
      addSession(newSession);
      router.push(`/new/upload?session=${newSession.id}`);
    } catch (e) {
      console.error('Failed to create session:', e);
      addToast('error', 'Failed to create analysis session. Please try again.');
    } finally {
      setIsCreating(false);
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

          {/* Primary CTA */}
          <div className="mb-8">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              leftIcon={isCreating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              onClick={handleNewAnalysis}
              disabled={isCreating}
              data-testid="new-analysis-btn"
            >
              New Analysis
            </Button>
            <p className="text-xs text-text-muted mt-2 text-center">
              Upload PSM data and start a new analysis session
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
