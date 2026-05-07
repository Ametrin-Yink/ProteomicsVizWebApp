'use client';

import React, { useState, useMemo } from 'react';
import type { DEResult, SortConfig, VolcanoFilters } from '@/types/api';
import { formatNumber, formatPValue, exportToCSV, isSignificantVolcano } from '@/lib/utils';
import { ChevronUp, ChevronDown, Download, Eraser } from 'lucide-react';

interface ProteinTableProps {
  data: DEResult[];
  selectedProteins: Set<string>;
  onSelectProtein: (protein: DEResult) => void;
  filters: VolcanoFilters;
  sessionConfig: { treatment?: string; control?: string; experiment: string } | null;
  comparisonLabel?: string;
  markedProteins: Set<string>;
  onToggleMark: (protein: DEResult) => void;
  onClearAllMarks: () => void;
  onMarkAllSignificant: () => void;
}

const ITEMS_PER_PAGE = 25;

interface SortIndicatorProps {
  sortKey: string;
  columnKey: string;
  direction: 'asc' | 'desc';
}

const SortIndicator: React.FC<SortIndicatorProps> = ({ sortKey, columnKey, direction }) => {
  if (sortKey !== columnKey) {
    return <span className="text-text-muted ml-1" data-testid="sort-indicator">↕</span>;
  }
  return direction === 'asc' ? (
    <ChevronUp className="w-4 h-4 ml-1 inline" data-testid="sort-indicator" />
  ) : (
    <ChevronDown className="w-4 h-4 ml-1 inline" data-testid="sort-indicator-desc" />
  );
};

