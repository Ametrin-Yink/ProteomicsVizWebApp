/**
 * Welcome Page - Amica-style Design
 * Three-panel layout: Top nav, Left sidebar, Right content
 */

'use client';

import React from 'react';
import { FlaskConical, Network, Dna, BarChart3 } from 'lucide-react';
import { LeftSidebar } from '@/components/layout/LeftSidebar';

export default function WelcomePage() {
  return (
    <div className="flex w-full h-full">
      {/* Left Sidebar - File Operations */}
      <LeftSidebar />

      {/* Right Content Area */}
      <main className="flex-1 h-full overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto px-12 py-16">
          {/* Logo and Network Visualization */}
          <div className="flex flex-col items-center justify-center mb-12">
            {/* Network/Graph Visualization */}
            <div className="relative w-64 h-48 mb-6">
              {/* Central node */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-cyan-500 rounded-full flex items-center justify-center shadow-lg z-10">
                <FlaskConical className="w-8 h-8 text-white" />
              </div>
              
              {/* Connected nodes */}
              <div className="absolute top-4 left-1/4 w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center shadow-md">
                <Dna className="w-6 h-6 text-white" />
              </div>
              <div className="absolute top-4 right-1/4 w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center shadow-md">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div className="absolute bottom-8 left-8 w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center shadow-md">
                <Network className="w-6 h-6 text-white" />
              </div>
              <div className="absolute bottom-8 right-8 w-12 h-12 bg-emerald-400 rounded-full flex items-center justify-center shadow-md">
                <Dna className="w-6 h-6 text-white" />
              </div>
              <div className="absolute top-1/2 right-4 w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center shadow-md">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              
              {/* Connection lines (SVG) */}
              <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
                <line x1="50%" y1="50%" x2="25%" y2="20%" stroke="#9CA3AF" strokeWidth="3" />
                <line x1="50%" y1="50%" x2="75%" y2="20%" stroke="#9CA3AF" strokeWidth="3" />
                <line x1="50%" y1="50%" x2="15%" y2="75%" stroke="#9CA3AF" strokeWidth="3" />
                <line x1="50%" y1="50%" x2="85%" y2="75%" stroke="#9CA3AF" strokeWidth="3" />
                <line x1="50%" y1="50%" x2="90%" y2="50%" stroke="#9CA3AF" strokeWidth="3" />
              </svg>
            </div>

            {/* Brand Name */}
            <h1 className="text-6xl font-bold text-gray-900 tracking-tight">
              proteomics<span className="text-cyan-600">viz</span>
            </h1>
          </div>

          {/* Description */}
          <div className="space-y-6 text-gray-700 leading-relaxed">
            <p className="text-lg">
              ProteomicsViz is an interactive and user-friendly web-based platform that accepts 
              proteomic input files from different sources and provides automatically generated 
              quality control, set comparisons, differential expression, biological network and 
              over-representation analysis on the basis of minimal user input.
            </p>

            <p className="text-lg">
              Upload the required input files (explained on the sidebar) and the full functionality 
              will be revealed.
            </p>
          </div>

          {/* How to cite section */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">How to cite us</h2>
            <p className="text-gray-700 leading-relaxed">
              Please cite ProteomicsViz Team (2024). ProteomicsViz: an interactive and user-friendly 
              web-platform for the analysis of proteomics data. 
              <a 
                href="https://github.com/proteomicsviz/proteomicsviz" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-cyan-600 hover:text-cyan-700 underline"
              >
                https://github.com/proteomicsviz/proteomicsviz
              </a>
            </p>
          </div>

          {/* Footer Info */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                ProteomicsViz version 1.0.0
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>Powered by</span>
                <span className="font-semibold text-cyan-600">msqrob2</span>
                <span>&</span>
                <span className="font-semibold text-cyan-600">Bioconductor</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
