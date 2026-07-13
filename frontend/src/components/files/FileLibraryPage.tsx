'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileLibraryEntry[] | null>(null);
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; items: ContextMenuItem[];
  } | null>(null);
   
  const [_renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
   
  const [_moveTarget, setMoveTarget] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified' | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType] = useState<'all' | 'txt' | 'csv'>('all');

  // ---- Core Library Loading ----

  const loadLibrary = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      if (path === '') {
        const scanResult = await fileLibraryApi.scan();
        setTotalFiles(scanResult.total);
        setLastScan(new Date());
      }
      const data = await fileLibraryApi.listDirectory(path);
      setEntries(data.entries);
      let size = 0;
      for (const e of data.entries) {
        size += e.size;
      }
      setTotalSize(size);
    } catch (_err) {
      const msg = _err instanceof Error ? _err.message : 'Failed to load file library';
      setError(msg);
      addToast('error', msg);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadLibrary('');
  }, [loadLibrary]);

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
    loadLibrary(path);
  }, [loadLibrary]);

  // ---- Handlers ----

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt('Folder name:');
    if (!name || !name.trim()) return;
    try {
      await fileLibraryApi.createFolder(currentPath, name.trim());
      addToast('success', `Folder '${name.trim()}' created`);
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [currentPath, addToast, loadLibrary]);

  const handleUpload = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const result = await fileLibraryApi.upload(files, currentPath);
      addToast('success', `Uploaded ${result.files.length} file(s)`);
      loadLibrary(currentPath);
    } catch (err) {
      addToast('error', `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  }, [currentPath, addToast, loadLibrary]);

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
      for (const path of selectedPaths) {
        await fileLibraryApi.delete(path);
      }
      addToast('success', `Deleted ${count} item(s)`);
      setSelectedPaths(new Set());
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

   
  const _handleMove = useCallback(() => {
    if (selectedPaths.size === 0) return;
    const target = window.prompt('Move to folder (blank = root, or type folder path):', '');
    if (target === null) return;
    const targetParent = (target || '').trim();
    const doMove = async () => {
      try {
        let moved = 0;
        for (const path of selectedPaths) {
          await fileLibraryApi.move(path, targetParent);
          moved++;
        }
        addToast('success', `Moved ${moved} item(s)`);
        setSelectedPaths(new Set());
        loadLibrary(currentPath);
      } catch (err) {
        addToast('error', `Move failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };
    doMove();
  }, [selectedPaths, currentPath, addToast, loadLibrary]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer) clearTimeout(searchTimer);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await fileLibraryApi.search(query);
        setSearchResults(data.results);
      } catch {
        // search failed silently
      }
    }, 300);
    setSearchTimer(timer);
  }, [searchTimer]);

  const handleToggleSelect = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      for (const e of (searchResults ?? entries)) {
        if (e.type !== 'folder') next.add(e.path);
      }
      return next;
    });
  }, [searchResults, entries]);

  // ---- Context menu handlers ----

  const handleFileContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Rename', action: () => { setSelectedPaths(new Set([path])); setRenameTarget({ path, name }); } },
        { label: 'Move...', action: () => { setSelectedPaths(new Set([path])); setMoveTarget(path); } },
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
        { label: 'Rename', action: () => setRenameTarget({ path, name }) },
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
    setSortBy(prev => {
      if (prev === column) {
        setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
        return column;
      }
      setSortOrder('asc');
      return column;
    });
  }, []);

  const sortedEntries = useMemo(() => {
    const list = searchResults ?? entries;
    if (!sortBy) return list;
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      else if (sortBy === 'modified') cmp = (a.modified_at || '').localeCompare(b.modified_at || '');
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [entries, searchResults, sortBy, sortOrder]);

  // ---- Loading state ----
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

  // ---- Error state ----
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
      <FileLibraryToolbar
        onCreateFolder={handleCreateFolder}
        onUpload={handleUpload}
        onDelete={handleDelete}
        onRename={handleRename}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onRefresh={handleRefresh}
        selectedCount={selectedPaths.size}
        uploading={uploading}
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
        <div className="w-72 border-r border-border bg-surface/50 overflow-y-auto">
          <FolderTree
            currentPath={currentPath}
            onNavigate={handleNavigate}
            onContextMenu={handleFolderContextMenu}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <FileList
            entries={sortedEntries}
            currentPath={currentPath}
            selectedPaths={selectedPaths}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelection={() => setSelectedPaths(new Set())}
            onNavigate={handleNavigate}
            onContextMenu={handleFileContextMenu}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            filterType={filterType}
          />
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
