'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, GitCompare, CheckSquare, Square, AlertCircle } from 'lucide-react';
import { useAnalysisStore, getConditions, getAllPairwiseComparisons } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

function ComparisonsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig, selectedPipeline, uploadedFiles } = state;
  const conditions = getConditions(state);
  const allComparisons = getAllPairwiseComparisons(state);
  const { addToast } = useUIStore();

  const selectedComparisons: Array<{ treatment: string; control: string }> =
    config.comparisons || [];

  const [newColumnName, setNewColumnName] = React.useState('');
  const [covariateSelections, setCovariateSelections] = React.useState<Set<string>>(
    new Set(config.covariate_columns || [])
  );

  const metadataColumns = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => cols.add(k));
    });
    return Array.from(cols);
  }, [config.metadata_columns]);

  React.useEffect(() => {
    if (!sessionId) {
      router.replace('/');
    } else if (!selectedPipeline) {
      router.replace(`/new/pipeline?session=${sessionId}`);
    }
  }, [sessionId, selectedPipeline, router]);

  React.useEffect(() => {
    if (!config.metadata_columns || Object.keys(config.metadata_columns).length === 0) {
      const init: Record<string, Record<string, string>> = {};
      uploadedFiles.forEach((f) => {
        init[f.filename] = {
          experiment: f.experiment,
          condition: f.condition,
          replicate: String(f.replicate),
        };
      });
      setConfig({ metadata_columns: init });
    }
  }, [uploadedFiles, config.metadata_columns, setConfig]);

  const isComparisonSelected = (comp: { treatment: string; control: string }) =>
    selectedComparisons.some(
      (c) => c.treatment === comp.treatment && c.control === comp.control
    );

  const toggleComparison = (comp: { treatment: string; control: string }) => {
    if (isComparisonSelected(comp)) {
      setConfig({
        comparisons: selectedComparisons.filter(
          (c) => !(c.treatment === comp.treatment && c.control === comp.control)
        ),
      });
    } else {
      setConfig({ comparisons: [...selectedComparisons, comp] });
    }
  };

  const selectAll = () => setConfig({ comparisons: [...allComparisons] });
  const clearAll = () => setConfig({ comparisons: [] });

  const updateMetadata = (filename: string, col: string, value: string) => {
    const current = { ...(config.metadata_columns || {}) };
    if (!current[filename]) current[filename] = {};
    current[filename] = { ...current[filename], [col]: value };
    setConfig({ metadata_columns: current });
  };

  const addMetadataColumn = () => {
    const name = newColumnName.trim();
    if (!name) return;
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      current[fn] = { ...current[fn], [name]: '' };
    });
    setConfig({ metadata_columns: current });
    setNewColumnName('');
  };

  const removeMetadataColumn = (col: string) => {
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      delete row[col];
      current[fn] = row;
    });
    setConfig({ metadata_columns: current });
  };

  const toggleCovariate = (col: string) => {
    const next = new Set(covariateSelections);
    if (next.has(col)) {
      next.delete(col);
    } else {
      next.add(col);
    }
    setCovariateSelections(next);
    setConfig({ covariate_columns: Array.from(next) });
  };

  const canContinue = selectedComparisons.length > 0;

  const handleBack = () => {
    router.push(`/new/pipeline?session=${sessionId}`);
  };

  const handleContinue = () => {
    if (!canContinue) {
      addToast('warning', 'Select at least one comparison to continue');
      return;
    }
    router.push(`/new/config?session=${sessionId}`);
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          <GitCompare className="w-4 h-4" />
          {selectedPipeline === 'msstats' ? 'MSstats' : 'msqrob2'} Pipeline
        </div>
        <h1 className="text-2xl font-bold text-text">Comparisons &amp; Metadata</h1>
        <p className="text-text-muted mt-1">
          Select pairwise comparisons and configure sample metadata for the analysis
        </p>
      </div>

      {/* Comparison Matrix */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Pairwise Comparisons</h2>
            <p className="text-sm text-text-muted">
              {conditions.length} condition{conditions.length !== 1 ? 's' : ''} detected
              &middot; {allComparisons.length} possible comparison{allComparisons.length !== 1 ? 's' : ''}
              &middot; {selectedComparisons.length} selected
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={selectAll} className="px-3 py-1 text-xs font-medium rounded-md bg-surface border border-border text-text hover:bg-primary/10 transition-colors">
              Select All
            </button>
            <button onClick={clearAll} className="px-3 py-1 text-xs font-medium rounded-md bg-surface border border-border text-text hover:bg-primary/10 transition-colors">
              Clear All
            </button>
          </div>
        </div>
        <div className="p-5">
          {allComparisons.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">
              Upload files with at least 2 different conditions to see comparisons.
            </p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {allComparisons.map((comp) => {
                const selected = isComparisonSelected(comp);
                const key = `${comp.treatment}_vs_${comp.control}`;
                return (
                  <label key={key} className={cn(
                    'flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                    selected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-surface border border-transparent'
                  )}>
                    <input type="checkbox" checked={selected} onChange={() => toggleComparison(comp)} className="sr-only" />
                    {selected ? <CheckSquare className="w-5 h-5 text-primary flex-shrink-0" /> : <Square className="w-5 h-5 text-text-muted flex-shrink-0" />}
                    <span className="text-sm text-text">
                      <span className="font-medium">{comp.treatment}</span>
                      {' vs '}
                      <span className="font-medium">{comp.control}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Sample Metadata Table */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text">Sample Metadata</h2>
            <p className="text-sm text-text-muted">
              Edit experiment, condition, and add custom metadata columns
            </p>
          </div>
        </div>
        <div className="p-5">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              placeholder="New column name (e.g., batch)"
              className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              onKeyDown={(e) => { if (e.key === 'Enter') addMetadataColumn(); }}
            />
            <button onClick={addMetadataColumn} className="px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
              Add Column
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Filename</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Experiment</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Condition</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium">Replicate</th>
                  {metadataColumns.map((col) => (
                    <th key={col} className="text-left py-2 px-3 text-text-muted font-medium">
                      <div className="flex items-center gap-1">
                        {col}
                        <button onClick={() => removeMetadataColumn(col)} className="text-text-muted hover:text-red-500 transition-colors" title={`Remove ${col} column`}>&times;</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => (
                  <tr key={file.filename} className="border-b border-border/50 hover:bg-surface/50">
                    <td className="py-2 px-3 text-text text-xs font-mono max-w-[200px] truncate" title={file.filename}>{file.filename}</td>
                    <td className="py-2 px-3">
                      <input type="text" value={config.metadata_columns?.[file.filename]?.experiment || file.experiment}
                        onChange={(e) => updateMetadata(file.filename, 'experiment', e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" value={config.metadata_columns?.[file.filename]?.condition || file.condition}
                        onChange={(e) => updateMetadata(file.filename, 'condition', e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" value={config.metadata_columns?.[file.filename]?.replicate || String(file.replicate)}
                        onChange={(e) => updateMetadata(file.filename, 'replicate', e.target.value)}
                        className="w-20 px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary" />
                    </td>
                    {metadataColumns.map((col) => (
                      <td key={col} className="py-2 px-3">
                        <input type="text" value={config.metadata_columns?.[file.filename]?.[col] || ''}
                          onChange={(e) => updateMetadata(file.filename, col, e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Covariates (MSstats only) */}
      {selectedPipeline === 'msstats' && metadataColumns.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-lg font-semibold text-text">Covariates</h2>
            <p className="text-sm text-text-muted">
              Select metadata columns to include as covariates in the statistical model
            </p>
          </div>
          <div className="p-5">
            <div className="space-y-1">
              {metadataColumns.map((col) => (
                <label key={col} className={cn(
                  'flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors',
                  covariateSelections.has(col) ? 'bg-primary/5 border border-primary/20' : 'hover:bg-surface border border-transparent'
                )}>
                  <input type="checkbox" checked={covariateSelections.has(col)} onChange={() => toggleCovariate(col)} className="sr-only" />
                  {covariateSelections.has(col) ? <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" /> : <Square className="w-4 h-4 text-text-muted flex-shrink-0" />}
                  <span className="text-sm text-text">{col}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {!canContinue && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Select at least one pairwise comparison to continue.
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button onClick={handleBack} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text bg-surface border border-border rounded-lg hover:bg-border/20 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Pipeline
        </button>
        <button onClick={handleContinue} disabled={!canContinue} className={cn(
          'flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors',
          canContinue ? 'bg-primary text-white hover:bg-primary/90' : 'bg-surface text-text-muted cursor-not-allowed'
        )}>
          Continue to Configuration
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function ComparisonsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted">Loading...</div>}>
      <ComparisonsContent />
    </Suspense>
  );
}
