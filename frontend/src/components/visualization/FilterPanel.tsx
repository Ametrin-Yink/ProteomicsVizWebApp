'use client';

import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { Slider } from '@/components/ui/Slider';

interface FilterPanelProps {
  foldChange: number;
  pValue: number;
  adjPValue: number;
  onChange: (filters: { foldChange: number; pValue: number; adjPValue: number }) => void;
}

export function FilterPanel({ foldChange, pValue, adjPValue, onChange }: FilterPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-700">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="font-medium">Filters</span>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label="Toggle filters"
          className="p-1 hover:bg-gray-100 rounded"
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fold Change Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={foldChange}
                min={0}
                max={5}
                step={0.5}
                onChange={(value) => onChange({ foldChange: value, pValue, adjPValue })}
                label="Fold Change Threshold"
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
                    onChange({ foldChange: value, pValue, adjPValue });
                  }
                }}
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#E73564]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              P-value Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={pValue}
                min={0.001}
                max={1}
                step={0.001}
                onChange={(value) => onChange({ foldChange, pValue: value, adjPValue })}
                label="P-value Threshold"
              />
              <input
                type="number"
                min={0.001}
                max={1}
                step={0.001}
                value={pValue}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!isNaN(value) && value >= 0.001 && value <= 1) {
                    onChange({ foldChange, pValue: value, adjPValue });
                  }
                }}
                className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#E73564]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Adj P-value Threshold
            </label>
            <div className="flex items-center gap-2">
              <Slider
                value={adjPValue}
                min={0.001}
                max={1}
                step={0.001}
                onChange={(value) => onChange({ foldChange, pValue, adjPValue: value })}
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
                    onChange({ foldChange, pValue, adjPValue: value });
                  }
                }}
                className="w-24 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#E73564]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
