/**
 * Welcome Page
 * Landing page for new users with getting started info
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  FlaskConical,
  Upload,
  Settings,
  BarChart3,
  Play,
  ChevronRight
} from 'lucide-react';
import { SessionManager } from '@/components/session/SessionManager';

export default function WelcomePage() {
  const router = useRouter();

  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - Session Manager */}
      <SessionManager className="h-full" />

      {/* Right Content Area - Welcome Info */}
      <main className="flex-1 h-full overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto px-12 py-16">
          {/* Hero Section */}
          <div className="text-center mb-16">
            {/* Logo */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#E73564] to-[#00ADEF] flex items-center justify-center shadow-lg">
                <FlaskConical className="w-10 h-10 text-white" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              Welcome to <span className="text-cyan-600">ProteomicsViz</span>
            </h1>
            
            {/* Subtitle */}
            <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
              Analyze and visualize proteomics data with our powerful 9-step processing pipeline. 
              From raw PSM data to differential expression and pathway analysis.
            </p>

            {/* CTA Button */}
            <button
              onClick={() => router.push('/analysis')}
              className="inline-flex items-center gap-3 px-8 py-4 bg-cyan-600 text-white rounded-xl font-semibold text-lg hover:bg-cyan-700 transition-all shadow-lg hover:shadow-xl"
            >
              <Play className="w-5 h-5" />
              Start New Analysis
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <FeatureCard
              icon={<Upload className="w-8 h-8 text-cyan-600" />}
              title="Easy Data Upload"
              description="Upload PSM CSV files with automatic parsing of experiment, condition, and replicate information."
            />
            <FeatureCard
              icon={<Settings className="w-8 h-8 text-cyan-600" />}
              title="Flexible Configuration"
              description="Set treatment and control conditions, choose organism, and configure filtering options."
            />
            <FeatureCard
              icon={<BarChart3 className="w-8 h-8 text-cyan-600" />}
              title="Rich Visualizations"
              description="Generate volcano plots, QC metrics, pathway enrichment analysis, and more."
            />
          </div>

          {/* Workflow Steps */}
          <div className="bg-gray-50 rounded-2xl p-8 mb-16">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
              Analysis Workflow
            </h2>
            <div className="space-y-4">
              <WorkflowStep number={1} title="Upload Data" description="Upload PSM CSV files (PSM_Experiment_Condition_Replicate.csv)" />
              <WorkflowStep number={2} title="Configure Analysis" description="Select treatment, control, organism, and filtering options" />
              <WorkflowStep number={3} title="Run Processing" description="9-step pipeline including normalization, statistical testing, and QC" />
              <WorkflowStep number={4} title="Explore Results" description="Visualize differential expression, pathways, and quality metrics" />
            </div>
          </div>

          {/* Requirements */}
          <div className="bg-blue-50 rounded-2xl p-8 mb-16">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Data Requirements
            </h2>
            <ul className="space-y-3 text-gray-700">
              <li className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span>Minimum 6 PSM CSV files (3 replicates per condition)</span>
              </li>
              <li className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span>Exactly 2 experimental conditions for comparison</span>
              </li>
              <li className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span>Filename format: PSM_ExperimentName_Condition_ReplicateNumber.csv</span>
              </li>
              <li className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span>Maximum file size: 500MB per file</span>
              </li>
              <li className="flex items-start gap-3">
                <ChevronRight className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
                <span>Optional: Compound list CSV with Corp ID for structure display</span>
              </li>
            </ul>
          </div>

          {/* Footer */}
          <div className="text-center text-gray-500 text-sm">
            <p>ProteomicsViz version 1.0.0</p>
            <p className="mt-1">Powered by msqrob2 & Bioconductor</p>
          </div>
        </div>
      </main>
    </div>
  );
}

// Feature Card Component
const FeatureCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
    <div className="mb-4">{icon}</div>
    <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-600 text-sm">{description}</p>
  </div>
);

// Workflow Step Component
const WorkflowStep: React.FC<{
  number: number;
  title: string;
  description: string;
}> = ({ number, title, description }) => (
  <div className="flex items-start gap-4">
    <div className="w-10 h-10 rounded-full bg-cyan-600 text-white flex items-center justify-center font-bold flex-shrink-0">
      {number}
    </div>
    <div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-gray-600 text-sm">{description}</p>
    </div>
  </div>
);
