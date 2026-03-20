/**
 * File Operations Panel
 * Right panel for file upload and configuration
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Info, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FileOperations: React.FC = () => {
  const router = useRouter();
  const [selectedFormat, setSelectedFormat] = useState('proteomicsviz');

  const fileFormats = [
    { id: 'proteomicsviz', label: 'Upload ProteomicsViz format' },
    { id: 'maxquant', label: 'Upload MaxQuant' },
    { id: 'fragpipe', label: 'Upload FragPipe' },
    { id: 'dia-nn', label: 'Upload DIA-NN' },
    { id: 'custom', label: 'Upload custom format' },
    { id: 'example', label: 'Load in example' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-white p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Start New Analysis</h2>
          <p className="text-gray-600">Upload your proteomics data files to begin analysis</p>
        </div>

        {/* File Input Section */}
        <div className="bg-gray-50 rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">File input</h3>
          <p className="text-sm text-gray-600">Select the file input format.</p>
          
          {/* Radio button options */}
          <div className="space-y-2">
            {fileFormats.map((format) => (
              <label
                key={format.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors',
                  selectedFormat === format.id
                    ? 'bg-white border-2 border-cyan-500 shadow-sm'
                    : 'bg-white border-2 border-transparent hover:bg-gray-100'
                )}
              >
                <input
                  type="radio"
                  name="fileFormat"
                  value={format.id}
                  checked={selectedFormat === format.id}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                  className="w-4 h-4 text-cyan-600 border-gray-300 focus:ring-cyan-500"
                />
                <span className="text-sm text-gray-700">{format.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Description Text */}
        <div className="text-sm text-gray-600 leading-relaxed bg-blue-50 p-4 rounded-lg">
          <div className="flex items-start gap-2">
            <Info className="w-5 h-5 text-cyan-600 flex-shrink-0 mt-0.5" />
            <p>
              If &apos;ProteomicsViz&apos; is selected previous output gets loaded in. When &apos;MaxQuant&apos; 
              or &apos;FragPipe&apos; is selected, output can be processed. &apos;DIA-NN&apos; allows for 
              the upload of DIA-NN and Spectronaut output. Finally, if &apos;custom&apos; is selected any 
              tabular format can be uploaded, provided a &apos;specification&apos; file is uploaded. 
              Differential abundance gets computed with msqrob2.
            </p>
          </div>
        </div>

        {/* Protein Groups Table Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-gray-900">1) Protein groups table</h4>
            <span className="px-2 py-0.5 text-xs bg-cyan-100 text-cyan-700 rounded-full">
              Required
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Info className="w-4 h-4 text-cyan-600" />
            <span>e.g. PSM_ExperimentName_Condition_Replicate.csv</span>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm font-medium">
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
            <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded-full">
              Required
            </span>
          </div>
          
          <div className="text-sm text-gray-600">
            e.g. experiment_design.tsv
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm font-medium">
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
            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
              Optional
            </span>
          </div>
          
          <div className="text-sm text-gray-600">
            e.g. compound_id.csv
          </div>
          
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" />
              Browse...
            </button>
            <span className="text-sm text-gray-500">No file selected</span>
          </div>
          
          <p className="text-sm text-gray-600">
            Optional: List of compounds to highlight in results
          </p>
        </div>

        {/* Start Analysis Button */}
        <div className="pt-6 border-t border-gray-200">
          <button
            onClick={() => router.push('/analysis')}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-base font-medium"
          >
            <span>Start Analysis</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileOperations;
