/**
 * Analysis Workflow Panel
 * Right panel containing all analysis steps and configuration
 * Based on the actual ProteomicsViz workflow
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, ArrowLeft, Loader2, Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnalysisStore, canStartAnalysis } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';

// Maximum file size: 500MB
const MAX_FILE_SIZE = 500 * 1024 * 1024;

export const AnalysisWorkflow: React.FC = () => {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string>('');
  const [isCreatingSession, setIsCreatingSession] = useState(true);
  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  
  const state = useAnalysisStore();
  const { config, uploadedFiles, compoundFile, setConfig } = state;
  const canStart = canStartAnalysis(state);
  const { addToast } = useUIStore();

  // Create session on mount
  useEffect(() => {
    const createSession = async () => {
      setIsCreatingSession(true);
      try {
        const session = await sessionsApi.create(
          `Analysis ${new Date().toLocaleString()}`,
          'protein_pairwise_comparison'
        );
        setSessionId(session.id);
        localStorage.setItem('currentSessionId', session.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create session';
        addToast({
          type: 'error',
          message: `Failed to create session: ${message}`,
        });
      } finally {
        setIsCreatingSession(false);
      }
    };
    
    createSession();
  }, [addToast]);

  const handleStartAnalysis = async () => {
    if (!canStart || !sessionId) return;
    
    setIsStartingAnalysis(true);
    try {
      await sessionsApi.updateConfig(sessionId, config);
      await processingApi.start(sessionId);
      
      addToast({
        type: 'success',
        message: 'Analysis started successfully',
      });
      
      router.push('/analysis/processing');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start analysis';
      addToast({
        type: 'error',
        message: `Failed to start analysis: ${message}`,
      });
      setIsStartingAnalysis(false);
    }
  };

  if (isCreatingSession) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-cyan-500 animate-spin" />
          <h2 className="text-xl font-semibold text-gray-900">Creating Session...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Data Input & Configuration</h1>
            <p className="text-sm text-gray-500 mt-1">Session: {sessionId.slice(0, 8)}...</p>
          </div>
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>

        {/* Step 1: File Upload */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div 
            className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer"
            onClick={() => setActiveStep(activeStep === 1 ? 0 : 1)}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                uploadedFiles.length > 0 ? "bg-green-500 text-white" : "bg-cyan-500 text-white"
              )}>
                {uploadedFiles.length > 0 ? <CheckCircle className="w-5 h-5" /> : "1"}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Upload Proteomics Data</h2>
                <p className="text-sm text-gray-500">Upload PSM CSV files (max 500MB each)</p>
              </div>
            </div>
            <span className="text-sm text-gray-400">
              {uploadedFiles.length} file(s) uploaded
            </span>
          </div>
          
          {activeStep === 1 && (
            <div className="p-6">
              <FileUploadSection sessionId={sessionId} />
            </div>
          )}
        </section>

        {/* Step 2: Experiment Structure */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div 
            className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer"
            onClick={() => setActiveStep(activeStep === 2 ? 0 : 2)}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-cyan-500 text-white flex items-center justify-center text-sm font-bold">
                2
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Experiment Structure</h2>
                <p className="text-sm text-gray-500">Review and select files for analysis</p>
              </div>
            </div>
          </div>
          
          {activeStep === 2 && (
            <div className="p-6">
              <ExperimentStructureSection />
            </div>
          )}
        </section>

        {/* Step 3: Configuration */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div 
            className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer"
            onClick={() => setActiveStep(activeStep === 3 ? 0 : 3)}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                config.treatment && config.control ? "bg-green-500 text-white" : "bg-cyan-500 text-white"
              )}>
                {config.treatment && config.control ? <CheckCircle className="w-5 h-5" /> : "3"}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Analysis Configuration</h2>
                <p className="text-sm text-gray-500">Set treatment, control, and filtering options</p>
              </div>
            </div>
          </div>
          
          {activeStep === 3 && (
            <div className="p-6 max-h-[600px] overflow-y-auto">
              <ConfigurationSection />
            </div>
          )}
        </section>

        {/* Step 4: Compound Information (Optional) */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div 
            className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer"
            onClick={() => setActiveStep(activeStep === 4 ? 0 : 4)}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                compoundFile ? "bg-green-500 text-white" : "bg-gray-400 text-white"
              )}>
                {compoundFile ? <CheckCircle className="w-5 h-5" /> : "4"}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Compound Information</h2>
                <p className="text-sm text-gray-500">Optional: Upload compound list for structure display</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">Optional</span>
          </div>
          
          {activeStep === 4 && (
            <div className="p-6">
              <CompoundUploadSection sessionId={sessionId} />
            </div>
          )}
        </section>

        {/* Validation Summary */}
        <div className="bg-gray-50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Validation Summary</h3>
          <ValidationSummary />
        </div>

        {/* Start Analysis Button */}
        <div className="flex justify-end pt-4">
          <button
            onClick={handleStartAnalysis}
            disabled={!canStart || isStartingAnalysis}
            className={cn(
              "inline-flex items-center gap-2 px-8 py-3 rounded-lg font-medium text-lg transition-all duration-200",
              canStart && !isStartingAnalysis
                ? "bg-cyan-600 text-white hover:bg-cyan-700 shadow-sm hover:shadow"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            )}
          >
            {isStartingAnalysis ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Start Analysis
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// File Upload Section Component
const FileUploadSection: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { addToast } = useUIStore();
  const { addUploadedFile, setUploadProgress, setIsUploading } = useAnalysisStore();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsUploading(true);
    
    for (const file of Array.from(files)) {
      // Validate file
      if (file.size > MAX_FILE_SIZE) {
        addToast({
          type: 'error',
          message: `${file.name} is too large. Max size is 500MB`,
        });
        continue;
      }
      
      // Check filename pattern: PSM_ExperimentName_Condition_ReplicateNumber.csv
      const pattern = /^PSM_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)_(\d+)\.csv$/;
      const match = file.name.match(pattern);
      
      if (!match) {
        addToast({
          type: 'error',
          message: `${file.name} doesn't match required pattern: PSM_ExperimentName_Condition_ReplicateNumber.csv`,
        });
        continue;
      }
      
      try {
        // Upload file
        const result = await uploadApi.uploadProteomics(
          sessionId,
          [file],
          (filename, progress) => {
            setUploadProgress(filename, progress);
          }
        );
        
        addUploadedFile({
          filename: file.name,
          experiment: match[1],
          condition: match[2],
          replicate: parseInt(match[3], 10),
          size: file.size,
          id: result[0]?.id || '',
        });
        
        addToast({
          type: 'success',
          message: `${file.name} uploaded successfully`,
        });
      } catch (error) {
        addToast({
          type: 'error',
          message: `Failed to upload ${file.name}`,
        });
      }
    }
    
    setIsUploading(false);
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
          isDragging 
            ? "border-cyan-500 bg-cyan-50" 
            : "border-gray-300 hover:border-cyan-400 hover:bg-gray-50"
        )}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="text-lg font-medium text-gray-700 mb-2">
          Drop PSM CSV files here, or click to select
        </p>
        <p className="text-sm text-gray-500">
          Expected format: PSM_ExperimentName_Condition_ReplicateNumber.csv
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Maximum file size: 500MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Upload from Database Button (TBD) */}
      <button
        disabled
        className="w-full py-2 px-4 border border-gray-300 rounded-lg text-gray-400 cursor-not-allowed text-sm"
      >
        Upload from database (TBD)
      </button>
    </div>
  );
};

