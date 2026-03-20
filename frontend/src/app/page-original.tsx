/**
 * Welcome Page
 * 
 * Landing page with analysis templates and session creation.
 */

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  FlaskConical, 
  ArrowRight, 
  Clock, 
  BarChart3, 
  Dna,
  Sparkles,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SessionManager } from '@/components/session/SessionManager';
import { SessionCreateDialog } from '@/components/session/SessionCreateDialog';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { AnalysisTemplate, Session } from '@/types/session';

// Analysis templates
const analysisTemplates = [
  {
    id: 'pairwise_comparison' as AnalysisTemplate,
    name: 'Protein Pair-wise Comparison',
    description: 'Compare protein expression levels between two experimental conditions. Ideal for treatment vs control studies.',
    icon: BarChart3,
    available: true,
    features: ['Volcano plots', 'Differential expression', 'Statistical testing'],
    color: 'from-[#E73564] to-[#FF6B8A]',
  },
  {
    id: 'time_series' as AnalysisTemplate,
    name: 'Time Series Analysis',
    description: 'Track protein expression changes over multiple time points. Perfect for kinetic studies.',
    icon: Clock,
    available: false,
    features: ['Trend analysis', 'Clustering', 'Trajectory visualization'],
    color: 'from-[#00ADEF] to-[#4DD4FF]',
  },
  {
    id: 'multi_condition' as AnalysisTemplate,
    name: 'Multi-Condition Analysis',
    description: 'Compare multiple conditions simultaneously. Great for complex experimental designs.',
    icon: Dna,
    available: false,
    features: ['Multi-way comparisons', 'ANOVA', 'Heatmaps'],
    color: 'from-violet-500 to-purple-500',
  },
  {
    id: 'custom' as AnalysisTemplate,
    name: 'Custom Analysis',
    description: 'Define your own analysis parameters and workflow for specialized research needs.',
    icon: Sparkles,
    available: false,
    features: ['Custom parameters', 'Flexible workflow', 'Advanced options'],
    color: 'from-amber-500 to-orange-500',
  },
];

// Stats data
const stats = [
  { label: 'Active Sessions', value: '0', color: 'text-[#E73564]' },
  { label: 'Completed', value: '0', color: 'text-emerald-500' },
  { label: 'Total Analyses', value: '0', color: 'text-[#00ADEF]' },
];

