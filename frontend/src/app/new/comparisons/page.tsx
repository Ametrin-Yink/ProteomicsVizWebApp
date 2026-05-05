'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, GitCompare, CheckSquare, Square,
  AlertCircle, Loader2, Plus, X, GripVertical, Trash2,
} from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function ComparisonsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig, selectedPipeline, uploadedFiles } = state;
  const { addToast } = useUIStore();

  // --- Metadata editor state ---
  const [newColName, setNewColName] = React.useState('');
  const [editingColName, setEditingColName] = React.useState<string | null>(null);
  const [editColValue, setEditColValue] = React.useState('');

  // --- Drag-drop state ---
  const [group1Cards, setGroup1Cards] = React.useState<Array<{col: string; val: string; id: string}>>([]);
  const [group2Cards, setGroup2Cards] = React.useState<Array<{col: string; val: string; id: string}>>([]);

  // --- Comparisons state ---
  const [comparisons, setComparisons] = React.useState<Array<{
    group1: Record<string, string>;
    group2: Record<string, string>;
  }>>(config.comparisons || []);

  // --- Covariate state ---
  const [covariateSelections, setCovariateSelections] = React.useState<Set<string>>(
    new Set(config.covariate_columns || [])
  );

  // --- Saving state ---
  const [isSaving, setIsSaving] = React.useState(false);

  // --- Redirect guard ---
  React.useEffect(() => {
    if (!sessionId) { router.replace('/'); }
    else if (!selectedPipeline) { router.replace(`/new/pipeline?session=${sessionId}`); }
  }, [sessionId, selectedPipeline, router]);

  // --- Auto-populate metadata on mount ---
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Derive condition columns from metadata (exclude experiment, replicate) ---
  const conditionColumns = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns]);

  // --- Derive condition cards from metadata ---
  const conditionCards = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const cards: Array<{ col: string; val: string; id: string }> = [];
    const seen = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.entries(row).forEach(([col, val]) => {
        if (col === 'experiment' || col === 'replicate') return;
        if (!val || !val.trim()) return;
        const id = `${col}:${val.trim()}`;
        if (!seen.has(id)) {
          seen.add(id);
          cards.push({ col, val: val.trim(), id });
        }
      });
    });
    return cards.sort((a, b) => a.col.localeCompare(b.col) || a.val.localeCompare(b.val));
  }, [config.metadata_columns]);

  // Filter palette cards to exclude those already in drop zones
  const paletteCards = React.useMemo(() => {
    const used = new Set([...group1Cards.map(c => c.id), ...group2Cards.map(c => c.id)]);
    return conditionCards.filter(c => !used.has(c.id));
  }, [conditionCards, group1Cards, group2Cards]);

  // Group palette cards by column name
  const paletteGroups = React.useMemo(() => {
    const groups: Record<string, typeof conditionCards> = {};
    paletteCards.forEach(c => {
      if (!groups[c.col]) groups[c.col] = [];
      groups[c.col].push(c);
    });
    return groups;
  }, [paletteCards]);

  // --- Metadata editing functions ---
  const addColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    if (conditionColumns.includes(name)) {
      addToast('warning', `Column "${name}" already exists`);
      return;
    }
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      current[fn] = { ...current[fn], [name]: '' };
    });
    setConfig({ metadata_columns: current });
    setNewColName('');
  };

  const startRenameColumn = (col: string) => {
    setEditingColName(col);
    setEditColValue(col);
  };

  const finishRenameColumn = () => {
    if (!editingColName) return;
    const newName = editColValue.trim();
    if (!newName || newName === editingColName) {
      setEditingColName(null);
      return;
    }
    if (conditionColumns.filter(c => c !== editingColName).includes(newName)) {
      addToast('warning', `Column "${newName}" already exists`);
      setEditingColName(null);
      return;
    }
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      if (editingColName in row) {
        row[newName] = row[editingColName];
        delete row[editingColName];
      }
      current[fn] = row;
    });
    // Update covariate selections if the renamed column was selected
    if (covariateSelections.has(editingColName)) {
      const next = new Set(covariateSelections);
      next.delete(editingColName);
      next.add(newName);
      setCovariateSelections(next);
      setConfig({ covariate_columns: Array.from(next) });
    }
    setConfig({ metadata_columns: current });
    setEditingColName(null);
  };

  const removeColumn = (colName: string) => {
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      delete row[colName];
      current[fn] = row;
    });
    // Remove from covariate selections
    const next = new Set(covariateSelections);
    next.delete(colName);
    setCovariateSelections(next);
    setConfig({ metadata_columns: current, covariate_columns: Array.from(next) });
    // Remove from drop zones if cards from this column are there
    setGroup1Cards(prev => prev.filter(c => c.col !== colName));
    setGroup2Cards(prev => prev.filter(c => c.col !== colName));
  };

  const updateCell = (filename: string, col: string, value: string) => {
    const current = { ...(config.metadata_columns || {}) };
    if (!current[filename]) current[filename] = {};
    current[filename] = { ...current[filename], [col]: value };
    setConfig({ metadata_columns: current });
  };

  // --- Drag-drop handlers ---
  const handleDragStart = (e: React.DragEvent, card: {col: string; val: string; id: string}, source: string) => {
    e.dataTransfer.setData('application/json', JSON.stringify(card));
    e.dataTransfer.setData('source', source);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnZone = (e: React.DragEvent, target: 'group1' | 'group2') => {
    e.preventDefault();
    const card = JSON.parse(e.dataTransfer.getData('application/json'));
    const source = e.dataTransfer.getData('source');

    // Remove from source
    if (source === 'group1') setGroup1Cards(prev => prev.filter(c => c.id !== card.id));
    else if (source === 'group2') setGroup2Cards(prev => prev.filter(c => c.id !== card.id));

    // Check duplicate column in target zone
    const targetCards = target === 'group1' ? group1Cards : group2Cards;
    if (targetCards.some(c => c.col === card.col)) {
      addToast('warning', `Already have a "${card.col}" card in this group`);
      return; // Card returns to palette (not re-added to any zone)
    }

    const setTarget = target === 'group1' ? setGroup1Cards : setGroup2Cards;
    setTarget(prev => [...prev, card]);
  };

  const handleDropOnPalette = (e: React.DragEvent) => {
    e.preventDefault();
    const card = JSON.parse(e.dataTransfer.getData('application/json'));
    const source = e.dataTransfer.getData('source');
    // Remove from source zone (card returns to palette automatically since it's filtered out)
    if (source === 'group1') setGroup1Cards(prev => prev.filter(c => c.id !== card.id));
    else if (source === 'group2') setGroup2Cards(prev => prev.filter(c => c.id !== card.id));
  };

  const removeFromZone = (target: 'group1' | 'group2', cardId: string) => {
    if (target === 'group1') setGroup1Cards(prev => prev.filter(c => c.id !== cardId));
    else setGroup2Cards(prev => prev.filter(c => c.id !== cardId));
  };

  // --- Add comparison ---
  const addComparison = () => {
    if (group1Cards.length === 0 || group2Cards.length === 0) {
      addToast('warning', 'Both groups need at least one condition card');
      return;
    }

    const g1: Record<string, string> = {};
    group1Cards.forEach(c => { g1[c.col] = c.val; });
    const g2: Record<string, string> = {};
    group2Cards.forEach(c => { g2[c.col] = c.val; });

    if (JSON.stringify(g1) === JSON.stringify(g2)) {
      addToast('warning', 'Group A and Group B must be different');
      return;
    }

    setComparisons(prev => [...prev, { group1: g1, group2: g2 }]);
    setGroup1Cards([]);
    setGroup2Cards([]);
  };

  const removeComparison = (index: number) => {
    setComparisons(prev => prev.filter((_, i) => i !== index));
  };

  // --- Covariate toggle ---
  const toggleCovariate = (col: string) => {
    const next = new Set(covariateSelections);
    if (next.has(col)) { next.delete(col); }
    else { next.add(col); }
    setCovariateSelections(next);
    setConfig({ covariate_columns: Array.from(next) });
  };

  // --- Navigation ---
  const handleBack = () => {
    router.push(`/new/pipeline?session=${sessionId}`);
  };

  const handleContinue = async () => {
    if (comparisons.length === 0) {
      addToast('warning', 'Add at least one comparison to continue');
      return;
    }
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, { ...config, comparisons });
    } catch (error) {
      addToast('warning', `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    router.push(`/new/config?session=${sessionId}`);
  };

  const canContinue = comparisons.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          <GitCompare className="w-4 h-4" />
          {selectedPipeline === 'msstats' ? 'MSstats' : 'msqrob2'} Pipeline
        </div>
        <h1 className="text-2xl font-bold text-text">Comparisons &amp; Metadata</h1>
        <p className="text-text-muted mt-1">
          Define condition columns, then drag cards to build comparisons
        </p>
      </div>

      {/* ===== SECTION 1: Metadata Editor ===== */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Condition Metadata</h2>
            <p className="text-sm text-text-muted">
              Define condition columns and assign values per sample
            </p>
          </div>
        </div>
        <div className="p-5">
          {/* Add column */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="New column (e.g., Drug, Time)"
              className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              onKeyDown={(e) => { if (e.key === 'Enter') addColumn(); }}
            />
            <button
              onClick={addColumn}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Column
            </button>
          </div>

          {/* Metadata table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs w-[180px]">Filename</th>
                  {conditionColumns.map((col) => (
                    <th key={col} className="text-left py-2 px-3 text-text-muted font-medium text-xs">
                      {editingColName === col ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editColValue}
                            onChange={(e) => setEditColValue(e.target.value)}
                            onBlur={finishRenameColumn}
                            onKeyDown={(e) => { if (e.key === 'Enter') finishRenameColumn(); if (e.key === 'Escape') setEditingColName(null); }}
                            className="w-24 px-1 py-0.5 bg-surface border border-primary rounded text-xs focus:outline-none"
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <button
                            onClick={() => startRenameColumn(col)}
                            className="hover:text-primary transition-colors"
                          >
                            {col}
                          </button>
                          <button
                            onClick={() => removeColumn(col)}
                            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all"
                            title={`Remove ${col}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => (
                  <tr key={file.filename} className="border-b border-border/50 hover:bg-surface/50">
                    <td className="py-1.5 px-3 text-text text-xs font-mono truncate max-w-[180px]" title={file.filename}>
                      {file.filename}
                    </td>
                    {conditionColumns.map((col) => (
                      <td key={col} className="py-1.5 px-3">
                        <input
                          type="text"
                          value={config.metadata_columns?.[file.filename]?.[col] || ''}
                          onChange={(e) => updateCell(file.filename, col, e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ===== SECTION 2: Comparison Builder ===== */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Build Comparisons</h2>
          <p className="text-sm text-text-muted">
            Drag condition cards into Group A and Group B, then add the comparison
          </p>
        </div>
        <div className="p-5 space-y-4">
          {/* Condition Palette */}
          <div
            className="p-3 bg-surface rounded-lg border border-border min-h-[60px]"
            onDragOver={handleDragOver}
            onDrop={handleDropOnPalette}
          >
            <p className="text-xs text-text-muted mb-2 font-medium">Condition Palette (drag to groups or drop here to return)</p>
            {Object.keys(paletteGroups).length === 0 && group1Cards.length === 0 && group2Cards.length === 0 ? (
              <p className="text-xs text-text-muted italic">Define condition columns and values above to see cards</p>
            ) : Object.keys(paletteGroups).length === 0 ? (
              <p className="text-xs text-text-muted italic">All cards are in use — remove from groups or drop here</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(paletteGroups).map(([colName, cards]) => (
                  <div key={colName}>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{colName}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {cards.map((card) => (
                        <div
                          key={card.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, card, 'palette')}
                          className="flex items-center gap-1 px-2 py-1 bg-background border border-border rounded-md text-xs text-text cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all select-none"
                        >
                          <GripVertical className="w-3 h-3 text-text-muted" />
                          <span className="font-medium text-text-muted">{card.col}:</span>
                          <span>{card.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drop Zones */}
          <div className="grid grid-cols-2 gap-4">
            {/* Group A */}
            <div
              className={cn(
                'p-3 rounded-lg border-2 border-dashed min-h-[100px] transition-colors',
                group1Cards.length === 0 ? 'border-border bg-surface/50' : 'border-blue-400/50 bg-blue-50/30'
              )}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnZone(e, 'group1')}
            >
              <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Group A</p>
              {group1Cards.length === 0 ? (
                <p className="text-xs text-text-muted italic">Drop condition cards here</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {group1Cards.map((card) => (
                    <div key={card.id} className="flex items-center gap-1 px-2 py-1 bg-blue-100 border border-blue-300 rounded-md text-xs text-text">
                      <span className="font-medium text-blue-700">{card.col}:</span>
                      <span>{card.val}</span>
                      <button onClick={() => removeFromZone('group1', card.id)} className="text-text-muted hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Group B */}
            <div
              className={cn(
                'p-3 rounded-lg border-2 border-dashed min-h-[100px] transition-colors',
                group2Cards.length === 0 ? 'border-border bg-surface/50' : 'border-red-400/50 bg-red-50/30'
              )}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnZone(e, 'group2')}
            >
              <p className="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wider">Group B</p>
              {group2Cards.length === 0 ? (
                <p className="text-xs text-text-muted italic">Drop condition cards here</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {group2Cards.map((card) => (
                    <div key={card.id} className="flex items-center gap-1 px-2 py-1 bg-red-100 border border-red-300 rounded-md text-xs text-text">
                      <span className="font-medium text-red-700">{card.col}:</span>
                      <span>{card.val}</span>
                      <button onClick={() => removeFromZone('group2', card.id)} className="text-text-muted hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add Comparison */}
          <button
            onClick={addComparison}
            disabled={group1Cards.length === 0 || group2Cards.length === 0}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors w-full justify-center',
              group1Cards.length > 0 && group2Cards.length > 0
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-surface text-text-muted cursor-not-allowed'
            )}
          >
            <Plus className="w-4 h-4" /> Add Comparison
          </button>

          {/* Logged Comparisons */}
          {comparisons.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Comparisons ({comparisons.length})
              </p>
              {comparisons.map((comp, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-2 bg-surface rounded-lg border border-border">
                  <div className="flex items-center gap-2 text-sm text-text">
                    <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="font-medium text-blue-700">{formatGroup(comp.group1)}</span>
                    <span className="text-text-muted">vs</span>
                    <span className="font-medium text-red-700">{formatGroup(comp.group2)}</span>
                  </div>
                  <button onClick={() => removeComparison(idx)} className="text-text-muted hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== SECTION 3: Covariates (MSstats only) ===== */}
      {selectedPipeline === 'msstats' && conditionColumns.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-lg font-semibold text-text">Covariates</h2>
            <p className="text-sm text-text-muted">
              Select metadata columns to include as covariates in the statistical model (optional)
            </p>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              {conditionColumns.map((col) => (
                <label
                  key={col}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm',
                    covariateSelections.has(col)
                      ? 'bg-primary/10 border border-primary/30 text-primary'
                      : 'bg-surface border border-border text-text-muted hover:border-primary/20'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={covariateSelections.has(col)}
                    onChange={() => toggleCovariate(col)}
                    className="sr-only"
                  />
                  {covariateSelections.has(col) ? (
                    <CheckSquare className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 flex-shrink-0" />
                  )}
                  {col}
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Validation */}
      {!canContinue && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Add at least one comparison to continue.
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text bg-surface border border-border rounded-lg hover:bg-border/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Pipeline
        </button>
        <button
          onClick={handleContinue}
          disabled={!canContinue || isSaving}
          className={cn(
            'flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors',
            canContinue ? 'bg-primary text-white hover:bg-primary/90' : 'bg-surface text-text-muted cursor-not-allowed'
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              Continue to Configuration
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Helper for formatting group display
function formatGroup(g: Record<string, string>): string {
  return Object.entries(g).map(([, v]) => v).join('+') || '(any)';
}

export default function ComparisonsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted">Loading...</div>}>
      <ComparisonsContent />
    </Suspense>
  );
}
