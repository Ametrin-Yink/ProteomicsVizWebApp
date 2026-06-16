'use client';

import React, { useState } from 'react';
import type { PTMModelType } from '@/types/api';

interface PTMVolcanoProps {
  sessionId: string;
  modelType?: PTMModelType;
}

export default function PTMVolcano({ sessionId, modelType = 'adjusted' }: PTMVolcanoProps) {
  const [selectedModel, setSelectedModel] = useState<PTMModelType>(modelType);
  const [isLoading] = useState(false);
  const [isModeA] = useState(false); // Mode A: no global proteome data available

  const models: Array<{ key: PTMModelType; label: string }> = [
    { key: 'ptm', label: 'PTM' },
    ...(isModeA ? [] : [{ key: 'protein' as PTMModelType, label: 'Protein' }]),
    { key: 'adjusted', label: 'Adjusted' },
  ];

  return (
    <div
      data-testid="ptm-volcano-container"
      className="bg-background rounded-lg border border-border"
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold text-text-primary">PTM Volcano Plot</h3>
      </div>

      {/* Segmented model selector */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex gap-0.5 p-0.5 bg-surface rounded-lg w-fit">
          {models.map((m) => (
            <button
              key={m.key}
              onClick={() => setSelectedModel(m.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                selectedModel === m.key
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              data-testid={`model-btn-${m.key}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Mode A note */}
        {isModeA && (
          <p className="mt-2 text-xs text-text-muted">
            Global proteome data not available. Only the PTM model is shown.
            The Adjusted model will be available once global proteome data is uploaded.
          </p>
        )}
      </div>

      {/* Placeholder content */}
      <div className="p-4">
        <div className="flex items-center justify-center h-[400px] border-2 border-dashed border-border rounded-lg">
          {isLoading ? (
            <div className="flex items-center gap-2 text-text-muted">
              <svg
                className="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                data-testid="loading-spinner"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>Loading PTM volcano data...</span>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-text-muted text-sm">PTM volcano visualization coming soon</p>
              <p className="text-text-muted text-xs mt-1">
                Selected model: {selectedModel === 'ptm' ? 'PTM' : selectedModel === 'protein' ? 'Protein' : 'Adjusted'}
              </p>
              <p className="text-text-muted text-xs">
                Session: {sessionId.slice(0, 8)}...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
