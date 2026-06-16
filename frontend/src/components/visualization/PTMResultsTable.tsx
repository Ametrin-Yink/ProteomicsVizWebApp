'use client';

import React, { useState } from 'react';

interface PTMResultsTableProps {
  sessionId: string;
}

export default function PTMResultsTable({ sessionId }: PTMResultsTableProps) {
  const [isLoading] = useState(true);

  const columns = [
    { key: 'site', label: 'Site' },
    { key: 'globalProtein', label: 'Global Protein' },
    { key: 'ptmLog2FC', label: 'log2FC (PTM)' },
    { key: 'proteinLog2FC', label: 'log2FC (Protein)' },
    { key: 'adjustedLog2FC', label: 'log2FC (Adjusted)' },
    { key: 'adjustedPvalue', label: 'p-value (Adjusted)' },
    { key: 'isAdjusted', label: 'Adjusted' },
  ];

  return (
    <div
      data-testid="ptm-results-table"
      className="bg-background rounded-lg border border-border"
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold text-text-primary">PTM Results</h3>
        <p className="text-sm text-text-muted mt-1">
          Session: {sessionId.slice(0, 8)}...
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left font-medium text-text-secondary"
                  data-testid={`table-header-${col.key}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-4 bg-surface rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Loading placeholder row */}
      {isLoading && (
        <div className="p-6 text-center" data-testid="loading-placeholder">
          <div className="flex items-center justify-center gap-2 text-text-muted">
            <svg
              className="animate-spin h-5 w-5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              data-testid="loading-spinner"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span>PTM results loading...</span>
          </div>
        </div>
      )}
    </div>
  );
}
