'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { fileLibraryApi, FileLibraryEntry } from '@/lib/api-client';
import { useUIStore } from '@/stores/ui-store';

export const FileLibraryPage: React.FC = () => {
  const { addToast } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPath] = useState('');
  const [entries, setEntries] = useState<FileLibraryEntry[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalSize, setTotalSize] = useState(0);

  // Initial scan + load
  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Full scan on initial load
      const scanResult = await fileLibraryApi.scan();
      setTotalFiles(scanResult.total);
      setLastScan(new Date());

      // Load root directory
      const data = await fileLibraryApi.listDirectory(currentPath);
      setEntries(data.entries);

      // Calculate total size
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
  }, [currentPath, addToast]);

  useEffect(() => {
    loadLibrary();
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
      {/* Toolbar placeholder — implemented in Task 6 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
        <span className="text-sm text-text-muted">Toolbar placeholder — Task 6</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Folder tree placeholder — implemented in Task 6 */}
        <div className="w-72 border-r border-border bg-surface/50 p-4 overflow-y-auto">
          <span className="text-sm text-text-muted">Folder tree placeholder — Task 6</span>
        </div>

        {/* File list placeholder — implemented in Task 6 */}
        <div className="flex-1 p-4 overflow-y-auto">
          <span className="text-sm text-text-muted">File list placeholder — Task 6</span>
          {entries.map(e => (
            <div key={e.path} className="text-sm text-text py-1">
              {e.type === 'folder' ? '📁' : '📄'} {e.name}
            </div>
          ))}
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
    </div>
  );
};

export default FileLibraryPage;
