'use client';

import React, { useState, useCallback, useRef } from 'react';
import { FileText, FileSpreadsheet, Folder, ChevronRight } from 'lucide-react';
import { FileLibraryEntry } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FileListProps {
  entries: FileLibraryEntry[];
  currentPath: string;
  selectedPaths: Set<string>;
  onToggleSelect: (path: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
  sortBy: 'name' | 'size' | 'modified' | null;
  sortOrder: 'asc' | 'desc';
  onSort: (column: 'name' | 'size' | 'modified') => void;
  filterType: 'all' | 'txt' | 'csv';
  searchQuery?: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getIcon(type: string) {
  switch (type) {
    case 'folder':
      return <Folder className="w-5 h-5 text-[var(--color-secondary)] flex-shrink-0" />;
    case 'csv':
      return <FileSpreadsheet className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />;
    default:
      return <FileText className="w-5 h-5 text-[var(--color-info)] flex-shrink-0" />;
  }
}

export const FileList: React.FC<FileListProps> = ({
  entries,
  currentPath,
  selectedPaths,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onNavigate,
  onContextMenu,
  sortBy,
  sortOrder,
  onSort,
  filterType,
  searchQuery,
}) => {
  // Filter by type, then check allSelected against filtered entries
  const displayed = entries
    .filter(e => {
      if (filterType === 'all' || e.type === 'folder') return true;
      return e.type === filterType;
    });

  const displayedFiles = displayed.filter(e => e.type !== 'folder');
  const allSelected = displayedFiles.length > 0 && displayedFiles.every(e => selectedPaths.has(e.path));
  const someSelected = displayedFiles.some(e => selectedPaths.has(e.path));

  const sortIndicator = (col: string): string => {
    if (sortBy !== col) return '';
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  // Breadcrumb segments
  const segments = currentPath ? currentPath.split('/') : [];

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent,
    entry: FileLibraryEntry,
    index: number
  ) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = Math.min(index + 1, displayed.length - 1);
        setFocusedIndex(nextIndex);
        rowRefs.current[nextIndex]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = Math.max(index - 1, 0);
        setFocusedIndex(prevIndex);
        rowRefs.current[prevIndex]?.focus();
        break;
      }
      case 'Enter':
        e.preventDefault();
        if (entry.type === 'folder') {
          onNavigate(entry.path);
        } else {
          onToggleSelect(entry.path);
        }
        break;
      case ' ':
        e.preventDefault();
        onToggleSelect(entry.path);
        break;
    }
  }, [displayed, onNavigate, onToggleSelect]);

  return (
    <div className="flex flex-col h-full" data-testid="file-list">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-4 py-2 text-sm text-text-muted border-b border-border">
        <button
          onClick={() => onNavigate('')}
          className="hover:text-text hover:underline"
        >
          Files
        </button>
        {segments.map((seg, i) => {
          const segPath = segments.slice(0, i + 1).join('/');
          return (
            <React.Fragment key={segPath}>
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
              <button
                onClick={() => onNavigate(segPath)}
                className="hover:text-text hover:underline truncate max-w-[200px]"
                aria-current={i === segments.length - 1 ? 'page' : undefined}
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <button
          onClick={onSelectAll}
          className="text-primary hover:underline"
        >
          Select All
        </button>
        <span className="text-text-muted">·</span>
        <button
          onClick={onClearSelection}
          className="text-primary hover:underline"
        >
          Clear Selection
        </button>
        {searchQuery && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">{displayed.length} result{displayed.length !== 1 ? 's' : ''} for &lsquo;{searchQuery}&rsquo;</span>
          </>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface text-left">
            <tr className="border-b border-border">
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={() => allSelected ? onClearSelection() : onSelectAll()}
                  className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
              </th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase cursor-pointer select-none hover:text-text" onClick={() => onSort('name')} aria-sort={sortBy === 'name' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                Name{sortIndicator('name')}
              </th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-24 cursor-pointer select-none hover:text-text" onClick={() => onSort('size')} aria-sort={sortBy === 'size' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                Size{sortIndicator('size')}
              </th>
              <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-44 cursor-pointer select-none hover:text-text" onClick={() => onSort('modified')} aria-sort={sortBy === 'modified' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                Modified{sortIndicator('modified')}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((entry, index) => {
              const isSelected = selectedPaths.has(entry.path);
              return (
                <tr
                  key={entry.path}
                  ref={(el) => { rowRefs.current[index] = el; }}
                  tabIndex={focusedIndex === index ? 0 : -1}
                  role="row"
                  aria-selected={isSelected}
                  className={cn(
                    'border-b border-border/50 hover:bg-surface/50 transition-colors cursor-pointer',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={() => {
                    if (entry.type === 'folder') {
                      onNavigate(entry.path);
                    } else {
                      onToggleSelect(entry.path);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, entry, index)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, entry.path, entry.name);
                  }}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(entry.path)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      {getIcon(entry.type)}
                      <span className="text-sm text-text truncate max-w-[400px]" title={entry.name}>
                        {entry.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-sm text-text-muted">
                    {formatSize(entry.size)}
                  </td>
                  <td className="px-2 py-2 text-sm text-text-muted">
                    {formatDate(entry.modified_at)}
                  </td>
                </tr>
              );
            })}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-text-muted">
                  {filterType !== 'all'
                  ? `No ${filterType.toUpperCase()} files in this folder.`
                  : 'This folder is empty.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FileList;
