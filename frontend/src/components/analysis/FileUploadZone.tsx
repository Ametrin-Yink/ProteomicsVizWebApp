/**
 * FileUploadZone Component
 * Drag-and-drop file upload with progress tracking
 */

'use client';

import React, { useCallback, useState, useRef } from 'react';
import { Upload, File, X, Database, AlertCircle, ChevronDown } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { uploadApi } from '@/lib/api-client';
import type { ParsedFilename, UploadProgress } from '@/types';

/**
 * Collapsible uploaded files list — folded by default, scrollable when expanded.
 */
const CollapsibleFileList: React.FC<{
  uploadedFiles: ParsedFilename[];
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
                  <span className="text-xs text-text-muted flex-shrink-0">
                    {file.experiment} / {file.conditions.join('_')} / #{file.replicate}
                  </span>
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
}

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED_EXTENSIONS = ['.csv'];

/**
 * Parse PSM filename to extract metadata
 * Pattern: PSM_ExperimentName_Cond1_Cond2_..._CondN_ReplicateNumber.csv
 *
 * Everything between PSM_ and the final _<number>.csv is split by _:
 * first segment = experiment, rest = conditions.
 */
const parseFilename = (filename: string): ParsedFilename | null => {
  const pattern = /^PSM_(.+)_(\d+)\.csv$/i;
  const match = filename.match(pattern);

  if (!match) {
    return null;
  }

  const parts = match[1].split('_');
  if (parts.length < 2) {
    return null;
  }

  return {
    filename,
    experiment: parts[0],
    conditions: parts.slice(1),
    replicate: parseInt(match[2], 10),
    size: 0,
  };
};

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

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({ sessionId }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const compoundInputRef = useRef<HTMLInputElement>(null);

  const {
    uploadedFiles,
    uploadProgress,
    compoundFile,
    addUploadedFile,
    removeUploadedFile,
    setUploadProgress,
    setCompoundFile,
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

  const handleFiles = useCallback(async (files: FileList | null, isCompound: boolean = false) => {
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
      if (isCompound) {
        // Handle compound file upload
        if (validFilesAfterValidation.length === 0) {
          setIsUploading(false);
          return;
        }
        const file = validFilesAfterValidation[0];
        setUploadProgress(file.name, 0, 'uploading');

        const result = await uploadApi.uploadCompound(sessionId, file);
        setCompoundFile(result);
        setUploadProgress(file.name, 100, 'completed');

        addToast('success', `Compound file uploaded successfully: ${result.compounds.length} compounds`);
      } else {
        // Handle proteomics files upload - validate filename pattern
        const validFiles: File[] = [];
        for (const file of validFilesAfterValidation) {
          const parsed = parseFilename(file.name);
          if (!parsed) {
            console.error('Invalid filename:', file.name);
            addToast('error', `Invalid filename: ${file.name}. Expected: PSM_ExperimentName_Condition1_Condition2_ReplicateNumber.csv`);
            continue;
          }
          validFiles.push(file);
          setUploadProgress(file.name, 0, 'uploading');
        }

        if (validFiles.length === 0) {
          setIsUploading(false);
          return;
        }

        try {
          const results = await uploadApi.uploadProteomics(sessionId, validFiles, (name, progress) => {
            setUploadProgress(name, progress, progress === 100 ? 'completed' : 'uploading');
          });

          // Process all uploaded files
          for (const uploadedFile of results) {
            try {
              // Use parseFilename regex to correctly handle condition names with underscores
              const originalName = uploadedFile.filename || '';
              const parsed = parseFilename(originalName);

              if (parsed) {
                addUploadedFile({
                  filename: uploadedFile.filename,
                  experiment: parsed.experiment,
                  conditions: parsed.conditions,
                  replicate: parsed.replicate,
                  size: uploadedFile.size,
                  columns: uploadedFile.columns || [],
                });
              } else {
                // Fallback: use backend-parsed values if regex fails
                addUploadedFile({
                  filename: uploadedFile.filename,
                  experiment: uploadedFile.experiment || 'Unknown',
                  conditions: uploadedFile.conditions || ['Unknown'],
                  replicate: uploadedFile.replicate || 1,
                  size: uploadedFile.size,
                  columns: uploadedFile.columns || [],
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
          for (const file of validFiles) {
            setUploadProgress(file.name, 0, 'error');
          }
          addToast('error', `Failed to upload files: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setUploadError(message);
      addToast('error', `Upload failed: ${message}`);
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, addUploadedFile, setUploadProgress, setCompoundFile, setIsUploading, setUploadError, addToast]);

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
    handleFiles(e.dataTransfer.files, false);
  }, [handleFiles]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>, isCompound: boolean = false) => {
    const files = e.target.files;
    handleFiles(files, isCompound);
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
            accept=".csv"
            multiple
            data-testid="proteomics-upload"
            onChange={(e) => handleFileInputChange(e, false)}
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
              <p className="text-xs text-text-muted mt-1">
                Expected: <code className="px-1 py-0.5 bg-surface rounded text-text-secondary">PSM_Experiment_Cond1_Cond2_Rep.csv</code>
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>Supported: CSV files</span>
              <span>•</span>
              <span>Max {formatFileSize(MAX_FILE_SIZE)}</span>
            </div>
          </div>
        </div>

        {/* Upload from Database Button */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              addToast('info', 'Database upload feature coming soon (TBD)');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text bg-background border border-border rounded-lg hover:bg-surface focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
          >
            <Database className="w-4 h-4" />
            Upload from Database
          </button>
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

      {/* Compound File Upload */}
      <div className="space-y-4 pt-6 border-t border-border">
        <h3 className="text-lg font-semibold text-text">Compound Information (Optional)</h3>

        <div className="flex items-start gap-3 p-4 bg-info/5 rounded-lg">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-secondary">
            <p className="font-medium">Optional: Upload compound file</p>
            <p className="mt-1">
              Upload a CSV with Corp ID and SMILES columns to display compound structures.
              Corp IDs will be matched to condition names.
            </p>
          </div>
        </div>

        {compoundFile ? (
          <div className="flex items-center justify-between p-3 bg-success/5 border border-success/20 rounded-lg" data-testid="compound-upload-success">
            <div className="flex items-center gap-3">
              <File className="w-5 h-5 text-success" />
              <div>
                <p className="text-sm font-medium text-text">{compoundFile.filename}</p>
                <p className="text-xs text-text-muted">
                  {formatFileSize(compoundFile.size)} • {compoundFile.compounds.length} compounds
                </p>
              </div>
            </div>
            <button
              onClick={() => setCompoundFile(null)}
              className="p-1.5 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => compoundInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add('border-primary', 'bg-primary/5');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('border-primary', 'bg-primary/5');
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('border-primary', 'bg-primary/5');
              handleFiles(e.dataTransfer.files, true);
            }}
            className="border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:border-border hover:bg-surface transition-all duration-200"
          >
            <input
              ref={compoundInputRef}
              type="file"
              accept=".csv"
              data-testid="compound-upload"
              onChange={(e) => handleFileInputChange(e, true)}
              className="hidden"
            />
            <div className="flex flex-col items-center text-center space-y-2">
              <Upload className="w-6 h-6 text-text-muted" />
              <p className="text-sm font-medium text-text">Drag & drop compound file here</p>
              <p className="text-xs text-text-muted">or click to browse • CSV with Corp ID and SMILES columns</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUploadZone;
