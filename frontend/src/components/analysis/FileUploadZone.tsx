/**
 * FileUploadZone Component
 * Drag-and-drop file upload with progress tracking
 */

'use client';

import React, { useCallback, useState, useRef } from 'react';
import { Upload, File, X, ChevronDown } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { uploadApi } from '@/lib/api-client';
import type { UploadedFileInfo, UploadProgress, FileDetectionResult } from '@/types';

/**
 * Collapsible uploaded files list — folded by default, scrollable when expanded.
 */
const CollapsibleFileList: React.FC<{
  uploadedFiles: UploadedFileInfo[];
  uploadProgress: UploadProgress[];
  removeUploadedFile: (filename: string) => void;
}> = ({ uploadedFiles, uploadProgress, removeUploadedFile }) => {
  const [expanded, setExpanded] = React.useState(false);

  const getProgressForFile = (filename: string) =>
    uploadProgress.find((p) => p.filename === filename);

  return (
    <div className="mt-4" data-testid="uploaded-files-list">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-text hover:text-primary transition-colors w-full text-left"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
        />
        Uploaded Files ({uploadedFiles.length})
      </button>
      {expanded && (
        <div className="mt-2 max-h-48 overflow-y-auto space-y-1.5 pr-1">
          {uploadedFiles.map((file) => {
            const progress = getProgressForFile(file.filename);
            const isCompleted = progress?.status === 'completed';
            const hasError = progress?.status === 'error';

            return (
              <div
                key={file.filename}
                className={`flex items-center justify-between p-2 rounded-md border text-sm ${
                  hasError ? 'bg-error/5 border-error/20' : 'bg-background border-border'
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <File
                    className={`w-4 h-4 flex-shrink-0 ${
                      hasError ? 'text-error' : isCompleted ? 'text-success' : 'text-text-muted'
                    }`}
                  />
                  <span className="text-text truncate flex-1" title={file.filename}>
                    {file.filename}
                  </span>
                  {file.file_type && (
                    <span className="text-xs font-medium text-text-muted uppercase flex-shrink-0">
                      {file.file_type}
                      {file.tmt_channels && ` (${file.tmt_channels.length}ch)`}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeUploadedFile(file.filename)}
                  className="p-1 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors flex-shrink-0 ml-2"
                  title="Remove file"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface FileUploadZoneProps {
  sessionId: string;
  onDetectedFileType?: (result: FileDetectionResult) => void;
}

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_EXTENSIONS = ['.csv', '.txt'];

/**
 * Format file size for display
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({ sessionId, onDetectedFileType }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    uploadedFiles,
    uploadProgress,
    addUploadedFile,
    removeUploadedFile,
    setUploadProgress,
    setIsUploading,
    setUploadError,
  } = useAnalysisStore();

  const { addToast } = useUIStore();

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`;
    }

    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `Invalid file type. Only ${ALLOWED_EXTENSIONS.join(', ')} files are allowed`;
    }

    return null;
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    // Check if sessionId is available
    if (!sessionId) {
      console.error('No sessionId available');
      addToast('error', 'No session available. Please create a session first.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    // Validate files - collect valid ones and errors separately
    const fileArray = Array.from(files);
    const validFilesAfterValidation: File[] = [];
    const validationErrors: { name: string; error: string }[] = [];

    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        validationErrors.push({ name: file.name, error });
      } else {
        validFilesAfterValidation.push(file);
      }
    }

    // Show validation errors (but don't block valid files)
    if (validationErrors.length > 0) {
      validationErrors.forEach(({ name, error }) => {
        addToast('error', `${name}: ${error}`);
      });
    }

    // If no valid files, stop here
    if (validFilesAfterValidation.length === 0) {
      setIsUploading(false);
      return;
    }

    try {
      // Upload files (no filename validation — backend handles format detection)
      for (const file of validFilesAfterValidation) {
        setUploadProgress(file.name, 0, 'uploading');
      }

      try {
        const results = await uploadApi.uploadProteomics(sessionId, validFilesAfterValidation, (name, progress) => {
          setUploadProgress(name, progress, progress === 100 ? 'completed' : 'uploading');
        });

        // Process all uploaded files
        for (const uploadedFile of results) {
          try {
            addUploadedFile(uploadedFile);

            // Notify parent of detection result
            if (onDetectedFileType && uploadedFile.file_type) {
              onDetectedFileType({
                file_type: uploadedFile.file_type,
                columns: uploadedFile.columns || [],
                tmt_channels: uploadedFile.tmt_channels,
                warnings: [],
              });
            }
          } catch (error) {
            console.error('Error adding file to store:', error);
          }
        }

        if (results.length > 0) {
          addToast('success', `Uploaded ${results.length} file(s) successfully`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        for (const file of validFilesAfterValidation) {
          setUploadProgress(file.name, 0, 'error');
        }
        addToast('error', `Failed to upload files: ${message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadError(message);
      addToast('error', `Upload failed: ${message}`);
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, addUploadedFile, setUploadProgress, setIsUploading, setUploadError, addToast, onDetectedFileType]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Separate handler for proteomics drop zone
  const handleProteomicsDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    handleFiles(files);
    e.target.value = ''; // Reset input
  }, [handleFiles]);

  return (
    <div className="space-y-6">
      {/* Proteomics File Upload */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-text">Proteomics Data Files</h3>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload proteomics data files"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleProteomicsDrop}
          onClick={() => {
            fileInputRef.current?.click();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`
            relative border-2 border-dashed rounded-xl p-8 cursor-pointer
            transition-all duration-200 ease-in-out
            ${isDragging
              ? 'border-primary bg-primary/5'
              : 'border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt"
            multiple
            data-testid="proteomics-upload"
            onChange={(e) => handleFileInputChange(e)}
            className="hidden"
          />

          <div className="flex flex-col items-center text-center space-y-4">
            <div className={`
              p-4 rounded-full transition-colors duration-200
              ${isDragging ? 'bg-primary/10' : 'bg-primary/10'}
            `}>
              <Upload className={`
                w-8 h-8 transition-colors duration-200
                ${isDragging ? 'text-primary' : 'text-primary/70'}
              `} />
            </div>

            <div>
              <p className="text-base font-medium text-text">
                {isDragging ? 'Drop files here' : 'Drag & drop files here'}
              </p>
              <p className="text-sm text-text-muted mt-1">
                or click to browse
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Supported: CSV, TXT files</span>
              <span>•</span>
              <span>Max {formatFileSize(MAX_FILE_SIZE)}</span>
            </div>
          </div>
        </div>

        {/* Uploaded Files List — collapsible, folded by default */}
        {uploadedFiles.length > 0 && (
          <CollapsibleFileList
            uploadedFiles={uploadedFiles}
            uploadProgress={uploadProgress}
            removeUploadedFile={removeUploadedFile}
          />
        )}
      </div>
    </div>
  );
};

export default FileUploadZone;
