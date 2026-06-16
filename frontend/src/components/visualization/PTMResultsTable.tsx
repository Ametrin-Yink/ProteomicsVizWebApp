'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface PTMResultsTableProps {
  sessionId: string;
}

interface TableRow {
  site: string;
  globalProtein: string;
  log2FC: number;
  pvalue: number;
  adjPvalue: number;
  isAdjusted: boolean;
}

interface SortConfig {
  key: keyof TableRow;
  direction: 'asc' | 'desc';
}

/** Attempt to extract a numeric field from a row dict, trying multiple key variants. */
function getNumeric(row: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

/** Extract the site portion from a composite identifier like "P05023_S99". */
function extractSite(protein: string): string {
  // MSstatsPTM encodes site in Protein column as "UniProtID_Site", e.g. "P05023_S99"
  const parts = protein.split('_');
  if (parts.length >= 2) {
    // The last part is typically the site (e.g., "S99", "T205", "Y402")
    const candidate = parts[parts.length - 1];
    if (/^[ASTY]\d+$/.test(candidate)) return candidate;
    // Fallback: try the last two parts
    if (parts.length >= 3) return parts.slice(-2).join('_');
    return candidate;
  }
  return protein;
}

/** Extract the protein portion from a composite identifier like "P05023_S99". */
function extractProtein(protein: string): string {
  const parts = protein.split('_');
  if (parts.length >= 2 && /^[ASTY]\d+$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join('_');
  }
  return protein;
}

/** Normalize a raw API row into a TableRow. */
function normalizeRow(
  row: Record<string, unknown>,
  isAdjusted: boolean,
  fcFallbackKeys: string[],
  pvalFallbackKeys: string[],
): TableRow {
  const rawId = String(row.site ?? row.Protein ?? row.protein ?? row.id ?? '');
  const site = extractSite(rawId);
  const globalProtein = String(row.globalProtein ?? row.GlobalProtein ?? extractProtein(rawId));

  const log2FC = getNumeric(row, ...fcFallbackKeys, 'log2FC', 'logFC');
  const pvalue = getNumeric(row, ...pvalFallbackKeys, 'pvalue', 'Pvalue', 'p_val') || 1;
  const adjPvalue = getNumeric(row, 'adj.pvalue', 'adj_pvalue', 'adjPvalue', 'adjustedPvalue', 'ptmAdjPvalue') || 1;

  return { site, globalProtein, log2FC, pvalue, adjPvalue, isAdjusted };
}

export default function PTMResultsTable({ sessionId }: PTMResultsTableProps) {
  const [comparisons, setComparisons] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortConfig>({ key: 'adjPvalue', direction: 'asc' });

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/sessions/${sessionId}/ptm/results`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const comps = json.data?.comparisons ?? json.comparisons ?? [];
        setComparisons(comps);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const currentComparison = comparisons[selectedIdx] as Record<string, unknown> | undefined;
  const label = String(currentComparison?.label ?? '');
  const comparisonLabels = comparisons.map((c) => String(c.label ?? ''));

  // Combine and normalize rows from available models
  const rows = useMemo<TableRow[]>(() => {
    if (!currentComparison) return [];

    const ptmRows = (currentComparison.ptm_model as Record<string, unknown>[] | undefined) ?? [];
    const adjustedRows = (currentComparison.adjusted_model as Record<string, unknown>[] | undefined) ?? [];

    // Prefer adjusted model if available; fall back to PTM model
    const sourceRows = adjustedRows.length > 0 ? adjustedRows : ptmRows;
    const isAdjusted = adjustedRows.length > 0;

    return sourceRows.map((row) =>
      normalizeRow(row, isAdjusted,
        isAdjusted ? ['adjustedLog2FC', 'AdjustedLog2FC'] : ['ptmLog2FC', 'PtmLog2FC'],
        isAdjusted ? ['adjustedPvalue', 'AdjustedPvalue'] : ['ptmPvalue', 'PtmPvalue'],
      )
    );
  }, [currentComparison]);

  // Apply search filter
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.site.toLowerCase().includes(q) ||
        r.globalProtein.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Apply sorting
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let cmp = 0;
      const aVal = a[sort.key];
      const bVal = b[sort.key];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }
      return sort.direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredRows, sort]);

  const handleSort = useCallback((key: keyof TableRow) => {
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const comparisonSelect = comparisonLabels.length > 1 ? (
    <select
      value={selectedIdx}
      onChange={(e) => setSelectedIdx(Number(e.target.value))}
      className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-text-primary"
      data-testid="comparison-select"
    >
      {comparisonLabels.map((l, i) => (
        <option key={l} value={i}>{l.replace(/_vs_/g, ' vs ')}</option>
      ))}
    </select>
  ) : null;

  // Sort icon for column header
  const SortIcon = ({ columnKey }: { columnKey: keyof TableRow }) => {
    if (sort.key !== columnKey) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />;
    return sort.direction === 'asc'
      ? <ArrowUp className="w-3 h-3 inline ml-1" />
      : <ArrowDown className="w-3 h-3 inline ml-1" />;
  };

  if (loading) {
    return (
      <div data-testid="ptm-results-table" className="bg-background rounded-lg border border-border">
        <div className="p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary">PTM Results</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                {['Site', 'Global Protein', 'log2FC (Adjusted)', 'p-value', 'Significant'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-surface rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="ptm-results-table" className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-error text-sm mb-2">Failed to load PTM results.</p>
          <p className="text-text-muted text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (sortedRows.length === 0) {
    return (
      <div data-testid="ptm-results-table" className="bg-background rounded-lg border border-border p-8">
        <div className="text-center py-8">
          <p className="text-text-muted text-sm">No PTM results available for this session.</p>
          <p className="text-text-muted text-xs mt-1">Run the PTM pipeline to generate results.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="ptm-results-table" className="bg-background rounded-lg border border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">PTM Results</h3>
            {label && (
              <p className="text-sm text-text-muted mt-1">
                Comparison: {label.replace(/_vs_/g, ' vs ')}
              </p>
            )}
          </div>
          {comparisonSelect}
        </div>

        {/* Search bar */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by site or protein..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="results-search-input"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              {([
                { key: 'site' as const, label: 'Site' },
                { key: 'globalProtein' as const, label: 'Global Protein' },
                { key: 'log2FC' as const, label: 'log2FC (Adjusted)' },
                { key: 'adjPvalue' as const, label: 'p-value' },
                { key: 'isAdjusted' as const, label: 'Adjusted' },
              ]).map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left font-medium text-text-secondary cursor-pointer hover:text-text-primary select-none"
                  onClick={() => handleSort(col.key)}
                  data-testid={`table-header-${col.key}`}
                >
                  {col.label}
                  <SortIcon columnKey={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedRows.map((row, i) => {
              const isSignificant = row.adjPvalue < 0.05;
              return (
                <tr
                  key={`${row.site}-${i}`}
                  className={`hover:bg-surface/50 transition-colors ${
                    isSignificant ? 'bg-primary/5' : ''
                  }`}
                  data-testid={`table-row-${i}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-text-primary whitespace-nowrap">
                    {row.site}
                  </td>
                  <td className="px-4 py-3 text-text-primary whitespace-nowrap">
                    {row.globalProtein}
                  </td>
                  <td className="px-4 py-3 text-text-primary whitespace-nowrap font-mono">
                    {row.log2FC.toFixed(3)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-mono">
                    <span className={isSignificant ? 'text-error font-medium' : 'text-text-secondary'}>
                      {row.adjPvalue < 0.0001 ? row.adjPvalue.toExponential(2) : row.adjPvalue.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.isAdjusted ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                        Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface text-text-muted">
                        No
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border text-xs text-text-muted flex items-center justify-between">
        <span>
          Showing {sortedRows.length} of {filteredRows.length} site{filteredRows.length !== 1 ? 's' : ''}
          {search ? ` (filtered from ${rows.length})` : ''}
        </span>
        <span>
          {sortedRows.filter((r) => r.adjPvalue < 0.05).length} significant
        </span>
      </div>
    </div>
  );
}
