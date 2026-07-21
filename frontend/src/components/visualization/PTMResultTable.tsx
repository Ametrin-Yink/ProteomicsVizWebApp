'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Eraser } from 'lucide-react';
import type { VolcanoFilters } from '@/types/api';
import { formatNumber, formatPValue, isSignificantVolcano } from '@/lib/utils';

export interface PTMResultRow {
  id: string;
  display: string;
  accession: string;
  gene: string;
  localization: string;
  mapping: string;
  logFC: number | null;
  pValue: number | null;
  adjPValue: number | null;
  status: string;
  raw: Record<string, unknown>;
}

interface Props {
  data: PTMResultRow[];
  layer: 'ptm' | 'protein' | 'adjusted';
  selectedIds: Set<string>;
  markedIds: Set<string>;
  filters: VolcanoFilters;
  downloadUrl: string;
  onSelect: (row: PTMResultRow) => void;
  onToggleMark: (row: PTMResultRow) => void;
  onMarkAllSignificant: () => void;
  onClearAllMarks: () => void;
}

const ITEMS_PER_PAGE = 25;

export default function PTMResultTable({
  data,
  layer,
  selectedIds,
  markedIds,
  filters,
  downloadUrl,
  onSelect,
  onToggleMark,
  onMarkAllSignificant,
  onClearAllMarks,
}: Props) {
  const [sortKey, setSortKey] = useState<'significant' | 'display' | 'gene' | 'logFC' | 'pValue' | 'adjPValue'>('significant');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return query
      ? data.filter((row) => [row.display, row.accession, row.gene, row.localization]
          .some((value) => value.toLowerCase().includes(query)))
      : data;
  }, [data, filterText]);

  const sorted = useMemo(() => {
    return [...filtered].sort((left, right) => {
      let result = 0;
      if (sortKey === 'significant') {
        result = Number(isSignificantVolcano(
          left.logFC ?? 0,
          left.pValue ?? 1,
          left.adjPValue ?? 1,
          filters,
        )) - Number(isSignificantVolcano(
          right.logFC ?? 0,
          right.pValue ?? 1,
          right.adjPValue ?? 1,
          filters,
        ));
      } else if (sortKey === 'display' || sortKey === 'gene') {
        result = left[sortKey].localeCompare(right[sortKey]);
      } else {
        result = (left[sortKey] ?? Number.POSITIVE_INFINITY)
          - (right[sortKey] ?? Number.POSITIVE_INFINITY);
      }
      return sortDirection === 'asc' ? result : -result;
    });
  }, [filtered, filters, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const paginated = sorted.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const handleSort = (key: typeof sortKey) => {
    if (key === sortKey) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const sortIndicator = (key: typeof sortKey) => {
    if (sortKey !== key) return <span className="ml-1 text-text-muted">↕</span>;
    return sortDirection === 'asc'
      ? <ChevronUp className="ml-1 inline h-4 w-4" />
      : <ChevronDown className="ml-1 inline h-4 w-4" />;
  };

  const headerClass = 'cursor-pointer px-4 py-3 font-medium text-text-secondary hover:bg-surface';

  return (
    <div className="rounded-lg border border-border bg-background" data-testid="ptm-results-table">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text-primary">
            {layer === 'protein' ? 'Protein Results' : 'PTM Site Results'}
          </h3>
          <span className="text-sm text-text-muted">{filtered.length.toLocaleString()} entries</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={filterText}
            onChange={(event) => {
              setFilterText(event.target.value);
              setCurrentPage(1);
            }}
            placeholder={layer === 'protein' ? 'Filter proteins...' : 'Filter sites...'}
            className="rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="ptm-table-filter"
          />
          <button
            type="button"
            onClick={onMarkAllSignificant}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            Mark All Significant
          </button>
          {markedIds.size > 0 && (
            <button
              type="button"
              onClick={onClearAllMarks}
              className="flex items-center gap-2 rounded-md border-error/30 bg-background px-3 py-2 text-sm font-medium text-error hover:bg-error/5"
            >
              <Eraser className="h-4 w-4" /> Clear All Markers ({markedIds.size})
            </button>
          )}
          <a
            href={downloadUrl}
            download="ptm_results.zip"
            className="flex items-center gap-2 rounded-md border-border bg-background px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface"
          >
            <Download className="h-4 w-4" /> Download Results
          </a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              <th className="w-12 px-2 py-3 text-center font-medium text-text-secondary">Mark</th>
              <th onClick={() => handleSort('display')} className={`${headerClass} text-left`}>
                {layer === 'protein' ? 'Protein' : 'PTM Site'} {sortIndicator('display')}
              </th>
              <th onClick={() => handleSort('gene')} className={`${headerClass} text-left`}>
                Gene {sortIndicator('gene')}
              </th>
              {layer !== 'protein' && <th className="px-4 py-3 text-left font-medium text-text-secondary">Localization</th>}
              <th onClick={() => handleSort('logFC')} className={`${headerClass} text-right`}>
                Log2 FC {sortIndicator('logFC')}
              </th>
              <th onClick={() => handleSort('pValue')} className={`${headerClass} text-right`}>
                P-value {sortIndicator('pValue')}
              </th>
              <th onClick={() => handleSort('adjPValue')} className={`${headerClass} text-right`}>
                Adj P-value {sortIndicator('adjPValue')}
              </th>
              <th onClick={() => handleSort('significant')} className={`${headerClass} text-center`}>
                Significance {sortIndicator('significant')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginated.map((row) => {
              const significant = isSignificantVolcano(
                row.logFC ?? 0,
                row.pValue ?? 1,
                row.adjPValue ?? 1,
                filters,
              );
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelect(row)}
                  className={`cursor-pointer transition-colors hover:bg-primary/5 ${
                    selectedIds.has(row.id) ? 'bg-primary/10 ring-2 ring-inset ring-primary' : ''
                  }`}
                >
                  <td className="px-2 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={markedIds.has(row.id)}
                      onChange={() => onToggleMark(row)}
                      className="cursor-pointer rounded border-border text-primary focus:ring-primary"
                      title="Mark in volcano plot"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-text-primary">{row.display}</td>
                  <td className="px-4 py-3 text-text-secondary">{row.gene || '-'}</td>
                  {layer !== 'protein' && <td className="px-4 py-3 text-text-secondary">{row.localization || '-'}</td>}
                  <td className={`px-4 py-3 text-right font-medium ${
                    (row.logFC ?? 0) > 0 ? 'text-primary' : 'text-secondary'
                  }`}>
                    {(row.logFC ?? 0) > 0 ? '+' : ''}{row.logFC === null ? '-' : formatNumber(row.logFC, 3)}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">{row.pValue === null ? '-' : formatPValue(row.pValue)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{row.adjPValue === null ? '-' : formatPValue(row.adjPValue)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      significant ? 'bg-success/10 text-success' : 'bg-surface text-text-secondary'
                    }`}>
                      {significant ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <div className="text-sm text-text-muted">
            Showing {(page - 1) * ITEMS_PER_PAGE + 1} to {Math.min(page * ITEMS_PER_PAGE, sorted.length)} of {sorted.length} results
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="rounded-md border-border bg-background px-3 py-1 text-sm font-medium text-text-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-text-secondary">Page {page} of {totalPages}</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={page}
              onChange={(event) => setCurrentPage(Math.min(totalPages, Math.max(1, Number(event.target.value))))}
              className="w-14 rounded-md border border-border px-1 py-1 text-center text-sm"
            />
            <button
              type="button"
              onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="rounded-md border-border bg-background px-3 py-1 text-sm font-medium text-text-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
