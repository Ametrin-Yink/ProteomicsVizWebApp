'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp, RotateCcw, HelpCircle } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';

interface FilterPanelProps {
  foldChange: number;
  pValue: number;
  adjPValue: number;
  s0: number; // Stored as fraction of foldChange (0-1)
  onChange: (filters: { foldChange: number; pValue: number; adjPValue: number; s0: number }) => void;
  onReset: () => void;
}

export function FilterPanel({ foldChange, pValue, adjPValue, s0, onChange, onReset }: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const actualS0 = s0 * foldChange;
  const s0Percent = Math.round(s0 * 100);

  return (
    <div className="bg-background rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-primary">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="font-medium">Filters</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onReset}
            className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-primarytransition-colors"
            title="Reset filters to defaults"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label="Toggle filters"
            className="p-1.5 hover:bg-surface rounded text-text-muted hover:text-text-primarytransition-colors"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-3 pt-3 border-t border-border mt-3">
          {/* Row 1: Fold Change + P-value */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primarymb-2">
                log₂ Fold Change Threshold
              </label>
              <div className="flex items-center gap-2">
                <Slider
                  value={foldChange}
                  min={0}
                  max={5}
                  step={0.1}
                  onChange={(value) => onChange({ foldChange: value, pValue, adjPValue, s0 })}
                  label="log₂ Fold Change Threshold"
                />
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={foldChange}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value >= 0 && value <= 5) {
                      onChange({ foldChange: value, pValue, adjPValue, s0 });
                    }
                  }}
                  className="w-20 px-2 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primarymb-2">
                P-value Threshold
              </label>
              <div className="flex items-center gap-2">
                <Slider
                  value={pValue}
                  min={0.001}
                  max={0.2}
                  step={0.001}
                  onChange={(value) => onChange({ foldChange, pValue: value, adjPValue, s0 })}
                  label="P-value Threshold"
                />
                <input
                  type="number"
                  min={0.001}
                  max={0.2}
                  step={0.001}
                  value={pValue}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value >= 0.001 && value <= 0.2) {
                      onChange({ foldChange, pValue: value, adjPValue, s0 });
                    }
                  }}
                  className="w-24 px-2 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Adj P-value + S0 Factor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primarymb-2">
                Adj P-value Threshold
              </label>
              <div className="flex items-center gap-2">
                <Slider
                  value={adjPValue}
                  min={0.001}
                  max={1}
                  step={0.001}
                  onChange={(value) => onChange({ foldChange, pValue, adjPValue: value, s0 })}
                  label="Adj P-value Threshold"
                />
                <input
                  type="number"
                  min={0.001}
                  max={1}
                  step={0.001}
                  value={adjPValue}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (!isNaN(value) && value >= 0.001 && value <= 1) {
                      onChange({ foldChange, pValue, adjPValue: value, s0 });
                    }
                  }}
                  className="w-24 px-2 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primarymb-2">
                S0 Factor
                <span className="group relative inline-block ml-1">
                  <HelpCircle className="w-3.5 h-3.5 text-text-muted cursor-help" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-text-primarybg-background border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50 pointer-events-none">
                    S0 factor widens the significance threshold at low fold changes. Higher values are more permissive, allowing proteins with small fold changes but high reproducibility to appear significant.
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Slider
                  value={s0}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => onChange({ foldChange, pValue, adjPValue, s0: value })}
                  label="S0 Factor"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={s0Percent}
                  onChange={(e) => {
                    const pct = parseInt(e.target.value, 10);
                    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                      onChange({ foldChange, pValue, adjPValue, s0: pct / 100 });
                    }
                  }}
                  className="w-16 px-2 py-1 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-sm text-text-muted">
                  (S0 = {actualS0.toFixed(2)})
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
