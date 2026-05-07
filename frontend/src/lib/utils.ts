/**
 * Utility functions
 * Following AGENTS/03-coding-standards.md
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with proper precedence
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a timestamp to a human-readable string
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// CSV Export utility
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  headers?: { key: string; label: string }[]
) {
  if (data.length === 0) return;

  const columns = headers || Object.keys(data[0]).map((key) => ({ key, label: key }));

  // Create CSV header
  const csvHeader = columns.map((col) => `"${col.label}"`).join(',');

  // Create CSV rows
  const csvRows = data.map((row) =>
    columns
      .map((col) => {
        const value = row[col.key];
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        // Escape quotes and wrap in quotes if contains comma or quote
        if (stringValue.includes(',') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return `"${stringValue}"`;
      })
      .join(',')
  );

  const csvContent = [csvHeader, ...csvRows].join('\n');

  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Format a group condition to a display string
export function formatGroup(g: Record<string, string>): string {
  return Object.entries(g).map(([, v]) => v).join('+') || '(any)';
}

// Format numbers for display
export function formatNumber(
  value: number | undefined | null,
  decimals: number = 3
): string {
  if (value === undefined || value === null) return '-';
  if (Math.abs(value) < 0.001 && value !== 0) {
    return value.toExponential(decimals);
  }
  return value.toFixed(decimals);
}

// Parse comma/semicolon-delimited strings (e.g., UniProt accessions, gene names)
export function parseDelimited(str: string): string[] {
  return str.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

// Format p-value with scientific notation if small
export function formatPValue(value: number | undefined | null): string {
  if (value === undefined || value === null) return '-';
  if (value < 0.001) {
    return value.toExponential(2);
  }
  return value.toFixed(4);
}

// Transform column-based PCA data to row-based for Plotly
export function transformPCARowBased(
  samples: string[],
  pc1: number[],
  pc2: number[],
  conditions: string[]
): Array<{ sample: string; pc1: number; pc2: number; condition: string }> {
  return samples.map((sample, i) => ({
    sample,
    pc1: pc1[i] || 0,
    pc2: pc2[i] || 0,
    condition: conditions[i] || 'Unknown',
  }));
}

// Calculate significance using hyperbolic S0-factor cutoff.
// When s0=0, falls back to standard rectangular cutoffs.
// s0 is expressed as a fraction of the foldChange threshold.
export function isSignificantVolcano(
  logFC: number,
  pValue: number,
  adjPValue: number,
  thresholds: { foldChange: number; pValue: number; adjPValue: number; s0: number }
): boolean {
  const { foldChange, pValue: pValThreshold, adjPValue: adjPValThreshold, s0 } = thresholds;
  const actualS0 = s0 * foldChange; // s0 stored as fraction of foldChange

  if (actualS0 === 0) {
    // Standard rectangular cutoff
    return (
      Math.abs(logFC) >= foldChange &&
      pValue <= pValThreshold &&
      adjPValue <= adjPValThreshold
    );
  }

  // Hyperbolic S0-factor cutoff: y = y0 + c / (|x| - actualS0)
  // where c = y0 * (foldChange - actualS0). The curve passes through (foldChange, 2*y0),
  // asymptotes to y0 (the p-value line) as |x| → ∞, and never crosses below it.
  // The vertical asymptote is at |x| = actualS0 (not at foldChange), preserving
  // S0's role as the curve shape parameter.
  const pLog10Threshold = -Math.log10(pValThreshold);
  const c = pLog10Threshold * (foldChange - actualS0);
  const y = -Math.log10(pValue);
  const absX = Math.abs(logFC);

  if (absX <= actualS0) return false;
  return y > pLog10Threshold + c / (absX - actualS0);
}

/** Format a comparison key like "A_vs_B" to "A vs B". Optionally truncate. */
export function formatComparisonKey(key: string, maxLength?: number): string {
  const formatted = key.replace(/_vs_/g, ' vs ');
  return maxLength ? truncateText(formatted, maxLength) : formatted;
}

/** Format and wrap after " vs " for narrow axis labels. */
export function formatComparisonKeyWrapped(key: string): string {
  return key.replace(/_vs_/g, ' vs<br>');
}

export const CHART_COLORS = ['#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16'] as const;

export const COLORSCALE_CYAN_GREY_CORAL: unknown[][] = [
  [0, '#00ADEF'], [0.5, '#94a3b8'], [1, '#E73564'],
];

// grey at -log10(p)=1.3 (p=0.05) within 0–5 range → position 0.26
export const COLORSCALE_PVAL: unknown[][] = [
  [0, '#00ADEF'], [0.26, '#94a3b8'], [1, '#E73564'],
];

export const COLORSCALE_BLUE_WHITE_RED: unknown[][] = [
  [0, '#3b82f6'], [0.5, '#ffffff'], [1, '#ef4444'],
];

export const COLORSCALE_CYAN_CORAL: unknown[][] = [
  [0, '#06b6d4'], [0.25, '#9ca3af'], [0.5, '#ff6b6b'], [1, '#dc2626'],
];

// Get color based on significance (supports both rectangular and S0 hyperbolic cutoffs)
export function getVolcanoPointColor(
  logFC: number,
  pValue: number,
  adjPValue: number,
  thresholds: { foldChange: number; pValue: number; adjPValue: number; s0: number }
): string {
  const isSignificant = isSignificantVolcano(logFC, pValue, adjPValue, thresholds);

  if (!isSignificant) return '#6B7280'; // Grey

  return logFC > 0 ? '#E73564' : '#00ADEF'; // Pink (up) or Blue (down)
}

// Calculate significance label
export function getSignificanceLabel(
  logFC: number,
  pValue: number,
  adjPValue: number,
  thresholds: { foldChange: number; pValue: number; adjPValue: number; s0: number }
): string {
  const isSignificant = isSignificantVolcano(logFC, pValue, adjPValue, thresholds);

  if (!isSignificant) return 'Not Significant';
  return logFC > 0 ? 'Upregulated' : 'Downregulated';
}
