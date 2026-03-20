'use client';

import React, { useState, useMemo } from 'react';
import type { GSEAResult, SortConfig } from '@/types/api';
import { formatPValue, exportToCSV } from '@/lib/utils';
import { ChevronUp, ChevronDown, Download } from 'lucide-react';

interface PathwayTableProps {
  data: GSEAResult[];
  selectedPathway: GSEAResult | null;
  onSelectPathway: (pathway: GSEAResult) => void;
}

const ITEMS_PER_PAGE = 25;

export default function PathwayTable({
  data,
  selectedPathway,
  onSelectPathway,
}: PathwayTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'fdr',
    direction: 'asc',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [filterNES, setFilterNES] = useState(true);

  // Filter data (|NES| >= 1)
  const filteredData = useMemo(() => {
    if (filterNES) {
      return data.filter((item) => Math.abs(item.nes) >= 1);
    }
    return data;
  }, [data, filterNES]);

  // Sort data
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      const aValue = a[sortConfig.key as keyof GSEAResult];
      const bValue = b[sortConfig.key as keyof GSEAResult];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });
    return sorted;
  }, [filteredData, sortConfig]);

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
    const exportData = sortedData.map((item) => ({
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

  // Sort indicator component
  const SortIndicator = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="w-4 h-4 ml-1 inline" />
    ) : (
      <ChevronDown className="w-4 h-4 ml-1 inline" />
    );
  };

  return (
    <div data-testid="gsea-table" className="bg-white rounded-lg border border-gray-200">
      {/* Header with controls */}
      <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-gray-900">Enriched Pathways</h3>
          <span data-testid="total-pathways" className="text-sm text-gray-500">
            {filteredData.length} pathways
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filterNES}
              onChange={(e) => {
                setFilterNES(e.target.checked);
                setCurrentPage(1);
              }}
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
                Pathway <SortIndicator columnKey="name" />
              </th>
              <th
                data-testid="table-header-nes"
                onClick={() => handleSort('nes')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                NES <SortIndicator columnKey="nes" />
              </th>
              <th
                data-testid="table-header-pvalue"
                onClick={() => handleSort('pval')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                P-value <SortIndicator columnKey="pval" />
              </th>
              <th
                data-testid="table-header-fdr"
                onClick={() => handleSort('fdr')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Adj P-value <SortIndicator columnKey="fdr" />
              </th>
              <th
                data-testid="table-header-genes"
                onClick={() => handleSort('matched_genes')}
                className="px-4 py-3 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-100"
              >
                Gene Count <SortIndicator columnKey="matched_genes" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedData.map((item) => (
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
                  {item.matched_genes}
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
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, sortedData.length)} of{' '}
            {sortedData.length} pathways
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>

            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
