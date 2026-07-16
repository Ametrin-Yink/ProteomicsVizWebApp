'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { FolderOpen, Loader2, Menu, X, Upload } from 'lucide-react';
import { useFileSearch } from '@/hooks/use-file-search';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';
import { FileLibraryToolbar } from './FileLibraryToolbar';
import { FolderTree } from './FolderTree';
import { FileList } from './FileList';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

export const FileLibraryPage: React.FC = () => {
  const { addToast } = useUIStore();

  // ---- State ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(-1);
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { searchQuery, setSearchQuery, handleSearchChange, filteredEntries } = useFileSearch({
    entries,
    fileType: 'all',
  });
  const handleToolbarSearchChange = useCallback((query: string) => {
    handleSearchChange({ target: { value: query } } as React.ChangeEvent<HTMLInputElement>);
  }, [handleSearchChange]);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; items: ContextMenuItem[];
  } | null>(null);
  const [sort, setSort] = useState<{ by: 'name' | 'size' | 'modified' | null; order: 'asc' | 'desc' }>({ by: null, order: 'asc' });
  const [filterType, setFilterType] = useState<'all' | 'txt' | 'csv'>('all');
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [, setTick] = useState(0); // F-021: force re-render every 60s for live timer

  // ---- Core Library Loading ----

  const loadLibrary = useCallback(async (path: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoading(true);
    setError(null);
    try {
      if (path === '') {
        const scanResult = await fileLibraryApi.scan();
        if (signal.aborted) return;
        setTotalFiles(scanResult.total);
        setLastScan(new Date());
      }
      const data = await fileLibraryApi.listDirectory(path, signal);
      if (signal.aborted) return;
      setEntries(data.entries);
      let size = 0;
      for (const e of data.entries) {
        size += e.size;
      }
      setTotalSize(size);
    } catch (_err) {
      if (_err instanceof DOMException && (_err as DOMException).name === 'AbortError') return;
      const msg = _err instanceof Error ? _err.message : 'Failed to load file library';
      setError(msg);
      addToast('error', msg);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadLibrary('');
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [loadLibrary]);

  // F-021: Live timer — re-render every 60s to update "X min ago"
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await fileLibraryApi.scan();
      setLastScan(new Date());
      const data = await fileLibraryApi.listDirectory(currentPath);
      setEntries(data.entries);
    } catch (_err) {
      addToast('error', 'Failed to rescan library');
    } finally {
      setLoading(false);
    }
  }, [currentPath, addToast]);

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedPaths(new Set());
    // Clear search when navigating
    setSearchQuery('');
    loadLibrary(path);
  }, [loadLibrary, setSearchQuery]);

  // ---- Handlers ----

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name:');
    if (!name || !name.trim()) return;
    try {
      await fileLibraryApi.createFolder(currentPath, name.trim());
      addToast('success', `Folder '${name.trim()}' created`);
      setTreeRefreshKey(k => k + 1);
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [currentPath, addToast, loadLibrary]);

  const handleUpload = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await fileLibraryApi.upload(files, currentPath, (pct) => {
        setUploadProgress(pct);
      });
      addToast('success', `Uploaded ${result.files.length} file(s)`);
      setTreeRefreshKey(k => k + 1);
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(-1);
    }
  }, [currentPath, addToast, loadLibrary]);

  // F-029: Drag-and-drop upload
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only close overlay if leaving the entire drop zone
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  const handleDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const count = selectedPaths.size;
    const isFolder = Array.from(selectedPaths).some(p => {
      const e = entries.find(en => en.path === p);
      return e?.type === 'folder';
    });
    const msg = isFolder
      ? `Delete ${count} item(s) including folders and all contents?`
      : `Delete ${count} file(s)?`;
    if (!window.confirm(msg)) return;
    try {
      await Promise.all(Array.from(selectedPaths).map(path => fileLibraryApi.delete(path)));
      addToast('success', `Deleted ${count} item(s)`);
      setSelectedPaths(new Set());
      setTreeRefreshKey(k => k + 1);
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [selectedPaths, entries, currentPath, addToast, loadLibrary]);

  const handleRename = useCallback(async () => {
    if (selectedPaths.size !== 1) return;
    const path = Array.from(selectedPaths)[0];
    const entry = entries.find(e => e.path === path);
    if (!entry) return;
    const newName = window.prompt('New name:', entry.name);
    if (!newName || !newName.trim() || newName.trim() === entry.name) return;
    try {
      await fileLibraryApi.rename(path, newName.trim());
      addToast('success', `Renamed to '${newName.trim()}'`);
      setSelectedPaths(new Set());
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [selectedPaths, entries, currentPath, addToast, loadLibrary]);


  const handleToggleSelect = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const next = new Set<string>();
    for (const e of filteredEntries) {
      if (e.type !== 'folder') next.add(e.path);
    }
    setSelectedPaths(next);
  }, [filteredEntries]);

  // ---- Context menu handlers ----

  const handleFileContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Rename', action: () => { setSelectedPaths(new Set([path])); } },
        { label: 'Delete', action: async () => {
          if (!window.confirm(`Delete '${name}'?`)) return;
          await fileLibraryApi.delete(path);
          addToast('success', `Deleted '${name}'`);
          loadLibrary(currentPath);
        }, danger: true },
        { label: 'Copy Path', action: () => { navigator.clipboard.writeText(path); addToast('info', 'Path copied'); } },
      ],
    });
  }, [currentPath, addToast, loadLibrary]);

  const handleFolderContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Rename', action: () => { setSelectedPaths(new Set([path])); } },
        { label: 'Delete', action: async () => {
          if (!window.confirm(`Delete folder '${name}' and all contents?`)) return;
          await fileLibraryApi.delete(path);
          addToast('success', `Deleted folder '${name}'`);
          loadLibrary(currentPath);
        }, danger: true },
      ],
    });
  }, [currentPath, addToast, loadLibrary]);

  // ---- Sorting ----

  const handleSort = useCallback((column: 'name' | 'size' | 'modified') => {
    setSort(prev => ({
      by: column,
      order: prev.by === column ? (prev.order === 'asc' ? 'desc' : 'asc') : 'asc',
    }));
  }, []);

  const sortedEntries = useMemo(() => {
    if (!sort.by) return filteredEntries;
    return [...filteredEntries].sort((a, b) => {
      let cmp = 0;
      if (sort.by === 'name') cmp = a.name.localeCompare(b.name);
      else if (sort.by === 'size') cmp = a.size - b.size;
      // F-017: Use Date comparison instead of localeCompare
      else if (sort.by === 'modified') {
        const da = a.modified_at ? new Date(a.modified_at).getTime() : 0;
        const db = b.modified_at ? new Date(b.modified_at).getTime() : 0;
        cmp = da - db;
      }
      return sort.order === 'asc' ? cmp : -cmp;
    });
  }, [filteredEntries, sort.by, sort.order]);

  // ---- Full-page loading (initial load only) ----
  if (loading && entries.length === 0 && !error) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-loading">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <span className="text-sm text-text-muted">Indexing file library...</span>
        </div>
      </div>
    );
  }

  // ---- Full-page error (no cached entries) ----
  if (error && entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-error">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FolderOpen className="w-12 h-12 text-text-muted" />
          <p className="text-text-muted">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ---- Empty state ----
  if (!loading && entries.length === 0 && currentPath === '') {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="files-empty">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FolderOpen className="w-16 h-16 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">Your file library is empty</h2>
          <p className="text-sm text-text-muted">
            Drop .txt or .csv files here, or click Upload to get started.
            You can also copy files directly to the file library folder on disk and click Refresh.
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // ---- Normal state ----
  return (
    <div className="flex-1 flex flex-col h-full" data-testid="files-page">
      {/* Loading bar for folder navigation (when entries already exist) */}
      {loading && entries.length > 0 && (
        <div className="h-1 bg-primary/20 overflow-hidden">
          <div className="h-full bg-primary animate-pulse w-2/3 rounded" />
        </div>
      )}
      {/* Error banner for navigation failures (when entries already exist) */}
      {error && entries.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-error/10 border-b border-error/20 text-sm text-error">
          <span className="flex-1">{error}</span>
          <button onClick={handleRefresh} className="px-2 py-0.5 text-xs bg-error/20 rounded hover:bg-error/30">Retry</button>
        </div>
      )}
      <FileLibraryToolbar
        onCreateFolder={handleCreateFolder}
        onUpload={handleUpload}
        onDelete={handleDelete}
        onRename={handleRename}
        searchQuery={searchQuery}
        onSearchChange={handleToolbarSearchChange}
        onRefresh={handleRefresh}
        selectedCount={selectedPaths.size}
        uploading={uploading}
        uploadProgress={uploadProgress}
      />

      {/* File type filter bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-surface/50 text-xs">
        <span className="text-text-muted">Show:</span>
        {(['all', 'txt', 'csv'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={cn(
              'px-2.5 py-0.5 rounded-full border transition-colors',
              filterType === t
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border text-text-muted hover:border-text-muted',
            )}
          >
            {t === 'all' ? 'All Files' : t.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Mobile sidebar toggle button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed bottom-4 left-4 z-40 p-3 bg-primary text-white rounded-full shadow-lg hover:bg-primary/90 transition-colors"
          aria-label="Open folder tree"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Sidebar - responsive: always visible on md+, overlay on small screens */}
        <div
          className={cn(
            'w-72 border-r border-border bg-surface/50 overflow-y-auto flex-shrink-0',
            // Below md: overlay
            'fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:relative md:inset-auto md:z-auto md:transition-none',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          )}
        >
          {/* Overlay close button (mobile only) */}
          <div className="md:hidden flex items-center justify-end p-2 border-b border-border">
            <span className="text-sm font-medium text-text flex-1 pl-2">Folders</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-2 text-text-muted hover:text-text hover:bg-border/20 rounded-lg transition-colors"
              aria-label="Close folder tree"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <FolderTree
            currentPath={currentPath}
            onNavigate={(path) => {
              handleNavigate(path);
              setSidebarOpen(false);
            }}
            onContextMenu={handleFolderContextMenu}
            refreshKey={treeRefreshKey}
          />
        </div>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* File list area with drag-and-drop */}
        <div
          className="flex-1 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileList
            entries={sortedEntries}
            currentPath={currentPath}
            selectedPaths={selectedPaths}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelection={() => setSelectedPaths(new Set())}
            onNavigate={handleNavigate}
            onContextMenu={handleFileContextMenu}
            sortBy={sort.by}
            sortOrder={sort.order}
            onSort={handleSort}
            filterType={filterType}
            searchQuery={searchQuery}
          />

          {/* F-029: Drag-and-drop overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/40 rounded-lg m-2">
              <div className="flex flex-col items-center gap-3 p-8 bg-background/90 rounded-xl shadow-lg">
                <Upload className="w-12 h-12 text-primary" />
                <p className="text-lg font-semibold text-text-primary">Drop files to upload</p>
                <p className="text-sm text-text-muted">.txt and .csv files supported</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border bg-surface text-xs text-text-muted">
        <span>{totalFiles.toLocaleString()} files</span>
        <span>·</span>
        <span>{(totalSize / (1024 * 1024)).toFixed(1)} MB</span>
        {lastScan && (
          <>
            <span>·</span>
            <span>Last scan: {Math.round((Date.now() - lastScan.getTime()) / 60000)} min ago</span>
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default FileLibraryPage;