// Experiment Structure Section
const ExperimentStructureSection: React.FC = () => {
  const { uploadedFiles, toggleFileSelection, selectedFiles } = useAnalysisStore();
  
  if (uploadedFiles.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No files uploaded yet</p>
        <p className="text-sm">Upload files in Step 1 to see them here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">
          {selectedFiles.length} of {uploadedFiles.length} files selected
        </p>
        <button
          onClick={() => {
            uploadedFiles.forEach(file => {
              if (!selectedFiles.includes(file.id)) {
                toggleFileSelection(file.id);
              }
            });
          }}
          className="text-sm text-cyan-600 hover:text-cyan-700"
        >
          Select All
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Select</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Experiment</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Condition</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Replicate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {uploadedFiles.map((file) => (
              <tr key={file.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedFiles.includes(file.id)}
                    onChange={() => toggleFileSelection(file.id)}
                    className="w-4 h-4 text-cyan-600 rounded border-gray-300 focus:ring-cyan-500"
                  />
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{file.filename}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{file.experiment}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{file.condition}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{file.replicate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Configuration Section
const ConfigurationSection: React.FC = () => {
  const { config, setConfig, conditions } = useAnalysisStore();
  const [organisms, setOrganisms] = useState<Array<{id: string, display_name: string}>>([]);
  const [isLoadingOrganisms, setIsLoadingOrganisms] = useState(true);

  useEffect(() => {
    // Load organisms
    const loadOrganisms = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/organisms');
        const data = await response.json();
        setOrganisms(data);
      } catch (error) {
        console.error('Failed to load organisms:', error);
        // Fallback to default organisms
        setOrganisms([
          { id: 'human', display_name: 'Human (Homo sapiens)' },
          { id: 'mouse', display_name: 'Mouse (Mus musculus)' },
          { id: 'rat', display_name: 'Rat (Rattus norvegicus)' },
          { id: 'zebrafish', display_name: 'Zebrafish (Danio rerio)' },
          { id: 'fly', display_name: 'Fruit Fly (Drosophila melanogaster)' },
          { id: 'yeast', display_name: 'Yeast (Saccharomyces cerevisiae)' },
        ]);
      } finally {
        setIsLoadingOrganisms(false);
      }
    };
    loadOrganisms();
  }, []);

  return (
    <div className="space-y-6">
      {/* Treatment / Control */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Treatment <span className="text-red-500">*</span>
          </label>
          <select
            value={config.treatment}
            onChange={(e) => setConfig({ treatment: e.target.value })}
            disabled={conditions.length === 0}
            className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
          >
            <option value="">Select treatment...</option>
            {conditions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Control <span className="text-red-500">*</span>
          </label>
          <select
            value={config.control}
            onChange={(e) => setConfig({ control: e.target.value })}
            disabled={conditions.length === 0}
            className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
          >
            <option value="">Select control...</option>
            {conditions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {config.treatment === config.control && config.treatment && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" />
          <span>Treatment and Control must be different</span>
        </div>
      )}

      {/* Organism */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Organism <span className="text-red-500">*</span>
        </label>
        {isLoadingOrganisms ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading organisms...
          </div>
        ) : (
          <select
            value={config.organism}
            onChange={(e) => setConfig({ organism: e.target.value })}
            className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500"
          >
            <option value="">Select organism...</option>
            {organisms.map((org) => (
              <option key={org.id} value={org.id}>{org.display_name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Remove Razor Peptides Toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <h4 className="text-sm font-medium text-gray-900">Remove Razor Peptides</h4>
          <p className="text-xs text-gray-500">Remove peptides that map to multiple proteins</p>
        </div>
        <button
          onClick={() => setConfig({ remove_razor: !config.remove_razor })}
          className={cn(
            "relative inline-flex h-6 w-11 rounded-full transition-colors",
            config.remove_razor ? "bg-cyan-600" : "bg-gray-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              config.remove_razor ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {!config.remove_razor && (
        <div className="flex items-start gap-2 text-sm text-amber-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Bioinformatics analysis will be disabled if razor peptides are not removed</span>
        </div>
      )}

      {/* Strict Filtering Toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <h4 className="text-sm font-medium text-gray-900">Strict Filtering</h4>
          <p className="text-xs text-gray-500">Apply stricter quality filters (improves reliability, reduces coverage)</p>
        </div>
        <button
          onClick={() => setConfig({ strict_filtering: !config.strict_filtering })}
          className={cn(
            "relative inline-flex h-6 w-11 rounded-full transition-colors",
            config.strict_filtering ? "bg-cyan-600" : "bg-gray-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              config.strict_filtering ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>
    </div>
  );
};

// Compound Upload Section
const CompoundUploadSection: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { compoundFile, setCompoundFile } = useAnalysisStore();
  const { addToast } = useUIStore();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleCompoundUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    
    // Check for required columns
    const text = await file.text();
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    if (!headers.includes('corp_id') && !headers.includes('corp id')) {
      addToast({
        type: 'error',
        message: 'Compound file must have "Corp ID" column',
      });
      return;
    }
    
    try {
      await uploadApi.uploadCompound(sessionId, file);
      setCompoundFile({
        filename: file.name,
        size: file.size,
      });
      addToast({
        type: 'success',
        message: 'Compound file uploaded successfully',
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: 'Failed to upload compound file',
      });
    }
  };

  return (
    <div className="space-y-4">
      {!compoundFile ? (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-cyan-400 hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">Click to upload compound list</p>
            <p className="text-xs text-gray-500 mt-1">CSV with Corp ID and SMILES columns</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => handleCompoundUpload(e.target.files)}
              className="hidden"
            />
          </div>
          <p className="text-sm text-gray-500 text-center">No available compound</p>
        </>
      ) : (
        <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm text-gray-900">{compoundFile.filename}</span>
          </div>
          <button
            onClick={() => setCompoundFile(null)}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

// Validation Summary
const ValidationSummary: React.FC = () => {
  const { uploadedFiles, selectedFiles, config, conditions = [] } = useAnalysisStore();
  
  const validations = [
    {
      label: 'Files uploaded',
      valid: uploadedFiles.length >= 6,
      message: uploadedFiles.length >= 6 ? `${uploadedFiles.length} files uploaded` : 'At least 6 files required (3 per condition)',
    },
    {
      label: 'Files selected',
      valid: selectedFiles.length >= 6,
      message: selectedFiles.length >= 6 ? `${selectedFiles.length} files selected` : 'Select at least 6 files',
    },
    {
      label: 'Same experiment',
      valid: new Set(uploadedFiles.map(f => f.experiment)).size === 1,
      message: 'All files must be from the same experiment',
    },
    {
      label: 'Two conditions',
      valid: conditions.length === 2,
      message: conditions.length === 2 ? '2 conditions detected' : 'Exactly 2 conditions required for paired comparison',
    },
    {
      label: 'Minimum replicates',
      valid: conditions.every(c => uploadedFiles.filter(f => f.condition === c).length >= 3),
      message: 'At least 3 replicates per condition required',
    },
    {
      label: 'Treatment selected',
      valid: !!config.treatment,
      message: config.treatment ? `Treatment: ${config.treatment}` : 'Select treatment condition',
    },
    {
      label: 'Control selected',
      valid: !!config.control,
      message: config.control ? `Control: ${config.control}` : 'Select control condition',
    },
    {
      label: 'Treatment ≠ Control',
      valid: config.treatment !== config.control,
      message: config.treatment === config.control ? 'Treatment and Control must be different' : 'Conditions are different',
    },
    {
      label: 'Organism selected',
      valid: !!config.organism,
      message: config.organism ? 'Organism selected' : 'Select organism',
    },
  ];

  return (
    <div className="space-y-2">
      {validations.map((v) => (
        <div key={v.label} className="flex items-center gap-2">
          {v.valid ? (
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          )}
          <span className={cn(
            "text-sm",
            v.valid ? "text-gray-700" : "text-amber-700"
          )}>
            <span className="font-medium">{v.label}:</span> {v.message}
          </span>
        </div>
      ))}
    </div>
  );
};

export default AnalysisWorkflow;
