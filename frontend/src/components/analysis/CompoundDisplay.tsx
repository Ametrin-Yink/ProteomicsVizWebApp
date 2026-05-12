/**
 * CompoundDisplay Component
 * Displays compound structures matched to conditions using NIH Cactus service
 */

'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Beaker, AlertCircle, Hash, ImageOff, RefreshCw } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import type { CompoundInfo } from '@/types';

interface MatchedCompound {
  condition: string;
  compound: CompoundInfo | null;
}

// Generate NIH Cactus image URL from SMILES
function getCactusImageUrl(smiles: string, width: number = 300, height: number = 200): string {
  if (!smiles) return '';
  // Encode SMILES for URL
  const encodedSmiles = encodeURIComponent(smiles);
  return `https://cactus.nci.nih.gov/chemical/structure/${encodedSmiles}/image?format=png&width=${width}&height=${height}&linewidth=2&bgcolor=transparent&atomcolor=element`;
}

// Compound structure image component with error handling
function CompoundStructure({ smiles, corpId }: { smiles: string; corpId: string }) {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const imageUrl = useMemo(() => getCactusImageUrl(smiles), [smiles]);

  const handleRetry = useCallback(() => {
    setImageError(false);
    setIsLoading(true);
  }, []);

  if (!smiles) {
    return (
      <div className="bg-surface rounded-lg p-6 text-center">
        <ImageOff className="w-12 h-12 mx-auto text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No SMILES available</p>
      </div>
    );
  }

  if (imageError) {
    return (
      <div className="bg-surface rounded-lg p-6 text-center">
        <ImageOff className="w-12 h-12 mx-auto text-text-muted mb-2" />
        <p className="text-xs text-text-muted mb-2">Failed to load structure</p>
        <button
          onClick={handleRetry}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-primary hover:text-primary-dark hover:bg-primary/5 rounded transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-background rounded-lg border border-border p-2 relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface rounded-lg">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={`Chemical structure of ${corpId}`}
        className={`w-full h-auto max-h-[180px] object-contain transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        onError={() => {
          setIsLoading(false);
          setImageError(true);
        }}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}

export const CompoundDisplay: React.FC = () => {
  const { compoundFile, uploadedFiles, selectedFiles } = useAnalysisStore();

  // Derive conditions dynamically from selected files
  const conditions = useMemo(() => {
    const selected = uploadedFiles.filter((file) => selectedFiles.has(file.filename));
    return Array.from(new Set(selected.flatMap((f) => f.conditions)));
  }, [uploadedFiles, selectedFiles]);

  // Match compounds to conditions
  const matchedCompounds: MatchedCompound[] = useMemo(() => {
    if (!compoundFile || conditions.length === 0) {
      return [];
    }


    return conditions.map((condition) => {
      // Try exact match first, then case-insensitive
      let compound = compoundFile.compounds.find(
        (c) => c.corp_id === condition
      );

      if (!compound) {
        compound = compoundFile.compounds.find(
          (c) => c.corp_id.toLowerCase() === condition.toLowerCase()
        );
      }

      // Also try matching by checking if corp_id is contained in condition or vice versa
      if (!compound) {
        compound = compoundFile.compounds.find(
          (c) => condition.toLowerCase().includes(c.corp_id.toLowerCase()) ||
                 c.corp_id.toLowerCase().includes(condition.toLowerCase())
        );
      }

      return { condition, compound: compound ?? null };
    });
  }, [compoundFile, conditions]);

  // Find unmatched conditions
  const unmatchedConditions = useMemo(() => {
    return matchedCompounds.filter((m) => m.compound === null).map((m) => m.condition);
  }, [matchedCompounds]);

  if (!compoundFile) {
    return (
      <div data-testid="no-available-compound" className="text-center py-8 text-text-muted">
        <Beaker className="w-12 h-12 mx-auto mb-3 text-text-muted" />
        <p className="text-sm">No compound file uploaded</p>
        <p className="text-xs text-text-muted mt-1">
          Upload a compound file to see structures
        </p>
      </div>
    );
  }

  if (conditions.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        <Beaker className="w-12 h-12 mx-auto mb-3 text-text-muted" />
        <p className="text-sm">Upload and select proteomics files first</p>
        <p className="text-xs text-text-muted mt-1">
        Condition names will be matched to Corp IDs
        </p>
      </div>
    );
  }

  return (
    <div data-testid="compound-info" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">Compound Structures</h3>
        <div data-testid="compound-upload-success" className="text-sm text-text-muted">
          {compoundFile.filename}
        </div>
      </div>

      {/* Matched Compounds */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {matchedCompounds.map(({ condition, compound }) => (
          <div
            key={condition}
            className={`
              border rounded-lg p-4 transition-all
              ${compound
                ? 'bg-background border-border'
                : 'bg-surface border-border border-dashed'
              }
            `}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                {condition}
              </span>
              {compound && (
                <span className="text-xs text-text-muted font-mono">
                  {compound.corp_id}
                </span>
              )}
            </div>

            {compound ? (
              <div className="space-y-3">
                {/* Structure Image */}
                <CompoundStructure smiles={compound.smiles} corpId={compound.corp_id} />

                {/* SMILES */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
                    SMILES
                  </label>
                  <div className="bg-surface rounded p-2 font-mono text-xs text-text break-all">
                    {compound.smiles}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <AlertCircle className="w-8 h-8 mx-auto text-warning mb-2" />
                <p className="text-sm text-text-secondary">No matching compound</p>
                <p className="text-xs text-text-muted mt-1">
                  No Corp ID matches &quot;{condition}&quot;
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Unmatched Compounds */}
      {compoundFile.compounds.length > matchedCompounds.filter(m => m.compound !== null).length && (
        <div className="mt-4 p-4 bg-secondary/10 rounded-lg">
          <div className="flex items-start gap-3">
            <Hash className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-secondary">
                Unmatched Compounds
              </p>
              <p className="text-xs text-secondary mt-1">
                {compoundFile.compounds.length - matchedCompounds.filter(m => m.compound !== null).length}
                compound(s) in file don&apos;t match any condition
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {compoundFile.compounds
                  .filter((c) => {
                    const exactMatch = conditions.some(cond => cond === c.corp_id);
                    const caseInsensitiveMatch = conditions.some(cond =>
                      cond.toLowerCase() === c.corp_id.toLowerCase() ||
                      cond.toLowerCase().includes(c.corp_id.toLowerCase()) ||
                      c.corp_id.toLowerCase().includes(cond.toLowerCase())
                    );
                    return !exactMatch && !caseInsensitiveMatch;
                  })
                  .map((c) => (
                    <span
                      key={c.corp_id}
                      className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-background text-text-secondary border border-border"
                    >
                      {c.corp_id}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="text-sm text-text-secondary">
          <span className="font-medium">{matchedCompounds.filter(m => m.compound !== null).length}</span>
          {' '}of{' '}
          <span className="font-medium">{conditions.length}</span>
          {' '}conditions matched
        </div>
        {unmatchedConditions.length > 0 && (
          <div className="text-xs text-warning">
            {unmatchedConditions.length} condition(s) without match
          </div>
        )}
      </div>
    </div>
  );
};

export default CompoundDisplay;
