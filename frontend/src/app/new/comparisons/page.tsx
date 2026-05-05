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
import { cn, formatGroup } from '@/lib/utils';

function ComparisonsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, setConfig, selectedPipeline } = state;
  const { addToast } = useUIStore();

  // --- Drag-drop state ---
  const [group1Cards, setGroup1Cards] = React.useState<Array<{col: string; val: string; id: string}>>([]);
  const [group2Cards, setGroup2Cards] = React.useState<Array<{col: string; val: string; id: string}>>([]);

  // --- Comparisons state ---
  const [comparisons, setComparisons] = React.useState<Array<{
    group1: Record<string, string>;
    group2: Record<string, string>;
  }>>(config.comparisons || []);

  // Sync comparisons to Zustand store whenever they change
  React.useEffect(() => {
    setConfig({ comparisons });
  }, [comparisons]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- Derive condition column names from cards ---
  const conditionColumns = React.useMemo(() => {
    const cols = new Set<string>();
    conditionCards.forEach(c => cols.add(c.col));
    return Array.from(cols);
  }, [conditionCards]);

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
          Drag condition cards into groups to build comparisons
        </p>
      </div>

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
              <p className="text-xs text-text-muted italic">No condition cards available. Define metadata columns on the Upload page.</p>
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
                <div
                  key={col}
                  role="checkbox"
                  aria-checked={covariateSelections.has(col)}
                  tabIndex={0}
                  onClick={() => toggleCovariate(col)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCovariate(col); } }}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm select-none',
                    covariateSelections.has(col)
                      ? 'bg-primary/10 border border-primary/30 text-primary'
                      : 'bg-surface border border-border text-text-muted hover:border-primary/20'
                  )}
                >
                  {covariateSelections.has(col) ? (
                    <CheckSquare className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 flex-shrink-0" />
                  )}
                  {col}
                </div>
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

export default function ComparisonsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted">Loading...</div>}>
      <ComparisonsContent />
    </Suspense>
  );
}
