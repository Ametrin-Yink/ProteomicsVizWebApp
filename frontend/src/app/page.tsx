/**
 * Home Page / Welcome Page
 * 
 * Displays template selection for creating new analysis sessions.
 * Left panel: Session manager
 * Right panel: Template selection cards
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SessionManager } from '@/components/session/SessionManager';
import { useSessionStore } from '@/stores/sessionStore';
import { sessionsApi } from '@/lib/api-client';
import { useUIStore } from '@/stores/uiStore';
import {
  GitCompare,
  Layers,
  Timer,
  Route,
  ChevronRight,
  FlaskConical,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Analysis templates
const templates = [
  {
    id: 'protein_pairwise_comparison',
    name: 'Protein Pair-wise Comparison Analysis',
    description: 'Compare protein abundance between two experimental conditions using statistical testing and visualization.',
    icon: GitCompare,
    color: 'from-[#E73564] to-[#00ADEF]',
    available: true,
  },
  {
    id: 'msstats_pairwise_comparison',
    name: 'MSstats Pair-wise Comparison',
    description: 'Compare protein abundance between two conditions using MSstats statistical pipeline with advanced normalization and imputation.',
    icon: FlaskConical,
    color: 'from-[#8B5CF6] to-[#06B6D4]',
    available: true,
  },
  {
    id: 'deqms_pairwise_comparison',
    name: 'DEqMS Pair-wise Comparison',
    description: 'Compare protein expression using DEqMS with spectral-count-aware variance moderation for improved statistical accuracy.',
    icon: TrendingUp,
    color: 'from-[#10B981] to-[#059669]',
    available: true,
  },
  {
    id: 'multi-condition',
    name: 'Multi-Condition Analysis',
    description: 'Analyze protein expression across multiple experimental conditions.',
    icon: Layers,
    color: 'from-gray-400 to-gray-500',
    available: false,
  },
  {
    id: 'time-course',
    name: 'Time Course Analysis',
    description: 'Track protein abundance changes over time.',
    icon: Timer,
    color: 'from-gray-400 to-gray-500',
    available: false,
  },
  {
    id: 'pathway-enrichment',
    name: 'Pathway Enrichment Analysis',
    description: 'Identify enriched biological pathways from differential expression results.',
    icon: Route,
    color: 'from-gray-400 to-gray-500',
    available: false,
  },
];

export default function HomePage() {
  const router = useRouter();
  const { addSession } = useSessionStore();
  const { addToast } = useUIStore();
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Handle template selection
  const handleTemplateSelect = async (template: typeof templates[0]) => {
    if (!template.available) return;
    
    setIsCreating(true);
    
    try {
      // Create session via backend API
      const sessionName = `Analysis ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
      const newSession = await sessionsApi.create(sessionName, template.id);
      
      // Add to local store
      addSession(newSession);
      
      // Store in localStorage for persistence
      localStorage.setItem('currentSessionId', newSession.id);
      
      addToast('success', 'Session created successfully');

      // Navigate to analysis page with session ID
      router.push(`/analysis?session=${newSession.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      addToast('error', `Failed to create session: ${message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Panel - Template Selection */}
      <main className="flex-1 h-full overflow-y-auto bg-surface">
        <div className="max-w-4xl mx-auto px-8 py-12">
          {/* Header */}
          <div className="text-center mb-12" data-testid="welcome-title">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
              <FlaskConical className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-text mb-4">
              Welcome to <span className="text-primary">ProteomicsViz</span>
            </h1>
            <p className="text-xl text-text-secondary max-w-2xl mx-auto">
              Select an analysis template to get started with your proteomics data analysis.
            </p>
          </div>

          {/* Template Selection */}
          <div data-testid="template-section" className="space-y-4">
            <h2 className="text-lg font-semibold text-text mb-4">Choose Analysis Type</h2>
            
            <div className="grid grid-cols-1 gap-4">
              {templates
                .filter((t) => t.available)
                .map((template) => {
                  const Icon = template.icon;
                  const isHovered = hoveredTemplate === template.id;

                  return (
                    <div
                      key={template.id}
                      data-testid={`template-${template.id}`}
                      className={cn(
                        'relative group cursor-pointer rounded-xl border-2 transition-all duration-200',
                        'bg-background border-border hover:border-primary'
                      )}
                      onClick={() => handleTemplateSelect(template)}
                      onMouseEnter={() => setHoveredTemplate(template.id)}
                      onMouseLeave={() => setHoveredTemplate(null)}
                    >
                      <div className="flex items-start gap-4 p-6">
                        {/* Icon */}
                        <div className={cn(
                          'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0',
                          template.available ? 'bg-primary' : 'bg-border/30'
                        )}>
                          <Icon className="w-7 h-7 text-white" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-semibold text-text">
                              {template.name}
                            </h3>
                          </div>
                          <p className="text-text-secondary text-sm">
                            {template.description}
                          </p>
                        </div>

                        {/* Arrow */}
                        <div className={cn(
                          'flex-shrink-0 transition-transform duration-200',
                          isHovered ? 'translate-x-1' : ''
                        )}>
                          <ChevronRight className="w-6 h-6 text-primary" />
                        </div>
                      </div>

                      {/* Loading overlay */}
                      {isCreating && (
                        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 rounded-xl">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm font-medium text-primary">Creating session...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="mt-8 text-center">
              <p className="text-sm text-text-muted">
                More analysis types coming soon: Multi-Condition, Time Course, Pathway Enrichment
              </p>
            </div>
          </div>

          {/* Help Section */}
          <div className="mt-12 text-center">
            <p className="text-sm text-text-muted">
              Need help getting started?{' '}
              <a
                href="/about"
                data-testid="help-link"
                className="text-secondary hover:text-secondary-dark font-medium"
              >
                View documentation
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
