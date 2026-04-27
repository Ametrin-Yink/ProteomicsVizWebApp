'use client';

import React, { useState, useMemo } from 'react';
import type { GSEAResult } from '@/types/api';
import { formatPValue, exportToCSV } from '@/lib/utils';
import { ChevronUp, ChevronDown, Download, Search, X } from 'lucide-react';

interface PathwayTableProps {
  data: GSEAResult[];
  selectedPathway: GSEAResult | null;
  onSelectPathway: (pathway: GSEAResult) => void;
  // Server-side pagination
  totalResults: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  // Server-side sorting
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onSortChange: (key: string, order: 'asc' | 'desc') => void;
  // Server-side filtering
  significantOnly: boolean;
  onSignificantOnlyChange: (val: boolean) => void;
  // Server-side search
  search: string;
  onSearchChange: (val: string) => void;
}

interface SortIndicatorProps {
  sortKey: string;
  columnKey: string;
  direction: 'asc' | 'desc';
}

const SortIndicator: React.FC<SortIndicatorProps> = ({ sortKey, columnKey, direction }) => {
  if (sortKey !== columnKey) {
    return <span className="text-gray-300 ml-1">↕</span>;
  }
  return direction === 'asc' ? (
    <ChevronUp className="w-4 h-4 ml-1 inline" />
  ) : (
    <ChevronDown className="w-4 h-4 ml-1 inline" />
  );
};

export default function PathwayTable({
  data,
  selectedPathway,
  onSelectPathway,
  totalResults,
  currentPage,
  pageSize,
  onPageChange,
  sortBy,
  sortOrder,
  onSortChange,
  significantOnly,
  onSignificantOnlyChange,
  search,
  onSearchChange,
}: PathwayTableProps) {
  const [localFilterNES, setLocalFilterNES] = useState(true);

  // Data is already paginated and sorted from server
  // Only apply local NES filter if toggled
  const filteredData = useMemo(() => {
    if (localFilterNES) {
      return data.filter((item) => Math.abs(item.nes) >= 1);
    }
    return data;
  }, [data, localFilterNES]);

  const totalPages = Math.ceil(totalResults / pageSize);

  // Handle sort - triggers server-side sort
  const handleSort = (key: string) => {
    const newOrder = sortBy === key && sortOrder === 'asc' ? 'desc' : 'asc';
    onSortChange(key, newOrder);
  };

  // Handle CSV export - exports current page data
  const handleExport = () => {
    const exportData = filteredData.map((item) => ({
      Pathway: item.name,
      Term: item.term,
      NES: item.nes,
      'P-value': item.pval,
      'Adj P-value (FDR)': item.fdr,
      'Gene Count': item.matched_genes,
      'Leading Edge Genes': item.lead_genes.join('; '),
    }));
    exportToCSV(exportData, 'gsea_results.csv');
  };

  return (
    <div data-testid="gsea-table" className="bg-white rounded-lg border border-gray-200">
      {/* Header with controls */}
      <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-gray-900">Enriched Pathways</h3>
          <span data-testid="total-pathways" className="text-sm text-gray-500">
            {totalResults} pathways
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Search input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search pathways..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={significantOnly}
              onChange={(e) => onSignificantOnlyChange(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Significant only
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={localFilterNES}
              onChange={(e) => setLocalFilterNES(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            |NES| ≥ 1
          </label>

          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                data-testid="table-header-name"
                onClick={() => handleSort('name')}
                className="px-4 py-3 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Pathway <SortIndicator columnKey="name" sortKey={sortBy} direction={sortOrder} />
              </th>
              <th
                data-testid="table-header-nes"
                onClick={() => handleSort('nes')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                NES <SortIndicator columnKey="nes" sortKey={sortBy} direction={sortOrder} />
              </th>
              <th
                data-testid="table-header-pvalue"
                onClick={() => handleSort('pval')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                P-value <SortIndicator columnKey="pval" sortKey={sortBy} direction={sortOrder} />
              </th>
              <th
                data-testid="table-header-fdr"
                onClick={() => handleSort('fdr')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                FDR <SortIndicator columnKey="fdr" sortKey={sortBy} direction={sortOrder} />
              </th>
              <th
                data-testid="table-header-genes"
                onClick={() => handleSort('matched_genes')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Gene Count <SortIndicator columnKey="matched_genes" sortKey={sortBy} direction={sortOrder} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredData.map((item) => (
              <tr
                key={item.term}
                data-testid="gsea-table-row"
                onClick={() => onSelectPathway(item)}
                className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                  selectedPathway?.term === item.term ? 'bg-blue-50' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-xs text-gray-500">{item.term}</div>
                </td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    item.nes > 0 ? 'text-pink-600' : 'text-blue-600'
                  }`}
                >
                  {item.nes.toFixed(3)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatPValue(item.pval)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {formatPValue(item.fdr)}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {item.pathway_gene_set_size
                    ? `${item.matched_genes}/${item.pathway_gene_set_size}`
                    : item.matched_genes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, totalResults)} of{' '}
            {totalResults} pathways
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
