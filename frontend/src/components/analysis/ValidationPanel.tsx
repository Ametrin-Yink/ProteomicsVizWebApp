/**
 * ValidationPanel Component
 * Displays validation warnings and errors for the experiment setup
 */

'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useAnalysisStore, getValidation, canStartAnalysis } from '@/stores/analysis-store';
import type { ValidationWarning } from '@/types';

const statusColors = {
  valid: 'text-green-600 bg-green-50 border-green-200',
  invalid: 'text-red-600 bg-red-50 border-red-200',
  neutral: 'text-gray-600 bg-gray-50 border-gray-200',
};

const iconColors = {
  valid: 'text-green-500',
  invalid: 'text-red-500',
  neutral: 'text-gray-400',
};

const StatusItem: React.FC<{
  label: string;
  value: string | number;
  status: 'valid' | 'invalid' | 'neutral';
}> = ({ label, value, status }) => (
  <div className={`flex items-center justify-between p-3 rounded-lg border ${statusColors[status]}`}>
    <span className="text-sm font-medium">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold">{value}</span>
      {status === 'valid' && <CheckCircle className={`w-4 h-4 ${iconColors[status]}`} />}
      {status === 'invalid' && <XCircle className={`w-4 h-4 ${iconColors[status]}`} />}
    </div>
  </div>
);

const WarningItem: React.FC<{ warning: ValidationWarning }> = ({ warning }) => {
  const Icon = warning.type === 'error' ? XCircle : AlertTriangle;
  const colors = warning.type === 'error'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-800';
  const iconColor = warning.type === 'error' ? 'text-red-500' : 'text-amber-500';

  return (
    <div data-testid="validation-error" className={`flex items-start gap-3 p-3 rounded-lg border ${colors}`}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1">
        <p className="text-sm font-medium">{warning.message}</p>
      </div>
    </div>
  );
};

export const ValidationPanel: React.FC = () => {
  const state = useAnalysisStore();
  const validation = getValidation(state);
  const canStart = canStartAnalysis(state);
  
  const { warnings, selectedFiles, experiments, conditions, replicatesByCondition } = validation;
  
  const errorWarnings = warnings.filter((w) => w.type === 'error');
  const infoWarnings = warnings.filter((w) => w.type === 'warning');

  // Determine status for each check
  const experimentStatus = experiments.length === 1 ? 'valid' : experiments.length > 1 ? 'invalid' : 'neutral';
  const conditionStatus = conditions.length === 2 ? 'valid' : conditions.length > 2 ? 'invalid' : 'neutral';
  const replicateStatus = Object.values(replicatesByCondition).every((count) => count >= 3) 
    ? 'valid' 
    : Object.values(replicatesByCondition).some((count) => count < 3) 
      ? 'invalid' 
      : 'neutral';
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Validation Status</h3>
        <div className={`
          px-3 py-1 rounded-full text-sm font-medium
          ${canStart 
            ? 'bg-green-100 text-green-800' 
            : 'bg-amber-100 text-amber-800'
          }
        `}>
          {canStart ? 'Ready to Start' : 'Validation Required'}
        </div>
      </div>
      
      {/* Status Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatusItem
          label="Files Selected"
          value={selectedFiles.length}
          status={selectedFiles.length > 0 ? 'valid' : 'neutral'}
        />
        <StatusItem
          label="Experiments"
          value={experiments.length === 0 ? 'None' : experiments.join(', ')}
          status={experimentStatus}
        />
        <StatusItem
          label="Conditions"
          value={conditions.length === 0 ? 'None' : conditions.join(', ')}
          status={conditionStatus}
        />
        <StatusItem
          label="Replicates"
          value={Object.entries(replicatesByCondition).map(([cond, count]) => `${cond}: ${count}`).join(', ') || 'None'}
          status={replicateStatus}
        />
      </div>
      
      {/* Replicate Details */}
      {Object.keys(replicatesByCondition).length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Replicates per Condition</h4>
          <div className="space-y-2">
            {Object.entries(replicatesByCondition).map(([condition, count]) => (
              <div key={condition} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{condition}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        count >= 3 ? 'bg-green-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min((count / 3) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={`
                    text-sm font-medium
                    ${count >= 3 ? 'text-green-600' : 'text-red-600'}
                  `}>
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700">Issues to Address</h4>
          <div className="space-y-2">
            {errorWarnings.map((warning, index) => (
              <WarningItem key={`error-${index}`} warning={warning} />
            ))}
            {infoWarnings.map((warning, index) => (
              <WarningItem key={`warning-${index}`} warning={warning} />
            ))}
          </div>
        </div>
      )}
      
      {/* No Warnings */}
      {warnings.length === 0 && selectedFiles.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-800">
            All validation checks passed. Ready to start analysis.
          </p>
        </div>
      )}
      
      {/* No Files */}
      {selectedFiles.length === 0 && (
        <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            Upload and select files to see validation status
          </p>
        </div>
      )}
    </div>
  );
};

export default ValidationPanel;
