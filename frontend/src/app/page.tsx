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
import { BookOpen, Loader2, Dna, BarChart3, FlaskConical } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';

const workflowCards = [
  {
    type: 'tmt' as const,
    title: 'TMT Analysis',
    description:
      'Multiplexed protein comparison across up to 16 samples in a single run. Powered by MSstats.',
    icon: BarChart3,
  },
  {
    type: 'dia' as const,
    title: 'DIA Analysis',
    description:
      'Label-free complete proteome profiling. Requires 2+ files. Powered by msqrob2 with batch correction.',
    icon: Dna,
  },
  {
    type: 'ptm' as const,
    title: 'PTM Analysis',
    description:
      'Post-translational modification analysis. Upload enrichment data to study site-level regulation.',
    icon: FlaskConical,
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
        file_type: type === 'ptm' ? 'tmt' : type,
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

  return (
    <div className="flex w-full h-full">
      <SessionManager className="h-full" />

      <main className="flex-1 h-full overflow-y-auto bg-surface">
        <div className="max-w-4xl mx-auto px-6 py-10">
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

          {/* Workflow cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {workflowCards.map((card) => {
              const Icon = card.icon;
              const loading = isCreating[card.type];
              return (
                <button
                  key={card.type}
                  onClick={() => handleCreateSession(card.type)}
                  disabled={loading}
                  data-testid={`new-${card.type}-btn`}
                  className="relative text-left p-6 rounded-xl border-2 border-border bg-background
                    hover:border-primary/30 hover:shadow-sm transition-all duration-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                    flex flex-col items-start gap-3"
                >
                  {loading ? (
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  ) : (
                    <Icon className="w-8 h-8 text-primary" />
                  )}
                  <h3 className="text-lg font-semibold text-text-primary">{card.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{card.description}</p>
                </button>
              );
            })}
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
