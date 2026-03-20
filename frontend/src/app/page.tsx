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
  FlaskConical, 
  Beaker, 
  Microscope, 
  Dna,
  ChevronRight,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Analysis templates
const templates = [
  {
    id: 'protein-pairwise',
    name: 'Protein Pair-wise Comparison Analysis',
    description: 'Compare protein abundance between two experimental conditions using statistical testing and visualization.',
    icon: FlaskConical,
    color: 'from-[#E73564] to-[#00ADEF]',
    available: true,
  },
  {
    id: 'multi-condition',
    name: 'Multi-Condition Analysis',
    description: 'Analyze protein expression across multiple experimental conditions.',
    icon: Beaker,
    color: 'from-gray-400 to-gray-500',
    available: false,
  },
  {
    id: 'time-course',
    name: 'Time Course Analysis',
    description: 'Track protein abundance changes over time.',
    icon: Microscope,
    color: 'from-gray-400 to-gray-500',
    available: false,
  },
  {
    id: 'pathway-enrichment',
    name: 'Pathway Enrichment Analysis',
    description: 'Identify enriched biological pathways from differential expression results.',
    icon: Dna,
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
      const sessionName = `Analysis ${new Date().toLocaleString()}`;
      const newSession = await sessionsApi.create(sessionName, template.id);
      
      // Add to local store
      addSession(newSession);
      
      // Store in localStorage for persistence
      localStorage.setItem('currentSessionId', newSession.id);
      
      addToast({
        type: 'success',
        message: 'Session created successfully',
      });
      
      // Navigate to analysis page with session ID
      router.push(`/analysis?session=${newSession.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      addToast({
        type: 'error',
        message: `Failed to create session: ${message}`,
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Panel - Template Selection */}
      <main className="flex-1 h-full overflow-y-auto bg-gray-50">
        <div className="max-w-4xl mx-auto px-8 py-12">
          {/* Header */}
          <div className="text-center mb-12" data-testid="welcome-title">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#E73564] to-[#00ADEF] flex items-center justify-center shadow-lg">
              <FlaskConical className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome to <span className="text-cyan-600">ProteomicsViz</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Select an analysis template to get started with your proteomics data analysis.
            </p>
          </div>

          {/* Template Selection */}
          <div data-testid="template-section" className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Choose Analysis Type</h2>
            
            <div className="grid grid-cols-1 gap-4">
              {templates.map((template) => {
                const Icon = template.icon;
                const isHovered = hoveredTemplate === template.id;
                
                return (
                  <div
                    key={template.id}
                    data-testid={template.available ? 'template-protein-pairwise' : `template-other-${template.id}`}
                    className={cn(
                      'relative group cursor-pointer rounded-xl border-2 transition-all duration-200',
                      template.available 
                        ? 'bg-white border-gray-200 hover:border-cyan-500 hover:shadow-lg' 
                        : 'bg-gray-100 border-gray-200 opacity-75'
                    )}
                    onClick={() => handleTemplateSelect(template)}
                    onMouseEnter={() => setHoveredTemplate(template.id)}
                    onMouseLeave={() => setHoveredTemplate(null)}
                  >
                    <div className="flex items-start gap-4 p-6">
                      {/* Icon */}
                      <div className={cn(
                        'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0',
                        'bg-gradient-to-br',
                        template.color
                      )}>
                        <Icon className="w-7 h-7 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {template.name}
                          </h3>
                          {!template.available && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-gray-200 text-gray-600 rounded-full">
                              TBD
                            </span>
                          )}
                        </div>
                        <p className="text-gray-600 text-sm">
                          {template.description}
                        </p>
                      </div>

                      {/* Arrow */}
                      <div className={cn(
                        'flex-shrink-0 transition-transform duration-200',
                        isHovered && template.available ? 'translate-x-1' : ''
                      )}>
                        {template.available ? (
                          <ChevronRight className="w-6 h-6 text-cyan-600" />
                        ) : (
                          <Info className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>

                    {/* TBD Tooltip for unavailable templates */}
                    {!template.available && isHovered && (
                      <div 
                        data-testid="tbd-tooltip"
                        className="absolute inset-0 flex items-center justify-center bg-gray-100/90 rounded-xl"
                      >
                        <div className="text-center">
                          <span className="text-lg font-semibold text-gray-700">Coming Soon</span>
                          <p className="text-sm text-gray-500 mt-1">This analysis type is under development</p>
                        </div>
                      </div>
                    )}

                    {/* Loading overlay */}
                    {isCreating && template.available && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-xl">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin" />
                          <span className="text-sm font-medium text-cyan-600">Creating session...</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Help Section */}
          <div className="mt-12 text-center">
            <p className="text-sm text-gray-500">
              Need help getting started?{' '}
              <a 
                href="#docs" 
                data-testid="help-link"
                className="text-cyan-600 hover:text-cyan-700 font-medium"
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
