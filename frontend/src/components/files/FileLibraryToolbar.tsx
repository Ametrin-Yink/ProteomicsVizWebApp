'use client';

import React, { useRef } from 'react';
import { FolderPlus, Upload, Trash2, Pencil, Search, RefreshCw, X } from 'lucide-react';

interface FileLibraryToolbarProps {
  onCreateFolder: () => void;
  onUpload: (files: FileList) => void;
  onDelete: () => void;
  onRename: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  selectedCount: number;
  uploading: boolean;
}

export const FileLibraryToolbar: React.FC<FileLibraryToolbarProps> = ({
  onCreateFolder,
  onUpload,
  onDelete,
  onRename,
  searchQuery,
  onSearchChange,
  onRefresh,
  selectedCount,
  uploading,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface">
      {/* Actions */}
      <button
        onClick={onCreateFolder}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
        title="New Folder"
      >
        <FolderPlus className="w-4 h-4" />
        <span className="hidden lg:inline">New Folder</span>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors disabled:opacity-50"
        title="Upload Files"
      >
        {uploading ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Upload className="w-4 h-4" />
        )}
        <span className="hidden lg:inline">Upload</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <button
        onClick={onDelete}
        disabled={selectedCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-error bg-background border border-border rounded-md hover:bg-error/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={`Delete (${selectedCount} selected)`}
      >
        <Trash2 className="w-4 h-4" />
        <span className="hidden lg:inline">Delete</span>
        {selectedCount > 0 && (
          <span className="text-xs bg-error/10 text-error px-1.5 py-0.5 rounded-full">
            {selectedCount}
          </span>
        )}
      </button>

      <button
        onClick={onRename}
        disabled={selectedCount !== 1}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title="Rename"
      >
        <Pencil className="w-4 h-4" />
        <span className="hidden lg:inline">Rename</span>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="pl-8 pr-8 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary w-48 lg:w-64"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text bg-background border border-border rounded-md hover:bg-surface/80 transition-colors"
        title="Refresh (re-scan library)"
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      {/* Upload indicator — animated bar */}
      {uploading && (
        <div className="h-1 bg-primary/20 overflow-hidden">
          <div className="h-full w-2/3 bg-primary animate-pulse rounded" />
        </div>
      )}
    </div>
    </div>
  );
};

export default FileLibraryToolbar;
