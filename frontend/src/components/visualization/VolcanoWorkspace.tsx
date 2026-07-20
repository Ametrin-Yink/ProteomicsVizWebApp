'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { SearchableSelect } from '@/components/ui/Select';

export interface VolcanoComparisonOption {
  value: string;
  label: string;
}

export interface VolcanoDifferentialCounts {
  total: number;
  up: number;
  down: number;
}

interface VolcanoSummaryBarProps {
  title: string;
  comparisonOptions: VolcanoComparisonOption[];
  selectedComparison: string;
  onComparisonChange: (value: string) => void;
  fallbackComparison?: string;
  entityCount: number;
  entityLabel: string;
  differentialCounts: VolcanoDifferentialCounts;
  batchSelection: Set<string>;
  onBatchSelectionChange: (selection: Set<string>) => void;
  onBatchMark: () => void | Promise<void>;
  batchLoading?: boolean;
}

export function VolcanoSummaryBar({
  title,
  comparisonOptions,
  selectedComparison,
  onComparisonChange,
  fallbackComparison = 'Treatment vs Control',
  entityCount,
  entityLabel,
  differentialCounts,
  batchSelection,
  onBatchSelectionChange,
  onBatchMark,
  batchLoading = false,
}: VolcanoSummaryBarProps) {
  const [batchOpen, setBatchOpen] = useState(false);
  const batchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!batchOpen) return;
    const close = (event: MouseEvent) => {
      if (batchRef.current && !batchRef.current.contains(event.target as Node)) {
        setBatchOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [batchOpen]);

  const allSelected = comparisonOptions.length > 0
    && comparisonOptions.every((option) => batchSelection.has(option.value));

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-5 py-3 text-sm"
      data-testid="general-info-panel"
    >
      <span className="font-semibold text-text-primary">{title}</span>
      <div className="h-4 w-px bg-border" />
      {comparisonOptions.length > 0 ? (
        <SearchableSelect
          options={comparisonOptions}
          value={selectedComparison}
          onChange={onComparisonChange}
          placeholder="Select comparison..."
          searchPlaceholder="Filter comparisons..."
          className="min-w-[280px]"
        />
      ) : (
        <span className="text-text-secondary">{fallbackComparison}</span>
      )}
      <div className="h-4 w-px bg-border" />
      <span className="text-text-secondary">
        {entityCount.toLocaleString()} {entityLabel}
      </span>
      <div className="h-4 w-px bg-border" />
      <span className="text-text-secondary">
        {differentialCounts.total.toLocaleString()} DE (
        <span className="font-semibold text-primary">
          {differentialCounts.up.toLocaleString()}↑
        </span>{' '}
        <span className="font-semibold text-secondary">
          {differentialCounts.down.toLocaleString()}↓
        </span>
        )
      </span>
      <div className="h-4 w-px bg-border" />
      <div className="relative" ref={batchRef}>
        <button
          type="button"
          onClick={() => setBatchOpen((current) => !current)}
          disabled={batchLoading}
          className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-border/30 disabled:opacity-50"
        >
          {batchLoading ? 'Marking...' : 'Mark Significant in Batch'}
        </button>
        {batchOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 w-72 space-y-2 rounded-lg border border-border bg-background p-3 shadow-lg">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onBatchSelectionChange(
                  allSelected
                    ? new Set()
                    : new Set(comparisonOptions.map((option) => option.value)),
                )}
                className="rounded border-border"
              />
              Select All
            </label>
            <div className="max-h-48 space-y-1 overflow-y-auto border-t border-border pt-2">
              {comparisonOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary hover:text-text-primary"
                >
                  <input
                    type="checkbox"
                    checked={batchSelection.has(option.value)}
                    onChange={() => {
                      const next = new Set(batchSelection);
                      if (next.has(option.value)) next.delete(option.value);
                      else next.add(option.value);
                      onBatchSelectionChange(next);
                    }}
                    className="rounded border-border"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setBatchOpen(false);
                void onBatchMark();
              }}
              disabled={batchSelection.size === 0}
              className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Mark {batchSelection.size > 0 ? `${batchSelection.size} comparison(s)` : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function VolcanoWorkspace({
  children,
  details,
}: {
  children: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">{children}</div>
      <div className="lg:col-span-1">{details}</div>
    </div>
  );
}
