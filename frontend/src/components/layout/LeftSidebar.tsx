/**
 * Left Sidebar - Amica-style Design
 * Contains file input options, upload sections, and session info
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Download,
  Upload,
  Info,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from './SidebarContext';

interface LeftSidebarProps {
  className?: string;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ className }) => {
  const { isExpanded } = useSidebar();
  const router = useRouter();

  return (
    <aside
      className={cn(
        'h-full bg-gray-50 border-r border-gray-200 overflow-y-auto transition-all duration-300',
        isExpanded ? 'w-[30%] min-w-[350px]' : 'w-0',
        className
      )}
    >
      <div className="p-6 space-y-6">
        {/* Tutorial and User Manual Buttons */}
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors text-sm font-medium">
            <Info className="w-4 h-4" />
            Tutorial
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors text-sm font-medium">
            <Download className="w-4 h-4" />
            User manual
          </button>
        </div>

        {/* File Input Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">File input</h3>
          <p className="text-sm text-gray-600">Select the file input.</p>
          
          {/* Radio button options */}
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="proteomicsviz" 
                defaultChecked 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Upload ProteomicsViz format</span>
            </label>
            
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="maxquant" 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Upload MaxQuant</span>
            </label>
            
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="fragpipe" 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Upload FragPipe</span>
            </label>
            
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="dia-nn" 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Upload DIA-NN</span>
            </label>
            
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="custom" 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Upload custom format</span>
            </label>
            
            <label className="flex items-center gap-3 p-2 rounded-md hover:bg-white cursor-pointer transition-colors">
              <input 
                type="radio" 
                name="fileFormat" 
                value="example" 
                className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
              />
              <span className="text-sm text-gray-700">Load in example</span>
            </label>
          </div>
        </div>

        {/* Description Text */}
        <div className="text-sm text-gray-600 leading-relaxed">
          <p>
            If &apos;ProteomicsViz&apos; is selected previous output gets loaded in. When &apos;MaxQuant&apos; 
            or &apos;FragPipe&apos; is selected, output can be processed. &apos;DIA-NN&apos; allows for 
            the upload of DIA-NN and Spectronaut output. Finally, if &apos;custom&apos; is selected any 
            tabular format can be uploaded, provided a &apos;specification&apos; file is uploaded. 
            Differential abundance gets computed with msqrob2.
          </p>
        </div>

        {/* Protein Groups Table Section */}
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-gray-900">1) protein groups table</h4>
            <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full">ProteomicsViz format</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Info className="w-4 h-4 text-emerald-600" />
            <span>e.g. PSM_ExperimentName_Condition_Replicate.csv</span>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" />
              Browse...
            </button>
            <span className="text-sm text-gray-500">No file selected</span>
          </div>
          
          <p className="text-sm text-gray-600">
            Have you run ProteomicsViz before? Input the output from a previous session.
          </p>
        </div>

        {/* Experimental Design Section */}
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-gray-900">2) Experimental design</h4>
            <Info className="w-4 h-4 text-emerald-600" />
          </div>
          
          <div className="text-sm text-gray-600">
            e.g. experiment_design.tsv
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" />
              Browse...
            </button>
            <span className="text-sm text-gray-500">No file selected</span>
          </div>
        </div>

        {/* Compound File Section */}
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-gray-900">3) Compound list (optional)</h4>
            <Info className="w-4 h-4 text-emerald-600" />
          </div>
          
          <div className="text-sm text-gray-600">
            e.g. compound_id.csv
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" />
              Browse...
            </button>
            <span className="text-sm text-gray-500">No file selected</span>
          </div>
          
          <p className="text-sm text-gray-600">
            Optional: List of compounds to highlight in results
          </p>
        </div>

        {/* Quick Actions */}
        <div className="pt-4 border-t border-gray-200 space-y-2">
          <button
            onClick={() => router.push('/analysis')}
            className="w-full flex items-center justify-between px-4 py-3 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 transition-colors text-sm font-medium"
          >
            <span>Start New Analysis</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default LeftSidebar;