export default function ProteinTable({
  data,
  selectedProteins,
  onSelectProtein,
  filters,
  sessionConfig,
  comparisonLabel,
  markedProteins,
  onToggleMark,
  onClearAllMarks,
  onMarkAllSignificant,
}: ProteinTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'significant',
    direction: 'desc',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [filterText, setFilterText] = useState('');

  // Filter data
  const filteredData = useMemo(() => {
    let filtered = data;

    // Filter by search text
    if (filterText.trim()) {
      const search = filterText.toLowerCase();
      filtered = filtered.filter((item) =>
        item.master_protein_accessions.toLowerCase().includes(search) ||
        (item.gene_name && item.gene_name.toLowerCase().includes(search))
      );
    }

    return filtered;
  }, [data, filterText]);

  // Sort data
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      // For 'significant' key, use computed significance based on current filters
      if (sortConfig.key === 'significant') {
        const aSig = isSignificantVolcano(a.log_fc, a.pval, a.adj_pval, filters);
        const bSig = isSignificantVolcano(b.log_fc, b.pval, b.adj_pval, filters);
        return sortConfig.direction === 'asc'
          ? Number(aSig) - Number(bSig)
          : Number(bSig) - Number(aSig);
      }

      const aValue = a[sortConfig.key as keyof DEResult];
      const bValue = b[sortConfig.key as keyof DEResult];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
        return sortConfig.direction === 'asc'
          ? Number(aValue) - Number(bValue)
          : Number(bValue) - Number(aValue);
      }

      return 0;
    });
    return sorted;
  }, [filteredData, sortConfig, filters]);

  // Paginate data
  const totalPages = Math.ceil(sortedData.length / ITEMS_PER_PAGE);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedData.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedData, currentPage]);

  // Handle sort
  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
    setCurrentPage(1);
  };

  // Handle CSV export
  const handleExport = () => {
    const exportData = sortedData.map((item) => {
      const isSig = isSignificantVolcano(item.log_fc, item.pval, item.adj_pval, filters);
      return {
        Protein: item.master_protein_accessions,
        'Gene Name': item.gene_name,
        'Log2 FC': item.log_fc,
        'P-value': item.pval,
        'Adj P-value': item.adj_pval,
        Significance: isSig ? 'Significant' : 'Not Significant',
      };
    });

    const filename = sessionConfig
      ? `${sessionConfig.experiment}_${comparisonLabel || 'results'}`
      : 'protein_results';
    exportToCSV(exportData, `${filename}.csv`);
  };

  return (
    <div className="bg-background rounded-lg border border-border" data-testid="protein-table">
      {/* Header with controls */}
      <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text-primary">Protein Results</h3>
          <span className="text-sm text-text-muted">
            {filteredData.length} proteins
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter input */}
          <input
            data-testid="table-filter"
            type="text"
            placeholder="Filter proteins..."
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value);
              setCurrentPage(1);
            }}
            className="px-3 py-2 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />

          <button
            onClick={onMarkAllSignificant}
            className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            Mark All Significant
          </button>

          {markedProteins.size > 0 && (
            <button
              onClick={onClearAllMarks}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-error bg-background border-error/30 rounded-md hover:bg-error/5 focus:outline-none focus:ring-2 focus:ring-error"
              data-testid="clear-all-marks-btn"
            >
              <Eraser className="w-4 h-4" />
              Clear All Markers ({markedProteins.size})
            </button>
          )}

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary bg-background border-border rounded-md hover:bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            data-testid="export-csv-btn"
          >
            <Download className="w-4 h-4" />
            Export All
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              <th
                className="px-2 py-3 text-center font-medium text-text-secondary w-12"
                data-testid="table-header-mark"
              >
                Mark
              </th>
              <th
                onClick={() => handleSort('master_protein_accessions')}
                className="px-4 py-3 text-left font-medium text-text-secondary cursor-pointer hover:bg-surface"
                data-testid="table-header-accession"
              >
                Protein <SortIndicator columnKey="master_protein_accessions" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('gene_name')}
                className="px-4 py-3 text-left font-medium text-text-secondary cursor-pointer hover:bg-surface"
                data-testid="table-header-gene"
              >
                Gene Name <SortIndicator columnKey="gene_name" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('log_fc')}
                className="px-4 py-3 text-right font-medium text-text-secondary cursor-pointer hover:bg-surface"
                data-testid="table-header-logfc"
              >
                Log2 FC <SortIndicator columnKey="log_fc" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('pval')}
                className="px-4 py-3 text-right font-medium text-text-secondary cursor-pointer hover:bg-surface"
                data-testid="table-header-pvalue"
              >
                P-value <SortIndicator columnKey="pval" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('adj_pval')}
                className="px-4 py-3 text-right font-medium text-text-secondary cursor-pointer hover:bg-surface"
              >
                Adj P-value <SortIndicator columnKey="adj_pval" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('significant')}
                className="px-4 py-3 text-center font-medium text-text-secondary cursor-pointer hover:bg-surface"
              >
                Significance <SortIndicator columnKey="significant" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedData.map((item, index) => (
              <tr
                key={`${item.master_protein_accessions}-${index}`}
                onClick={() => onSelectProtein(item)}
                className={`cursor-pointer hover:bg-primary/5 transition-colors ${
                  selectedProteins.has(item.master_protein_accessions)
                    ? 'bg-primary/10 ring-2 ring-primary ring-inset'
                    : ''
                }`}
                data-testid="protein-table-row"
              >
                <td
                  className="px-2 py-3 text-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={markedProteins.has(item.master_protein_accessions)}
                    onChange={() => onToggleMark(item)}
                    className="rounded border-border text-primary focus:ring-primary cursor-pointer"
                    data-testid="mark-checkbox"
                    title="Mark in volcano plot"
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  {item.master_protein_accessions.split(/[,;]/).map((acc, idx, arr) => (
                    <span key={acc.trim()}>
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${acc.trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-secondary hover:text-secondary-dark hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {acc.trim()}
                      </a>
                      {idx < arr.length - 1 && '; '}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-text-secondary">{item.gene_name || '-'}</td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    item.log_fc > 0 ? 'text-primary' : 'text-secondary'
                  }`}
                >
                  {item.log_fc > 0 ? '+' : ''}{formatNumber(item.log_fc, 3)}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {formatPValue(item.pval)}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {formatPValue(item.adj_pval)}
                </td>
                <td className="px-4 py-3 text-center">
                  {(() => {
                    const isSig = isSignificantVolcano(item.log_fc, item.pval, item.adj_pval, filters);
                    return (
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          isSig
                            ? 'bg-success/10 text-success'
                            : 'bg-surface text-text-secondary'
                        }`}
                      >
                        {isSig ? 'Yes' : 'No'}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between" data-testid="pagination">
          <div className="text-sm text-text-muted">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of{' '}
            {sortedData.length} results
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-text-secondary bg-background border-border rounded-md hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <span className="text-sm text-text-secondary" data-testid="page-number">
              Page {currentPage} of {totalPages}
            </span>

            <div className="flex items-center gap-1 ml-2">
              <input
                type="number"
                min={1}
                max={totalPages}
                defaultValue={currentPage}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const page = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(page) && page >= 1 && page <= totalPages) {
                      setCurrentPage(page);
                    }
                  }
                }}
                onBlur={(e) => {
                  const page = parseInt(e.target.value, 10);
                  if (!isNaN(page) && page >= 1 && page <= totalPages) {
                    setCurrentPage(page);
                  } else {
                    (e.target as HTMLInputElement).value = String(currentPage);
                  }
                }}
                className="w-14 px-1 py-1 text-sm text-center border border-border rounded-md"
                data-testid="page-input"
              />
            </div>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-text-secondary bg-background border-border rounded-md hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="next-page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
