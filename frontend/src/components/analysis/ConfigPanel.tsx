/**
 * ConfigPanel Component
 * Configuration form for analysis parameters
 */

'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Info, Loader2 } from 'lucide-react';
import { useAnalysisStore, getConditions, canStartAnalysis } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { organismsApi } from '@/lib/api-client';
import type { Organism } from '@/types';

export const ConfigPanel: React.FC = () => {
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [isLoadingOrganisms, setIsLoadingOrganisms] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  const state = useAnalysisStore();
  const { config, setConfig, setAvailableOrganisms } = state;
  const conditions = getConditions(state);
  const canStart = canStartAnalysis(state);
  const { addToast } = useUIStore();
  
  // Load organisms on mount
  useEffect(() => {
    const loadOrganisms = async () => {
      setIsLoadingOrganisms(true);
      setLoadError(null);
      
      try {
        const data = await organismsApi.list();
        setOrganisms(data);
        setAvailableOrganisms(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load organisms';
        setLoadError(message);
        addToast({
          type: 'error',
          message: `Failed to load organisms: ${message}`,
        });
      } finally {
        setIsLoadingOrganisms(false);
      }
    };
    
    loadOrganisms();
  }, [setAvailableOrganisms, addToast]);
  
  // Check if treatment and control are different
  const isTreatmentControlValid = config.treatment !== config.control || 
    config.treatment === '' || 
    config.control === '';
  
  // Toggle switch component - Enhanced for better usability
  const Toggle: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    description?: string;
  }> = ({ checked, onChange, label, description }) => (
    <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
      <div className="flex-1 pr-4">
        <label className="text-base font-semibold text-gray-900 flex items-center gap-2">
          {label}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${checked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {checked ? 'ON' : 'OFF'}
          </span>
        </label>
        {description && (
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-8 w-16 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2
          ${checked ? 'bg-cyan-600' : 'bg-gray-300'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0
            transition duration-200 ease-in-out flex items-center justify-center relative
            ${checked ? 'translate-x-8' : 'translate-x-0'}
          `}
        >
          {checked ? (
            <svg className="w-4 h-4 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
  
  return (
    <div className="space-y-6" data-testid="config-form">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Analysis Configuration</h3>
        <p className="text-sm text-gray-500 mt-1">
          Configure parameters for differential expression analysis
        </p>
      </div>
      
      {/* Treatment/Control Setup */}
      <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
        <h4 className="text-sm font-medium text-gray-900 uppercase tracking-wider">
          Treatment / Control Setup
        </h4>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Treatment Dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Treatment
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              data-testid="treatment-select"
              value={config.treatment}
              onChange={(e) => setConfig({ treatment: e.target.value })}
              disabled={conditions.length === 0}
              className={`
                block w-full rounded-md border-gray-300 shadow-sm
                focus:border-cyan-500 focus:ring-cyan-500 sm:text-sm
                disabled:bg-gray-100 disabled:text-gray-500
                ${!isTreatmentControlValid ? 'border-red-300' : ''}
              `}
            >
              <option value="">Select treatment...</option>
              {conditions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
            {conditions.length === 0 && (
              <p className="text-xs text-gray-500">
                Upload files to see available conditions
              </p>
            )}
          </div>
          
          {/* Control Dropdown */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Control
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              data-testid="control-select"
              value={config.control}
              onChange={(e) => setConfig({ control: e.target.value })}
              disabled={conditions.length === 0}
              className={`
                block w-full rounded-md border-gray-300 shadow-sm
                focus:border-cyan-500 focus:ring-cyan-500 sm:text-sm
                disabled:bg-gray-100 disabled:text-gray-500
                ${!isTreatmentControlValid ? 'border-red-300' : ''}
              `}
            >
              <option value="">Select control...</option>
              {conditions.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Validation Error */}
        {!isTreatmentControlValid && (
          <div data-testid="config-error" className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="w-4 h-4" />
            <span>Treatment and Control must be different</span>
          </div>
        )}
      </div>
      
      {/* Organism Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Organism
          <span className="text-red-500 ml-1">*</span>
        </label>
        
        {isLoadingOrganisms ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading organisms...</span>
          </div>
        ) : loadError ? (
          <div data-testid="config-error" className="flex items-center gap-2 text-sm text-red-600 py-2">
            <AlertCircle className="w-4 h-4" />
            <span>{loadError}</span>
          </div>
        ) : (
          <select
            data-testid="organism-select"
            value={config.organism}
            onChange={(e) => setConfig({ organism: e.target.value })}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-cyan-500 focus:ring-cyan-500 sm:text-sm"
          >
            <option value="">Select organism...</option>
            {organisms
              .filter((org) => org.available)
              .map((organism) => (
                <option key={organism.id} value={organism.id}>
                  {organism.display_name}
                </option>
              ))}
          </select>
        )}
        
        {organisms.filter((org) => !org.available).length > 0 && (
          <p className="text-xs text-gray-500">
            {organisms.filter((org) => !org.available).length} organism(s) unavailable
          </p>
        )}
      </div>
      
      {/* Remove Razor Information */}
      <div data-testid="advanced-options-toggle">
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-gray-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-cyan-500 rounded-full"></span>
            Razor Peptide Handling
          </h4>
          <div data-testid="remove-razor-checkbox">
            <Toggle
              checked={config.remove_razor}
              onChange={(checked) => setConfig({ remove_razor: checked })}
              label="Remove Razor Peptides"
              description="Remove peptides that map to multiple proteins (razor peptides). Recommended for most analyses."
            />
          </div>
          
          {!config.remove_razor && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Note:</strong> Bioinformatics analysis will be disabled if razor information is not removed.
                This may affect pathway enrichment results.
              </span>
            </div>
          )}
        </div>
        
        {/* Strict Filtering */}
        <div className="space-y-4 mt-4">
          <h4 className="text-sm font-medium text-gray-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-cyan-500 rounded-full"></span>
            Data Quality Filtering
          </h4>
          <div data-testid="strict-filtering-checkbox">
            <Toggle
              checked={config.strict_filtering}
              onChange={(checked) => setConfig({ strict_filtering: checked })}
              label="Strict Filtering"
              description="Apply stricter quality filters to the data. Improves reliability but may reduce coverage."
            />
          </div>
          
          <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Tip:</strong> Use strict filtering for high-confidence results. 
              Disable for exploratory analysis to maximize coverage.
            </span>
          </div>
        </div>
      </div>
      
      {/* Configuration Summary */}
      <div className="border-t border-gray-200 pt-4">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Configuration Summary</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Treatment:</span>
            <span className={config.treatment ? 'text-gray-900 font-medium' : 'text-gray-400'}>
              {config.treatment || 'Not selected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Control:</span>
            <span className={config.control ? 'text-gray-900 font-medium' : 'text-gray-400'}>
              {config.control || 'Not selected'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Organism:</span>
            <span className={config.organism ? 'text-gray-900 font-medium' : 'text-gray-400'}>
              {config.organism 
                ? organisms.find(o => o.id === config.organism)?.display_name || config.organism
                : 'Not selected'
              }
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Remove Razor:</span>
            <span className={config.remove_razor ? 'text-green-600' : 'text-gray-600'}>
              {config.remove_razor ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Strict Filtering:</span>
            <span className={config.strict_filtering ? 'text-green-600' : 'text-gray-600'}>
              {config.strict_filtering ? 'Yes' : 'No'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;
