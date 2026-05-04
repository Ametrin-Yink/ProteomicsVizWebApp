/**
 * Home Page / Welcome Page
 *
 * Dashboard view with session manager and getting-started guide.
 * New analyses are started via the "+ New Analysis" button in the top navigation.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { SessionManager } from '@/components/session/SessionManager';
import {
  FlaskConical,
  Upload,
  GitBranch,
  Sliders,
  Play,
  ArrowRight,
  BookOpen,
} from 'lucide-react';

const steps = [
  {
    icon: Upload,
    title: 'Upload Files',
    description: 'Upload your PSM CSV files and configure experimental conditions',
  },
  {
    icon: GitBranch,
    title: 'Choose Pipeline',
    description: 'Select msqrob2 or MSstats for protein abundance and differential expression',
  },
  {
    icon: Sliders,
    title: 'Configure',
    description: 'Set pipeline-specific parameters and validation thresholds',
  },
  {
    icon: Play,
    title: 'Run Analysis',
    description: 'Start processing and monitor progress in real time',
  },
];

export default function HomePage() {
  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Panel - Dashboard */}
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
              A full-stack platform for proteomics data analysis and visualization
            </p>
          </div>

          {/* Getting Started */}
          <div data-testid="getting-started" className="mb-12">
            <h2 className="text-lg font-semibold text-text mb-6 text-center">
              How It Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {steps.map((step, idx) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    className="bg-background border border-border rounded-xl p-5 text-center relative"
                  >
                    <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="absolute -top-3 -left-3 w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                    <h3 className="text-sm font-semibold text-text mb-1">{step.title}</h3>
                    <p className="text-xs text-text-muted leading-relaxed">
                      {step.description}
                    </p>
                    {/* Connector arrow between steps */}
                    {idx < steps.length - 1 && (
                      <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-text-muted">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Call to action */}
          <div className="text-center p-8 bg-background border border-border rounded-xl">
            <p className="text-text-secondary mb-1">
              Click{' '}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary text-white text-sm rounded-md font-medium">
                + New Analysis
              </span>{' '}
              in the left sidebar to start a new analysis.
            </p>
            <p className="text-sm text-text-muted">
              Your existing sessions are shown in the left sidebar.
            </p>
          </div>

          {/* Help Section */}
          <div className="mt-8 text-center">
            <Link
              href="/about"
              data-testid="help-link"
              className="inline-flex items-center gap-2 text-sm text-secondary hover:text-secondary-dark font-medium transition-colors"
            >
              <BookOpen className="w-4 h-4" />
              View documentation
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
