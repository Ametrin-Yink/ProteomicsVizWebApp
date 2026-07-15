'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Loader2, Search, FolderOpen } from 'lucide-react';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { FolderTree } from '@/components/files/FolderTree';
import { useFileSearch } from '@/hooks/use-file-search';

interface FileLibraryPickerProps {
  sessionId: string;
  /** 'tmt' | 'dia' | 'csv-only' — filters displayed files */
  fileType: 'tmt' | 'dia' | 'csv-only';
  onSelect: (selectedPaths: string[]) => void;
  onClose: () => void;
}

export const FileLibraryPicker: React.FC<FileLibraryPickerProps> = ({
  sessionId,
  fileType,
  onSelect,
  onClose,
}) => {
  const { addToast } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<'all' | 'txt' | 'csv'>('all');

  const { searchQuery, setSearchQuery, handleSearchChange, filteredEntries, isSearching } = useFileSearch({
    entries,
    fileType: pickerFilter === 'all' ? 'all' : pickerFilter,
  });

  // Load directory on mount and on path change
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await fileLibraryApi.listDirectory(path);
      setEntries(data.entries.filter(e => {
        if (fileType === 'csv-only') return e.type === 'csv' || e.type === 'folder';
        return e.type === 'txt' || e.type === 'csv' || e.type === 'folder';
      }));
    } catch {
      addToast('error', 'Failed to load file library');
    } finally {
      setLoading(false);
    }
  }, [fileType, addToast]);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // Apply picker-level file type filter on top of search results or directory entries
  const displayedEntries = useMemo(() => {
    return filteredEntries.filter(e => {
      if (pickerFilter === 'all' || e.type === 'folder') return true;
      return e.type === pickerFilter;
    });
  }, [filteredEntries, pickerFilter]);

  const handleToggleSelect = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const handleSelectAll = () => {
    const next = new Set(selectedPaths);
    for (const e of displayedEntries) {
      if (e.type !== 'folder') next.add(e.path);
    }
    setSelectedPaths(next);
  };

  const handleClearSelection = () => {
    setSelectedPaths(new Set());
  };

  const totalSize = useMemo(() => {
    let size = 0;
    for (const p of selectedPaths) {
      const e = entries.find(en => en.path === p);
      if (e) size += e.size;
    }
    return size;
  }, [selectedPaths, entries]);

  const handleConfirm = async () => {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;

    setCopying(true);
    try {
      if (fileType === 'csv-only') {
        // Metadata mode: just pass paths back, parent fetches content
        onSelect(paths);
      } else {
        // Pipeline mode: copy to session + parse
        await fileLibraryApi.selectForSession(sessionId, paths);
        onSelect(paths);
      }
    } catch (err) {
      addToast('error', `Failed to select files: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCopying(false);
    }
  };

  const isEmpty = !loading && displayedEntries.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="file-picker"
      onKeyDown={(e) => { if (e.key === 'Escape' && !copying) onClose(); }}
    >
      <div className="bg-background rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-text-primary">Select Files for Analysis</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text rounded transition-colors"
            disabled={copying}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter bar: file type dropdown + search */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface/50">
          {/* File type filter dropdown */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-text-muted">Show:</span>
            {(['all', 'txt', 'csv'] as const).map(t => (
              <button
                key={t}
                onClick={() => setPickerFilter(t)}
                disabled={fileType === 'csv-only' && t !== 'csv' && t !== 'all'}
                className={cn(
                  'px-2 py-0.5 rounded-full border transition-colors',
                  pickerFilter === t
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border text-text-muted hover:border-text-muted',
                  fileType === 'csv-only' && t === 'txt' && 'opacity-30 cursor-not-allowed',
                )}
              >
                {t === 'all' ? 'All Files' : t.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Spacer */}
          <div className="flex-1" />
          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search files..."
              className="pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary w-full"
            />
          </div>
        </div>

        {/* Body: folder tree + file list */}
        <div className="flex-1 flex overflow-hidden">
          {/* Folder tree — reuses component from Task 6 */}
          <div className="w-56 border-r border-border overflow-y-auto bg-surface/30">
            {searchQuery ? (
              <p className="text-xs text-text-muted p-2">Search active — showing all matching files</p>
            ) : (
              <FolderTree
                currentPath={currentPath}
                onNavigate={setCurrentPath}
                onContextMenu={() => {}} // no context menu in picker
              />
            )}
          </div>

          {/* File list (checkboxes for selection) */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <FolderOpen className="w-10 h-10 text-text-muted" />
                <p className="text-sm text-text-muted">
                  {searchQuery
                    ? `No files matching '${searchQuery}'`
                    : fileType === 'csv-only'
                      ? 'No CSV files found in the library.'
                      : 'Your file library is empty. Upload .txt or .csv files from the Files page first.'}
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-surface text-left">
                  <tr className="border-b border-border">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={displayedEntries.filter(e => e.type !== 'folder').length > 0
                          && displayedEntries.filter(e => e.type !== 'folder').every(e => selectedPaths.has(e.path))}
                        onChange={() => {
                          const files = displayedEntries.filter(e => e.type !== 'folder');
                          if (files.every(e => selectedPaths.has(e.path))) {
                            handleClearSelection();
                          } else {
                            handleSelectAll();
                          }
                        }}
                        className="w-4 h-4 rounded"
                      />
                    </th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase">Name</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted uppercase w-24">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedEntries.filter(e => e.type !== 'folder').map(entry => (
                    <tr
                      key={entry.path}
                      className={cn(
                        'border-b border-border/50 hover:bg-surface/50 cursor-pointer',
                        selectedPaths.has(entry.path) && 'bg-primary/5',
                      )}
                      onClick={() => handleToggleSelect(entry.path)}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(entry.path)}
                          onChange={() => handleToggleSelect(entry.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="px-2 py-2 text-sm text-text">{entry.name}</td>
                      <td className="px-2 py-2 text-sm text-text-muted">
                        {entry.size < 1024 ? `${entry.size} B` : `${(entry.size / (1024 * 1024)).toFixed(1)} MB`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-surface/50">
          <div className="flex items-center gap-2">
            <button onClick={handleSelectAll} className="text-xs text-primary hover:underline">Select All</button>
            <span className="text-text-muted text-xs">·</span>
            <button onClick={handleClearSelection} className="text-xs text-primary hover:underline">Clear Selection</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-muted">
              Selected: {selectedPaths.size} files · {(totalSize / (1024 * 1024)).toFixed(1)} MB
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md"
              disabled={copying}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedPaths.size === 0 || copying}
              className="px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {copying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Copying {selectedPaths.size} file{selectedPaths.size !== 1 ? 's' : ''}...
                </>
              ) : (
                `Select (${selectedPaths.size})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileLibraryPicker;
