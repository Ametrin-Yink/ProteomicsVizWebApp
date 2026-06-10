'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTooltipProps {
  text: string;
  className?: string;
}

/**
 * A help circle icon with a hover tooltip.
 * Matches the pattern used in FilterPanel.tsx.
 */
export function HelpTooltip({ text, className = '' }: HelpTooltipProps) {
  return (
    <span className={`group relative inline-block ml-1 ${className}`}>
      <HelpCircle className="w-3.5 h-3.5 text-text-muted cursor-help inline-block" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 text-xs text-text-primary bg-background border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50 pointer-events-none">
        {text}
      </span>
    </span>
  );
}

export default HelpTooltip;
