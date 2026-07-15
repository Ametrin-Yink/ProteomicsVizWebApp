/**
 * DiaMetadataTable Component
 * Editable table for DIA per-file metadata: experiment, condition groups, replicate, batch.
 * Pattern follows ExperimentTable's column management and CSV import/export.
 */

'use client';

import React, { useState, useMemo, useRef } from 'react';
import { Plus, Download, Upload, FileText } from 'lucide-react';
import { parseCSVLine } from '@/lib/csv';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { EditableColumnHeader } from '@/components/ui/EditableColumnHeader';

export const DiaMetadataTable: React.FC = () => {
  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const updateFileMetadata = useAnalysisStore((s) => s.updateFileMetadata);
  const importMetadataColumns = useAnalysisStore((s) => s.importMetadataColumns);
  const { addToast } = useUIStore();

  const [newColName, setNewColName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive data column names from metadata_columns (exclude core fields)
  const dataColumns = useMemo(() => {
    if (!config.metadata_columns) return [];
    const coreCols = new Set(['experiment', 'replicate', 'batch']);
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (!coreCols.has(k)) cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns]);

  // Auto-populate metadata_columns for uploaded DIA files missing entries
  React.useEffect(() => {
    if (uploadedFiles.length === 0) return;
    const current = { ...(config.metadata_columns || {}) };
    let hasChanges = false;
    uploadedFiles.forEach((f) => {
      if (!current[f.filename]) {
        current[f.filename] = {
          experiment: f.experiment,
          replicate: String(f.replicate),
          batch: f.batch,
        };
        hasChanges = true;
      }
    });
    if (hasChanges) {
      setConfig({ metadata_columns: current });
    }
  }, [uploadedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Column management ---
  const addColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    if (dataColumns.includes(name)) {
      addToast('warning', `Column "${name}" already exists`);
      return;
    }
    const current = { ...(config.metadata_columns || {}) };
    uploadedFiles.forEach((f) => {
      current[f.filename] = { ...(current[f.filename] || {}), [name]: '' };
    });
    setConfig({ metadata_columns: current });
    setNewColName('');
  };

  const renameColumn = (oldName: string, newName: string) => {
    if (!newName || newName === oldName) return;
    if (dataColumns.filter((c) => c !== oldName).includes(newName)) {
      addToast('warning', `Column "${newName}" already exists`);
      return;
    }
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      if (oldName in row) {
        row[newName] = row[oldName];
        delete row[oldName];
      }
      current[fn] = row;
    });
    setConfig({ metadata_columns: current });
  };

  const removeColumn = (colName: string) => {
    if (!window.confirm(`Delete column "${colName}" and all its data? This cannot be undone.`)) return;
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      delete row[colName];
      current[fn] = row;
    });
    setConfig({ metadata_columns: current });
  };

  const updateCell = (filename: string, col: string, value: string) => {
    const current = { ...(config.metadata_columns || {}) };
    if (!current[filename]) current[filename] = {};
    current[filename] = { ...current[filename], [col]: value };
    setConfig({ metadata_columns: current });

    // Sync to UploadedFileInfo for core fields
    if (col === 'experiment') {
      updateFileMetadata(filename, { experiment: value });
    }
    if (col === 'batch') {
      updateFileMetadata(filename, { batch: value });
    }
  };

  // --- CSV Import ---
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const csvFile = e.target.files?.[0];
    if (!csvFile) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = (evt.target?.result as string).replace(/\r/g, '');
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) { addToast('warning', 'CSV must have a header and at least one data row'); return; }
        const headers = parseCSVLine(lines[0]);
        const filenameIdx = headers.indexOf('filename');
        if (filenameIdx === -1) { addToast('warning', 'CSV must have a "filename" column'); return; }
        const colNames = headers.filter((h) => h !== 'filename');

        const uploadedFilenames = new Set(uploadedFiles.map((f) => f.filename));

        const imported: Record<string, Record<string, string>> = {};
        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const fn = values[filenameIdx];
          if (!fn || !uploadedFilenames.has(fn)) continue;
          const entry: Record<string, string> = {};
          colNames.forEach((col) => {
            const colIdx = headers.indexOf(col);
            if (colIdx >= 0) entry[col] = values[colIdx] || '';
          });
          imported[fn] = entry;
        }

        // Atomically update metadata_columns via store action (preserves Immer immutability)
        importMetadataColumns(imported);

        addToast('success', `Merged metadata for ${Object.keys(imported).length} file(s)`);
      } catch (err) {
        addToast('error', `Failed to parse CSV: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(csvFile);
    e.target.value = '';
  };

  // --- CSV Export ---
  const handleExportCSV = () => {
    if (uploadedFiles.length === 0) return;
    const allCols = ['experiment', ...dataColumns, 'replicate', 'batch'];
    const header = ['filename', ...allCols].join(',');
    const rows = uploadedFiles.map((file) => {
      const meta = config.metadata_columns?.[file.filename] || {};
      const values = [file.filename];
      allCols.forEach((col) => {
        const val = meta[col] ?? '';
        const needsEscape = val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r');
        values.push(needsEscape ? `"${val.replace(/"/g, '""')}"` : val);
      });
      return values.join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dia_metadata.csv';
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Metadata exported as CSV');
  };

  if (uploadedFiles.length === 0) {
    return (
      <div className="text-center py-12 bg-surface rounded-lg border border-dashed border-border">
        <p className="text-text-muted">No DIA files uploaded yet</p>
        <p className="text-sm text-text-muted mt-1">
          Upload DIA PSM files to configure metadata
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Column Manager Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder="New column (e.g., Drug, Time)"
            className="px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent w-48"
            onKeyDown={(e) => { if (e.key === 'Enter') addColumn(); }}
          />
          <button
            onClick={addColumn}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Group
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImportCSV}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text"
          >
            <Upload className="w-4 h-4" /> Import Metadata CSV
          </button>
          <button
            onClick={handleExportCSV}
            disabled={uploadedFiles.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export Metadata CSV
          </button>
        </div>
      </div>

      {/* Metadata Table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Filename
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Experiment
              </th>
              {dataColumns.map((col) => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  <EditableColumnHeader
                    name={col}
                    onRename={(newName) => renameColumn(col, newName)}
                    onRemove={() => removeColumn(col)}
                  />
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Replicate
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Batch
              </th>
            </tr>
          </thead>
          <tbody className="bg-background divide-y divide-border">
            {uploadedFiles.map((file) => {
              const meta = config.metadata_columns?.[file.filename] || {};
              return (
                <tr key={file.filename} className="hover:bg-surface transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />
                      <span className="text-sm text-text truncate max-w-[200px]" title={file.filename}>
                        {file.filename}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={meta.experiment || ''}
                      onChange={(e) => updateCell(file.filename, 'experiment', e.target.value)}
                      className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                    />
                  </td>
                  {dataColumns.map((col) => (
                    <td key={col} className="px-4 py-3">
                      <input
                        type="text"
                        value={meta[col] || ''}
                        onChange={(e) => updateCell(file.filename, col, e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      value={meta.replicate || ''}
                      onChange={(e) => updateCell(file.filename, 'replicate', e.target.value)}
                      className="w-20 px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={meta.batch || ''}
                      onChange={(e) => updateCell(file.filename, 'batch', e.target.value)}
                      className="w-24 px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="text-sm text-text-secondary">
        {uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''} with{' '}
        {dataColumns.length} condition group{dataColumns.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};


export default DiaMetadataTable;
