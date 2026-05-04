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
  valid: 'text-success bg-success/5 border-success/20',
  invalid: 'text-error bg-error/5 border-error/20',
  neutral: 'text-text-secondary bg-surface border-border',
};

const iconColors = {
  valid: 'text-success',
  invalid: 'text-error',
  neutral: 'text-text-muted',
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
    ? 'bg-error/5 border-error/20 text-error'
    : 'bg-warning/5 border-warning/20 text-warning';
  const iconColor = warning.type === 'error' ? 'text-error' : 'text-warning';

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
  const experimentStatus = experiments.length === 1 ? 'valid' : experiments.length > 1 ? 'neutral' : 'neutral';
  const conditionStatus = conditions.length >= 2 ? 'valid' : conditions.length > 0 ? 'neutral' : 'neutral';
  const replicateStatus = Object.values(replicatesByCondition).every((count) => count >= 3) 
    ? 'valid' 
    : Object.values(replicatesByCondition).some((count) => count < 3) 
      ? 'invalid' 
      : 'neutral';
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">Validation Status</h3>
        <div className={`
          px-3 py-1 rounded-full text-sm font-medium
          ${canStart 
            ? 'bg-success/10 text-success' 
            : 'bg-warning/10 text-warning'
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
        <div className="bg-surface rounded-lg p-4">
          <h4 className="text-sm font-medium text-text mb-3">Replicates per Condition</h4>
          <div className="space-y-2">
            {Object.entries(replicatesByCondition).map(([condition, count]) => (
              <div key={condition} className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{condition}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-border rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        count >= 3 ? 'bg-success' : 'bg-error'
                      }`}
                      style={{ width: `${Math.min((count / 3) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={`
                    text-sm font-medium
                    ${count >= 3 ? 'text-success' : 'text-error'}
                  `}>
                    {count}/3 min
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
          <h4 className="text-sm font-medium text-text">Issues to Address</h4>
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
        <div className="flex items-center gap-3 p-4 bg-success/5 border border-success/20 rounded-lg">
          <CheckCircle className="w-5 h-5 text-success flex-shrink-0" />
          <p className="text-sm text-success">
            All validation checks passed. Ready to start analysis.
          </p>
        </div>
      )}
      
      {/* No Files */}
      {selectedFiles.length === 0 && (
        <div className="flex items-center gap-3 p-4 bg-surface border border-border rounded-lg">
          <AlertCircle className="w-5 h-5 text-text-muted flex-shrink-0" />
          <p className="text-sm text-text-secondary">
            Upload and select files to see validation status
          </p>
        </div>
      )}
    </div>
  );
};

export default ValidationPanel;
