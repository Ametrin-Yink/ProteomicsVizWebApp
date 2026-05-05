/**
 * File Upload Component
 * 
 * Drag and drop file upload with progress tracking.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Upload, File, X, Check, AlertCircle } from 'lucide-react';
import { Button } from './Button';

// File upload state
export type FileUploadState = 'idle' | 'uploading' | 'success' | 'error';

// Uploaded file info
export interface UploadedFileInfo {
  id: string;
  file: File;
  state: FileUploadState;
  progress: number;
  error?: string;
}

// File upload props
export interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // in bytes
  maxFiles?: number;
  disabled?: boolean;
  onFilesSelected?: (files: File[]) => void;
  onFileRemove?: (fileId: string) => void;
  uploadedFiles?: UploadedFileInfo[];
  className?: string;
}

/**
 * File Upload component with drag and drop
 */
export const FileUpload: React.FC<FileUploadProps> = ({
  accept = '.csv,.tsv,.txt',
  multiple = true,
  maxSize = 500 * 1024 * 1024, // 500MB default
  maxFiles = 50,
  disabled = false,
  onFilesSelected,
  onFileRemove,
  uploadedFiles = [],
  className,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    handleFiles(files);
    
    // Reset input
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleFiles = (files: File[]) => {
    // Filter by accept
    const acceptedFiles = files.filter((file) => {
      if (!accept) return true;
      const acceptedTypes = accept.split(',').map((t) => t.trim());
      return acceptedTypes.some((type) => {
        if (type.startsWith('.')) {
          return file.name.toLowerCase().endsWith(type.toLowerCase());
        }
        return file.type.match(type);
      });
    });

    // Check file size
    const validFiles = acceptedFiles.filter((file) => {
      if (file.size > maxSize) {
        console.warn(`File ${file.name} exceeds max size`);
        return false;
      }
      return true;
    });

    // Check max files
    const totalFiles = uploadedFiles.length + validFiles.length;
    if (totalFiles > maxFiles) {
      console.warn(`Maximum ${maxFiles} files allowed`);
      validFiles.splice(maxFiles - uploadedFiles.length);
    }

    if (validFiles.length > 0) {
      onFilesSelected?.(validFiles);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const dropzoneClasses = cn(
    'relative flex flex-col items-center justify-center',
    'w-full min-h-[200px] p-8 rounded-xl border-2 border-dashed',
    'transition-all duration-200 cursor-pointer',
    'bg-surface',
    
    isDragging && !disabled && [
      'border-primary bg-primary/5',
      'scale-[1.02]',
    ],
    
    !isDragging && !disabled && [
      'border-border hover:border-primary/50',
      'hover:bg-primary/5',
    ],
    
    disabled && [
      'opacity-50 cursor-not-allowed',
      'border-border',
    ],
    
    className
  );

  return (
    <div className="w-full space-y-4">
      {/* Dropzone */}
      <div
        className={dropzoneClasses}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          className="hidden"
          disabled={disabled}
        />
        
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center',
              'bg-background shadow-sm',
              isDragging && 'bg-primary/10'
            )}
          >
            <Upload
              className={cn(
                'w-8 h-8 transition-colors',
                isDragging ? 'text-primary' : 'text-text-muted'
              )}
            />
          </div>
          
          <div className="space-y-1">
            <p className="text-base font-medium text-text-primary">
              {isDragging ? 'Drop files here' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-text-secondary">
              or click to browse
            </p>
          </div>
          
          <div className="text-xs text-text-muted">
            <p>Accepted: {accept}</p>
            <p>Max size: {formatFileSize(maxSize)} per file</p>
            <p>Max files: {maxFiles}</p>
          </div>
        </div>
      </div>

      {/* File list */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">
            Files ({uploadedFiles.length})
          </p>
          
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {uploadedFiles.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border',
                  'bg-background transition-all',
                  uploadedFile.state === 'error' && 'border-error/20 bg-error/5',
                  uploadedFile.state === 'success' && 'border-success/20 bg-success/5',
                  uploadedFile.state === 'uploading' && 'border-border',
                  uploadedFile.state === 'idle' && 'border-border'
                )}
              >
                {/* File icon */}
                <div className="flex-shrink-0">
                  <File className="w-5 h-5 text-text-muted" />
                </div>
                
                {/* File info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {uploadedFile.file.name}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {formatFileSize(uploadedFile.file.size)}
                  </p>
                  
                  {/* Progress bar */}
                  {uploadedFile.state === 'uploading' && (
                    <div className="mt-2">
                      <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${uploadedFile.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-text-secondary mt-1">
                        {uploadedFile.progress}%
                      </p>
                    </div>
                  )}
                  
                  {/* Error message */}
                  {uploadedFile.state === 'error' && uploadedFile.error && (
                    <p className="text-xs text-error mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {uploadedFile.error}
                    </p>
                  )}
                </div>
                
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {uploadedFile.state === 'success' && (
                    <Check className="w-5 h-5 text-success" />
                  )}
                  {uploadedFile.state === 'error' && (
                    <AlertCircle className="w-5 h-5 text-error" />
                  )}
                </div>
                
                {/* Remove button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onFileRemove?.(uploadedFile.id)}
                  disabled={uploadedFile.state === 'uploading'}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Convenience exports
export default FileUpload;
