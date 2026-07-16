'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, GitCompare, CheckSquare, Square,
  AlertCircle, Loader2, Plus, X, GripVertical, Trash2,
  ChevronDown, ChevronRight, ArrowLeftRight, Wand2,
} from 'lucide-react';
import { useAnalysisStore, getPipelineFromType } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { useAutoSave } from '@/hooks/use-auto-save';
import { useBeforeUnload } from '@/hooks/use-beforeunload';
import { sessionsApi } from '@/lib/api-client';
import { cn, formatGroup } from '@/lib/utils';

function ComparisonsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const analysisType = useAnalysisStore((s) => s.analysisType);
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const selectedPipeline = getPipelineFromType(analysisType);
  const { addToast } = useUIStore();

  // NEW-D-057: Restoring guard
  const [isRestoring, setIsRestoring] = React.useState(true);

  // --- Auto-generate state ---
  const [selectedReference, setSelectedReference] = React.useState<string>('');

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

  // --- Collapse state for palette columns ---
  const [collapsedColumns, setCollapsedColumns] = React.useState<Set<string>>(new Set());

  const toggleColumn = (col: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  // --- Add a condition card to both groups ---
  const addToBothGroups = (card: {col: string; val: string; id: string}) => {
    const g1Has = group1Cards.some(c => c.col === card.col);
    const g2Has = group2Cards.some(c => c.col === card.col);
    if (g1Has && g2Has) {
      addToast('warning', `"${card.col}" is already in both groups`);
      return;
    }
    if (g1Has) {
      addToast('warning', `"${card.col}" is already in Group A`);
      return;
    }
    if (g2Has) {
      addToast('warning', `"${card.col}" is already in Group B`);
      return;
    }
    setGroup1Cards(prev => [...prev, card]);
    setGroup2Cards(prev => [...prev, card]);
  };

  const { dismiss: dismissBeforeUnload } = useBeforeUnload();

  // --- Saving state ---
  const [isSaving, setIsSaving] = React.useState(false);

  // T-026/D-022: Auto-save comparisons
  useAutoSave(sessionId, config, { enabled: !!sessionId && !!config.comparisons && config.comparisons.length > 0 });

  // Restore guard: mark as restored after first render
  React.useEffect(() => {
    setIsRestoring(false);
  }, []);

  // --- Redirect guard with isRestoring guard ---
  React.useEffect(() => {
    if (isRestoring) return;
    if (!sessionId) { router.replace('/'); }
    else if (!analysisType) { router.replace('/'); }
    else if (uploadedFiles.length === 0) { router.replace(`/new/upload?session=${sessionId}`); }
  }, [sessionId, analysisType, uploadedFiles.length, router, isRestoring]);

  // --- Derive condition cards from metadata or TMT mapping ---
  const conditionCards = React.useMemo(() => {
    const cards: Array<{ col: string; val: string; id: string }> = [];
    const seen = new Set<string>();

    if (analysisType === 'tmt') {
      // FR4.1: Derive from tmt_channel_mapping
      const mapping = config.tmt_channel_mapping || {};
      Object.values(mapping).forEach((entry) => {
        Object.entries(entry).forEach(([col, val]) => {
          if (col === 'replicate') return;
          const strVal = String(val ?? '').trim();
          if (!strVal) return;
          const id = `${col}:${strVal}`;
          if (!seen.has(id)) {
            seen.add(id);
            cards.push({ col, val: strVal, id });
          }
        });
      });
    } else {
      // Derive from metadata_columns (existing logic)
      Object.values(config.metadata_columns || {}).forEach((row) => {
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
    }

    return cards.sort((a, b) => a.col.localeCompare(b.col) || a.val.localeCompare(b.val));
  }, [analysisType, config.tmt_channel_mapping, config.metadata_columns]);

  // --- Derive unique condition strings for auto-generate ---
  const conditionStrings = React.useMemo(() => {
    const uniqueConditions = new Set<string>();
    if (analysisType === 'tmt') {
      const mapping = config.tmt_channel_mapping || {};
      const groupCols = new Set<string>();
      Object.values(mapping).forEach((entry) => {
        Object.keys(entry).forEach((k) => {
          if (k.toLowerCase() !== 'replicate') groupCols.add(k);
        });
      });
      Object.values(mapping).forEach((entry) => {
        const combined = Array.from(groupCols)
          .map((col) => String(entry[col] ?? '').trim())
          .filter(Boolean)
          .join('+');
        if (combined) uniqueConditions.add(combined);
      });
    } else {
      Object.values(config.metadata_columns || {}).forEach((row) => {
        const vals = Object.entries(row)
          .filter(([k]) => k !== 'experiment' && k.toLowerCase() !== 'replicate' && k !== 'batch')
          .map(([, v]) => v?.trim())
          .filter(Boolean);
        if (vals.length > 0) uniqueConditions.add(vals.join('+'));
      });
    }
    return Array.from(uniqueConditions).sort();
  }, [analysisType, config.tmt_channel_mapping, config.metadata_columns]);

  // --- Auto-generate comparisons ---
  const handleAutoGenerate = () => {
    if (!selectedReference) {
      addToast('warning', 'Select a reference condition');
      return;
    }
    if (conditionStrings.length < 2) {
      addToast('warning', 'Need at least 2 conditions to generate comparisons');
      return;
    }

    const generated: Array<{ group1: Record<string, string>; group2: Record<string, string> }> = [];
    const refParts = selectedReference.split('+');

    conditionStrings.forEach((cond) => {
      if (cond === selectedReference) return;

      // Build group objects from condition string
      const condParts = cond.split('+');
      const group1: Record<string, string> = {};
      const group2: Record<string, string> = {};

      if (analysisType === 'tmt') {
        // For TMT, derive from mapping
        const mapping = config.tmt_channel_mapping || {};
        const allKeys = new Set<string>();
        for (const entry of Object.values(mapping)) {
          for (const key of Object.keys(entry)) {
            if (key.toLowerCase() !== 'replicate') allKeys.add(key);
          }
        }
        const groupCols = Array.from(allKeys).sort();
        groupCols.forEach((col, idx) => {
          group1[col] = condParts[idx] || '';
          group2[col] = refParts[idx] || '';
        });
      } else {
        // For DIA, derive from metadata columns
        const sampleEntry = Object.values(config.metadata_columns || {})[0] || {};
        const groupCols = Object.keys(sampleEntry).filter(k => k !== 'experiment' && k.toLowerCase() !== 'replicate' && k !== 'batch');
        groupCols.forEach((col, idx) => {
          group1[col] = condParts[idx] || '';
          group2[col] = refParts[idx] || '';
        });
      }

      // T-023: Validate Group A != Group B
      if (JSON.stringify(group1) !== JSON.stringify(group2)) {
        generated.push({ group1, group2 });
      }
    });

    setComparisons((prev) => {
      // Merge with existing, avoid duplicates
      const existing = new Set(prev.map((c) => JSON.stringify(c)));
      const newComps = generated.filter((c) => !existing.has(JSON.stringify(c)));
      return [...prev, ...newComps];
    });

    addToast('success', `Generated ${generated.length} comparison(s)`);
  };

  // --- Derive condition column names from cards ---
  const conditionColumns = React.useMemo(() => {
    const cols = new Set<string>();
    conditionCards.forEach(c => cols.add(c.col));
    return Array.from(cols);
  }, [conditionCards]);

  // --- Compute sample counts for each group ---
  const groupSampleCounts = React.useMemo(() => {
    const countMatching = (cards: Array<{col: string; val: string; id: string}>) => {
      if (cards.length === 0) return 0;
      let count = 0;

      if (analysisType === 'tmt') {
        const mapping = config.tmt_channel_mapping || {};
        Object.values(mapping).forEach((entry) => {
          if (cards.every((c) => String(entry[c.col] ?? '') === c.val)) count++;
        });
      } else {
        Object.values(config.metadata_columns || {}).forEach((row) => {
          if (cards.every((c) => row[c.col] === c.val)) count++;
        });
      }
      return count;
    };
    return {
      group1: countMatching(group1Cards),
      group2: countMatching(group2Cards),
    };
  }, [group1Cards, group2Cards, analysisType, config.tmt_channel_mapping, config.metadata_columns]);

  // All cards are always available in palette (cards can be reused across groups)
  // Group palette cards by column name
  const paletteGroups = React.useMemo(() => {
    const groups: Record<string, typeof conditionCards> = {};
    conditionCards.forEach(c => {
      if (!groups[c.col]) groups[c.col] = [];
      groups[c.col].push(c);
    });
    return groups;
  }, [conditionCards]);

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

    // Remove from source zone (if dragged from another zone, not from palette)
    if (source === 'group1') setGroup1Cards(prev => prev.filter(c => c.id !== card.id));
    else if (source === 'group2') setGroup2Cards(prev => prev.filter(c => c.id !== card.id));

    // Check duplicate column within target zone only
    const targetCards = target === 'group1' ? group1Cards : group2Cards;
    if (targetCards.some(c => c.col === card.col)) {
      addToast('warning', `Already have a "${card.col}" card in this group`);
      return;
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
  const backRoute = analysisType === 'ptm' ? '/new/upload' : '/new/metadata';

  const handleContinue = async () => {
    if (comparisons.length === 0) {
      addToast('warning', 'Add at least one comparison to continue');
      return;
    }
    dismissBeforeUnload();
    setIsSaving(true);
    try {
      await sessionsApi.updateConfig(sessionId, { ...config, comparisons });
    } catch (error) {
      addToast('error', `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    router.replace(`/new/config?session=${sessionId}`);
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
        <h1 className="font-bold text-text-primary">Comparisons</h1>
        <p className="text-text-muted mt-1">
          Define which conditions to compare in the differential expression analysis
        </p>
      </div>

      {/* ===== SECTION 1: Auto-Generate Comparisons ===== */}
      {conditionStrings.length >= 2 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-text-primary">Auto-Generate Comparisons</h2>
            <p className="text-sm text-text-muted">
              Select a reference condition to generate all pairwise comparisons
            </p>
          </div>
          <div className="p-5">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Reference Condition
                </label>
                <select
                  value={selectedReference}
                  onChange={(e) => setSelectedReference(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-background"
                >
                  <option value="">-- Select reference condition --</option>
                  {conditionStrings.map((cond) => (
                    <option key={cond} value={cond}>{cond}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAutoGenerate}
                disabled={!selectedReference}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 className="w-4 h-4" /> Generate
              </button>
            </div>
            <p className="text-xs text-text-muted mt-2">
              Creates one comparison per unique condition vs the selected reference. Generated comparisons appear in the list below.
            </p>
          </div>
        </section>
      )}

      {/* ===== SECTION 2: Comparison Builder ===== */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-text-primary">Build Comparisons</h2>
          <p className="text-sm text-text-muted">
            Drag condition cards into Group A and Group B, then add the comparison
          </p>
        </div>
        <div className="p-5 space-y-4">
          {/* Condition Palette */}
          <p className="text-xs text-text-muted mb-2">
            Drag cards to groups or use the A/B buttons. Each card represents one attribute.
            Combine multiple cards to define a condition.
          </p>
          <div
            className="p-3 bg-surface rounded-lg border border-border min-h-[60px]"
            onDragOver={handleDragOver}
            onDrop={handleDropOnPalette}
          >
            <p className="text-xs text-text-muted mb-2 font-medium">Condition Palette (drag to groups or drop here to return)</p>
            {Object.keys(paletteGroups).length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-text-muted">No condition cards available.</p>
              <p className="text-xs text-text-muted">Configure metadata first to define conditions.</p>
              <button onClick={() => router.push(`/new/metadata?session=${sessionId}`)}
                className="px-4 py-2 text-sm text-primary border border-primary rounded-lg hover:bg-primary/5">
                Go to Metadata
              </button>
            </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(paletteGroups).map(([colName, cards]) => {
                  const isCollapsed = collapsedColumns.has(colName);
                  return (
                  <div key={colName}>
                    <button
                      onClick={() => toggleColumn(colName)}
                      className="flex items-center gap-1 text-xs uppercase tracking-wider text-text-muted font-semibold hover:text-text-primary transition-colors w-full text-left"
                    >
                      {isCollapsed ? <ChevronRight className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                      {colName}
                      <span className="font-normal tracking-normal normal-case text-text-muted ml-0.5">({cards.length})</span>
                    </button>
                    {!isCollapsed && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {cards.map((card) => (
                        <div
                          key={card.id}
                          className="flex items-center gap-1 px-2 py-1 bg-background border border-border rounded-md text-xs text-text-primary select-none group"
                        >
                          <div
                            draggable
                            onDragStart={(e) => handleDragStart(e, card, 'palette')}
                            className="flex items-center gap-1 cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-3 h-3 text-text-muted" />
                            <span className="font-medium text-text-muted">{card.col}:</span>
                            <span>{card.val}</span>
                          </div>
                          <button
                            onClick={() => addToBothGroups(card)}
                            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-primary transition-all ml-0.5"
                            title="Add to both groups"
                          >
                            <ArrowLeftRight className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              if (group1Cards.some(c => c.col === card.col)) {
                                addToast('warning', `"${card.col}" is already in Group A`);
                                return;
                              }
                              setGroup1Cards(prev => [...prev, card]);
                            }}
                            className="w-5 h-5 rounded-full text-[10px] font-bold bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 transition-colors flex-shrink-0"
                            title="Add to Group A only"
                            aria-label={`Add ${card.col}:${card.val} to Group A`}
                          >
                            A
                          </button>
                          <button
                            onClick={() => {
                              if (group2Cards.some(c => c.col === card.col)) {
                                addToast('warning', `"${card.col}" is already in Group B`);
                                return;
                              }
                              setGroup2Cards(prev => [...prev, card]);
                            }}
                            className="w-5 h-5 rounded-full text-[10px] font-bold bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors flex-shrink-0"
                            title="Add to Group B only"
                            aria-label={`Add ${card.col}:${card.val} to Group B`}
                          >
                            B
                          </button>
                        </div>
                      ))}
                    </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Drop Zones */}
          <div className="grid grid-cols-2 gap-4">
            {/* Group A */}
            <div
              className={cn(
                'p-3 rounded-lg border-2 border-dashed min-h-[100px] transition-colors',
                group1Cards.length === 0 ? 'border-border bg-surface/50' : 'border-[var(--color-info)]/50 bg-[var(--color-info-bg)]'
              )}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnZone(e, 'group1')}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Group A</p>
                    {group1Cards.length > 0 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        {groupSampleCounts.group1} sample{groupSampleCounts.group1 !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted italic">(blue region)</p>
                </div>
                {group1Cards.length > 0 && (
                  <button onClick={() => setGroup1Cards([])} className="text-xs text-text-muted hover:text-error transition-colors">
                    Clear all
                  </button>
                )}
              </div>
              {group1Cards.length === 0 ? (
                <p className="text-xs text-text-muted italic">Drop condition cards here</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {group1Cards.map((card) => (
                    <div key={card.id} className="flex items-center gap-1 px-2 py-1 bg-blue-100 border border-blue-300 rounded-md text-xs text-text-primary">
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
                group2Cards.length === 0 ? 'border-border bg-surface/50' : 'border-[var(--color-error)]/50 bg-[var(--color-error-bg)]'
              )}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnZone(e, 'group2')}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Group B</p>
                    {group2Cards.length > 0 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                        {groupSampleCounts.group2} sample{groupSampleCounts.group2 !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted italic">(red region)</p>
                </div>
                {group2Cards.length > 0 && (
                  <button onClick={() => setGroup2Cards([])} className="text-xs text-text-muted hover:text-error transition-colors">
                    Clear all
                  </button>
                )}
              </div>
              {group2Cards.length === 0 ? (
                <p className="text-xs text-text-muted italic">Drop condition cards here</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {group2Cards.map((card) => (
                    <div key={card.id} className="flex items-center gap-1 px-2 py-1 bg-red-100 border border-red-300 rounded-md text-xs text-text-primary">
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
                  <div className="flex items-center gap-2 text-sm text-text-primary">
                    <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="font-medium text-[var(--color-info)]">{formatGroup(comp.group1)}</span>
                    <span className="text-text-muted">vs</span>
                    <span className="font-medium text-[var(--color-error)]">{formatGroup(comp.group2)}</span>
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

      {/* ===== SECTION 3: Covariates (MSstats only - TMT) ===== */}
      {selectedPipeline === 'msstats' && conditionColumns.length > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="font-semibold text-text-primary">Covariates</h2>
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
          onClick={() => router.push(`${backRoute}?session=${sessionId}`)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary bg-surface border border-border rounded-lg hover:bg-border/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {analysisType === 'ptm' ? 'Back to Upload' : 'Back to Metadata'}
        </button>
        <button
          data-testid="comparisons-continue-btn"
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
    <Suspense fallback={<div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>}>
      <ComparisonsContent />
    </Suspense>
  );
}
