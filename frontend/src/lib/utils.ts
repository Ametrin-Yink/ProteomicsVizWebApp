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

  // Hyperbolic S0-factor cutoff: y = c / (|x| - s0)
  const pLog10Threshold = -Math.log10(pValThreshold);
  const c = pLog10Threshold * (foldChange - actualS0);
  const y = -Math.log10(pValue);
  const absX = Math.abs(logFC);

  if (absX <= actualS0) return false;
  return y > c / (absX - actualS0);
}

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