export default function WelcomePage() {
  const router = useRouter();
  const sidebar = useUIStore((state) => state.sidebar);
  const sessions = useSessionStore((state) => state.sessions);
  const { addSession } = useSessionStore();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<AnalysisTemplate | null>(null);
  const [hoveredTemplate, setHoveredTemplate] = React.useState<string | null>(null);

  // Calculate stats
  const activeSessions = sessions.filter((s) => 
    ['created', 'uploading', 'uploaded', 'processing'].includes(s.status)
  ).length;
  const completedSessions = sessions.filter((s) => s.status === 'completed').length;

  const currentStats = [
    { label: 'Active Sessions', value: activeSessions.toString(), color: 'text-[#E73564]' },
    { label: 'Completed', value: completedSessions.toString(), color: 'text-emerald-500' },
    { label: 'Total Analyses', value: sessions.length.toString(), color: 'text-[#00ADEF]' },
  ];

  // Handle template selection
  const handleTemplateClick = (templateId: AnalysisTemplate, available: boolean) => {
    if (!available) return;
    setSelectedTemplate(templateId);
    setIsCreateDialogOpen(true);
  };

  // Handle create session
  const handleCreateSession = async (
    name: string, 
    description: string, 
    template: AnalysisTemplate
  ) => {
    // Create mock session
    const newSession: Session = {
      id: `session-${Date.now()}`,
      name,
      description,
      status: 'created',
      currentStep: null,
      progress: 0,
      config: {
        name,
        description,
        template,
        conditions: [],
        replicates: {},
        parameters: {
          minPeptides: 2,
          minSamples: 2,
          log2FoldChangeThreshold: 1.0,
          pValueThreshold: 0.05,
          gseaDatabase: 'GO_Biological_Process_2021',
          gseaMinSize: 15,
          gseaMaxSize: 500,
          pcaComponents: 2,
          normalizationMethod: 'median',
          imputationMethod: 'knn',
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
      uploadedFiles: [],
      compoundFile: null,
      results: null,
    };

    addSession(newSession);
    router.push('/analysis');
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc]">
      {/* Session Manager Sidebar */}
      <SessionManager />

      {/* Main Content */}
      <main
        className={cn(
          'transition-all duration-300',
          sidebar.isOpen ? 'ml-80' : 'ml-16'
        )}
      >
        {/* Hero Section */}
        <section className="relative overflow-hidden">
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-white via-[#f8f9fc] to-[#E73564]/5" />
          
          {/* Decorative elements */}
          <div className="absolute top-20 right-20 w-64 h-64 bg-[#E73564]/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-40 w-48 h-48 bg-[#00ADEF]/10 rounded-full blur-3xl" />
          
          <div className="relative px-8 py-16">
            <div className="max-w-5xl">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#E73564]/10 text-[#E73564] text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                Proteomics Analysis Platform
              </div>

              {/* Title */}
              <h1 className="text-5xl font-bold text-[#1a1a2e] mb-6 leading-tight">
                Welcome to{' '}
                <span className="bg-gradient-to-r from-[#E73564] to-[#00ADEF] bg-clip-text text-transparent">
                  ProteomicsViz
                </span>
              </h1>

              {/* Description */}
              <p className="text-xl text-[#64748b] mb-8 max-w-2xl leading-relaxed">
                Analyze and visualize proteomics data with our powerful 9-step processing pipeline. 
                From raw PSM data to differential expression and pathway analysis.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4">
                <Button
                  variant="primary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-5 h-5" />}
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  Start New Analysis
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    const element = document.getElementById('templates');
                    element?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  View Templates
                </Button>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap gap-8 mt-12 pt-8 border-t border-[#e2e8f0]">
                {currentStats.map((stat) => (
                  <div key={stat.label}>
                    <p className={cn('text-3xl font-bold', stat.color)}>
                      {stat.value}
                    </p>
                    <p className="text-sm text-[#64748b]">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Templates Section */}
        <section id="templates" className="px-8 py-16">
          <div className="max-w-5xl">
            {/* Section header */}
            <div className="mb-10">
              <h2 className="text-2xl font-bold text-[#1a1a2e] mb-2">
                Analysis Templates
              </h2>
              <p className="text-[#64748b]">
                Choose a template to get started with your proteomics analysis
              </p>
            </div>

            {/* Templates grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {analysisTemplates.map((template) => {
                const Icon = template.icon;
                const isHovered = hoveredTemplate === template.id;
                
                return (
                  <Card
                    key={template.id}
                    variant="default"
                    isHoverable={template.available}
                    isInteractive={template.available}
                    padding="lg"
                    className={cn(
                      'relative overflow-hidden',
                      !template.available && 'opacity-60 cursor-not-allowed'
                    )}
                    onClick={() => handleTemplateClick(template.id, template.available)}
                    onMouseEnter={() => setHoveredTemplate(template.id)}
                    onMouseLeave={() => setHoveredTemplate(null)}
                  >
                    {/* Background gradient on hover */}
                    <div
                      className={cn(
                        'absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-500',
                        template.color,
                        isHovered && template.available && 'opacity-5'
                      )}
                    />

                    <div className="relative">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div
                          className={cn(
                            'w-14 h-14 rounded-xl flex items-center justify-center',
                            'bg-gradient-to-br',
                            template.color
                          )}
                        >
                          <Icon className="w-7 h-7 text-white" />
                        </div>
                        
                        {!template.available && (
                          <span className="px-3 py-1 text-xs font-medium bg-[#e2e8f0] text-[#64748b] rounded-full">
                            Coming Soon
                          </span>
                        )}
                        
                        {template.available && (
                          <ChevronRight
                            className={cn(
                              'w-5 h-5 text-[#94a3b8] transition-transform',
                              isHovered && 'translate-x-1 text-[#E73564]'
                            )}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <h3 className="text-lg font-semibold text-[#1a1a2e] mb-2">
                        {template.name}
                      </h3>
                      <p className="text-sm text-[#64748b] mb-4 leading-relaxed">
                        {template.description}
                      </p>

                      {/* Features */}
                      <div className="flex flex-wrap gap-2">
                        {template.features.map((feature) => (
                          <span
                            key={feature}
                            className="px-2.5 py-1 text-xs font-medium bg-[#f8f9fc] text-[#64748b] rounded-md"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Quick Start Section */}
        <section className="px-8 py-16">
          <div className="max-w-5xl">
            <Card variant="elevated" padding="lg" className="bg-gradient-to-br from-[#1a1a2e] to-[#2d2d44]">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    Ready to analyze your data?
                  </h3>
                  <p className="text-[#94a3b8]">
                    Upload your proteomics files and start the 9-step processing pipeline
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-5 h-5" />}
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  Create New Session
                </Button>
              </div>
            </Card>
          </div>
        </section>

        {/* Footer */}
        <footer className="px-8 py-8 border-t border-[#e2e8f0]">
          <div className="max-w-5xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#E73564] to-[#00ADEF] flex items-center justify-center">
                <FlaskConical className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-[#1a1a2e]">ProteomicsViz</span>
            </div>
            <p className="text-sm text-[#94a3b8]">
              Built with Next.js, React, and Python
            </p>
          </div>
        </footer>
      </main>

      {/* Create Session Dialog */}
      <SessionCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setSelectedTemplate(null);
        }}
        onCreate={handleCreateSession}
      />
    </div>
  );
}
