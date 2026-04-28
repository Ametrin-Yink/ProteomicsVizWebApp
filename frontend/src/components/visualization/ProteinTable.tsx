'use client';

import React, { useState, useMemo } from 'react';
import type { DEResult, SortConfig, VolcanoFilters } from '@/types/api';
import { formatNumber, formatPValue, exportToCSV, isSignificantVolcano } from '@/lib/utils';
import { ChevronUp, ChevronDown, Download } from 'lucide-react';

interface ProteinTableProps {
  data: DEResult[];
  selectedProteins: Set<string>;
  onSelectProtein: (protein: DEResult) => void;
  showSelectedOnly: boolean;
  onToggleShowSelected: () => void;
  filters: VolcanoFilters;
  sessionConfig: { treatment: string; control: string; experiment: string } | null;
}

const ITEMS_PER_PAGE = 25;

interface SortIndicatorProps {
  sortKey: string;
  columnKey: string;
  direction: 'asc' | 'desc';
}

const SortIndicator: React.FC<SortIndicatorProps> = ({ sortKey, columnKey, direction }) => {
  if (sortKey !== columnKey) {
    return <span className="text-gray-300 ml-1" data-testid="sort-indicator">↕</span>;
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
  showSelectedOnly,
  onToggleShowSelected,
  filters,
  sessionConfig,
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
    
    // Filter by selected proteins only
    if (showSelectedOnly) {
      filtered = filtered.filter((item) => selectedProteins.has(item.master_protein_accessions));
    }
    
    // Filter by search text
    if (filterText.trim()) {
      const search = filterText.toLowerCase();
      filtered = filtered.filter((item) =>
        item.master_protein_accessions.toLowerCase().includes(search) ||
        (item.gene_name && item.gene_name.toLowerCase().includes(search))
      );
    }
    
    return filtered;
  }, [data, selectedProteins, showSelectedOnly, filterText]);

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
      ? `${sessionConfig.experiment}_${sessionConfig.treatment}_vs_${sessionConfig.control}`
      : 'protein_results';
    exportToCSV(exportData, `${filename}.csv`);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200" data-testid="protein-table">
      {/* Header with controls */}
      <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-gray-900">Protein Results</h3>
          <span className="text-sm text-gray-500">
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
            className="px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          {selectedProteins.size > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showSelectedOnly}
                onChange={onToggleShowSelected}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                data-testid="significant-only-checkbox"
              />
              Show selected only ({selectedProteins.size})
            </label>
          )}

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="export-csv-btn"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                onClick={() => handleSort('master_protein_accessions')}
                className="px-4 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                data-testid="table-header-accession"
              >
                Protein <SortIndicator columnKey="master_protein_accessions" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('gene_name')}
                className="px-4 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                data-testid="table-header-gene"
              >
                Gene Name <SortIndicator columnKey="gene_name" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('log_fc')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                data-testid="table-header-logfc"
              >
                Log2 FC <SortIndicator columnKey="log_fc" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('pval')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
                data-testid="table-header-pvalue"
              >
                P-value <SortIndicator columnKey="pval" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('adj_pval')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Adj P-value <SortIndicator columnKey="adj_pval" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
              <th
                onClick={() => handleSort('significant')}
                className="px-4 py-3 text-center font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Significance <SortIndicator columnKey="significant" sortKey={sortConfig.key} direction={sortConfig.direction} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedData.map((item) => (
              <tr
                key={item.master_protein_accessions}
                onClick={() => onSelectProtein(item)}
                className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                  selectedProteins.has(item.master_protein_accessions)
                    ? 'bg-[#E73564]/10 ring-2 ring-[#E73564] ring-inset'
                    : ''
                }`}
                data-testid="protein-table-row"
              >
                <td className="px-4 py-3 font-medium">
                  {item.master_protein_accessions.split(/[,;]/).map((acc, idx, arr) => (
                    <span key={acc.trim()}>
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${acc.trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {acc.trim()}
                      </a>
                      {idx < arr.length - 1 && '; '}
                    </span>
                  ))}
                </td>
                <td className="px-4 py-3 text-gray-600">{item.gene_name || '-'}</td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    item.log_fc > 0 ? 'text-pink-600' : 'text-blue-600'
                  }`}
                >
                  {item.log_fc > 0 ? '+' : ''}{formatNumber(item.log_fc, 3)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatPValue(item.pval)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatPValue(item.adj_pval)}
                </td>
                <td className="px-4 py-3 text-center">
                  {(() => {
                    const isSig = isSignificantVolcano(item.log_fc, item.pval, item.adj_pval, filters);
                    return (
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                          isSig
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
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
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between" data-testid="pagination">
          <div className="text-sm text-gray-500">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of{' '}
            {sortedData.length} results
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <span className="text-sm text-gray-600" data-testid="page-number">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
