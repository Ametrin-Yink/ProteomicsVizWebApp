/**
 * ExperimentTable Component
 * Displays uploaded files with experiment structure and selection
 */

'use client';

import React, { useState, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Filter, Search, X, Plus, Download, Upload } from 'lucide-react';
import { EditableBadge } from '@/components/analysis/EditableBadge';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';


type SortField = 'filename' | 'experiment' | 'condition' | 'replicate';
type SortDirection = 'asc' | 'desc';

interface SortState {
  field: SortField;
  direction: SortDirection;
}

interface TableHeaderProps {
  field: SortField;
  children: React.ReactNode;
  className?: string;
  onSort: (field: SortField) => void;
  sort: SortState;
}

const SortIcon: React.FC<{ field: SortField; sort: SortState }> = ({ field, sort }) => {
  if (sort.field !== field) {
    return null;
  }
  return sort.direction === 'asc'
    ? <ChevronUp className="w-4 h-4" />
    : <ChevronDown className="w-4 h-4" />;
};

const TableHeader: React.FC<TableHeaderProps> = ({ field, children, className = '', onSort, sort }) => (
  <th
    onClick={() => onSort(field)}
    className={`
      px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider
      cursor-pointer hover:bg-surface transition-colors select-none
      ${className}
    `}
  >
    <div className="flex items-center gap-1">
      {children}
      <SortIcon field={field} sort={sort} />
    </div>
  </th>
);

const EditableHeader: React.FC<{
  colName: string;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (colName: string) => void;
  hideRemove?: boolean;
}> = ({ colName, onRename, onRemove, hideRemove }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(colName);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onRename(colName, editValue.trim()); setIsEditing(false); }
            if (e.key === 'Escape') { setIsEditing(false); }
          }}
          onBlur={() => { onRename(colName, editValue.trim()); setIsEditing(false); }}
          className="w-24 px-1 py-0.5 bg-surface border border-primary rounded text-xs focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <button
        onClick={(e) => { e.stopPropagation(); setEditValue(colName); setIsEditing(true); }}
        className="hover:text-primary transition-colors"
      >
        {colName}
      </button>
      {!hideRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(colName); }}
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all"
          title={`Remove ${colName}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

export const ExperimentTable: React.FC = () => {
  const [sort, setSort] = useState<SortState>({ field: 'filename', direction: 'asc' });
  const [filterText, setFilterText] = useState('');
  const [filterExperiment, setFilterExperiment] = useState<string>('all');
  const [filterCondition, setFilterCondition] = useState<string>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const uploadedFiles = useAnalysisStore((s) => s.uploadedFiles);
  const selectedFiles = useAnalysisStore((s) => s.selectedFiles);
  const toggleFileSelection = useAnalysisStore((s) => s.toggleFileSelection);
  const removeUploadedFile = useAnalysisStore((s) => s.removeUploadedFile);
  const updateFileMetadata = useAnalysisStore((s) => s.updateFileMetadata);
  const config = useAnalysisStore((s) => s.config);
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const { addToast } = useUIStore();

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const conditionCol = config.condition_column || 'condition';

  // Auto-populate metadata_columns for any uploaded files missing entries
  React.useEffect(() => {
    if (uploadedFiles.length === 0) return;
    const current = { ...(config.metadata_columns || {}) };
    let hasChanges = false;
    uploadedFiles.forEach((f) => {
      if (!current[f.filename]) {
        current[f.filename] = {
          experiment: f.experiment,
          [conditionCol]: f.condition,
          replicate: String(f.replicate),
        };
        hasChanges = true;
      }
    });
    if (hasChanges) {
      setConfig({ metadata_columns: current });
    }
  }, [uploadedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive custom column names (exclude core columns: experiment, conditionCol, replicate)
  const customColumns = useMemo(() => {
    if (!config.metadata_columns) return [];
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && k !== conditionCol && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns, conditionCol]);

  // Derived values from raw state (useMemo to avoid infinite re-render loop in React 19)
  const selected = useMemo(
    () => uploadedFiles.filter((file) => selectedFiles.has(file.filename)),
    [uploadedFiles, selectedFiles]
  );
  const experiments = useMemo(
    () => Array.from(new Set(selected.map((f) => f.experiment))),
    [selected]
  );
  const conditions = useMemo(
    () => Array.from(new Set(selected.map((f) => f.condition))),
    [selected]
  );
  
  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    const filtered = uploadedFiles.filter((file) => {
      const matchesText = filterText === '' || 
        file.filename.toLowerCase().includes(filterText.toLowerCase()) ||
        file.experiment.toLowerCase().includes(filterText.toLowerCase()) ||
        file.condition.toLowerCase().includes(filterText.toLowerCase());
      
      const matchesExperiment = filterExperiment === 'all' || file.experiment === filterExperiment;
      const matchesCondition = filterCondition === 'all' || file.condition === filterCondition;
      
      return matchesText && matchesExperiment && matchesCondition;
    });
    
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sort.field) {
        case 'filename':
          comparison = a.filename.localeCompare(b.filename);
          break;
        case 'experiment':
          comparison = a.experiment.localeCompare(b.experiment);
          break;
        case 'condition':
          comparison = a.condition.localeCompare(b.condition);
          break;
        case 'replicate':
          comparison = a.replicate - b.replicate;
          break;
      }
      
      return sort.direction === 'asc' ? comparison : -comparison;
    });
    
    return filtered;
  }, [uploadedFiles, filterText, filterExperiment, filterCondition, sort]);

  const totalPages = Math.ceil(filteredAndSortedFiles.length / pageSize);

  // Reset page when filters change
  React.useEffect(() => { setPage(1); }, [filterText, filterExperiment, filterCondition]);

  // --- Custom column management ---
  const addColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    if (customColumns.includes(name)) {
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
    if (customColumns.filter(c => c !== oldName).includes(newName)) {
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
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      const row = { ...current[fn] };
      delete row[colName];
      current[fn] = row;
    });
    setConfig({ metadata_columns: current });
  };

  const renameConditionColumn = (oldName: string, newName: string) => {
    if (!newName || newName === oldName) return;
    if (customColumns.includes(newName)) {
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
    setConfig({ metadata_columns: current, condition_column: newName });
  };

  const updateCell = (filename: string, col: string, value: string) => {
    const current = { ...(config.metadata_columns || {}) };
    if (!current[filename]) current[filename] = {};
    current[filename] = { ...current[filename], [col]: value };
    setConfig({ metadata_columns: current });
  };

  // --- CSV Import/Export ---
  const handleExportCSV = () => {
    if (uploadedFiles.length === 0) return;
    const allCols = ['experiment', conditionCol, 'replicate', ...customColumns];
    const header = ['filename', ...allCols].join(',');
    const rows = uploadedFiles.map((file) => {
      const meta = config.metadata_columns?.[file.filename] || {};
      const values = [file.filename];
      allCols.forEach((col) => {
        const val = meta[col] ?? '';
        const needsEscape = val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r');
        const escaped = needsEscape ? `"${val.replace(/"/g, '""')}"` : val;
        values.push(escaped);
      });
      return values.join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'experiment_structure.csv';
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Experiment structure exported as CSV');
  };

  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) { addToast('warning', 'CSV must have a header and at least one data row'); return; }
        const headers = parseCSVLine(lines[0]);
        const filenameIdx = headers.indexOf('filename');
        if (filenameIdx === -1) { addToast('warning', 'CSV must have a "filename" column'); return; }
        const colNames = headers.filter((h) => h !== 'filename');

        const current = { ...(config.metadata_columns || {}) };
        const uploadedFilenames = new Set(uploadedFiles.map((f) => f.filename));
        let merged = 0;

        // Infer condition column from position in our export format:
        // colNames = ['experiment', <conditionCol>, 'replicate', ...customColumns]
        const csvConditionCol = colNames.length > 1 && colNames[1] !== 'replicate' ? colNames[1] : null;

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const fn = values[filenameIdx];
          if (!fn || !uploadedFilenames.has(fn)) continue;
          if (!current[fn]) current[fn] = {};
          colNames.forEach((col) => {
            const colIdx = headers.indexOf(col);
            if (colIdx >= 0) current[fn][col] = values[colIdx] || '';
          });
          merged++;
        }
        const configUpdate: Partial<typeof config> = { metadata_columns: current };
        if (csvConditionCol && csvConditionCol !== conditionCol) {
          configUpdate.condition_column = csvConditionCol;
        }
        setConfig(configUpdate);
        addToast('success', `Merged metadata for ${merged} file(s)`);
      } catch {
        addToast('error', 'Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };
  
  const handleSelectAll = () => {
    const allSelected = filteredAndSortedFiles.every((file) => 
      selectedFiles.has(file.filename)
    );
    
    if (allSelected) {
      filteredAndSortedFiles.forEach((file) => {
        if (selectedFiles.has(file.filename)) {
          toggleFileSelection(file.filename);
        }
      });
    } else {
      filteredAndSortedFiles.forEach((file) => {
        if (!selectedFiles.has(file.filename)) {
          toggleFileSelection(file.filename);
        }
      });
    }
  };
  
  const areAllFilteredSelected = filteredAndSortedFiles.length > 0 &&
    filteredAndSortedFiles.every((file) => selectedFiles.has(file.filename));

  if (uploadedFiles.length === 0) {
    return (
      <div className="text-center py-12 bg-surface rounded-lg border border-dashed border-border">
        <p className="text-text-muted">No files uploaded yet</p>
        <p className="text-sm text-text-muted mt-1">
          Upload PSM files to see experiment structure
        </p>
      </div>
    );
  }
  
  return (
    <div data-testid="experiment-structure" className="space-y-4">
      {/* Column Manager Bar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-surface rounded-lg">
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
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImportCSV}
            className="hidden"
            data-testid="csv-import-input"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={handleExportCSV}
            disabled={uploadedFiles.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>

        <div className="flex-1" />

        {/* Search and filters */}
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search files..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        {experiments.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-text-muted" />
            <select
              value={filterExperiment}
              onChange={(e) => setFilterExperiment(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Experiments</option>
              {experiments.map((exp) => (
                <option key={exp} value={exp}>{exp}</option>
              ))}
            </select>
          </div>
        )}

        {conditions.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={filterCondition}
              onChange={(e) => setFilterCondition(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Conditions</option>
              {conditions.map((cond) => (
                <option key={cond} value={cond}>{cond}</option>
              ))}
            </select>
          </div>
        )}

        <div className="text-sm text-text-secondary">
          {selected.length} of {uploadedFiles.length} selected
        </div>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table data-testid="file-table" className="min-w-full divide-y divide-border">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={areAllFilteredSelected}
                  onChange={handleSelectAll}
                  className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                />
              </th>
              <TableHeader field="filename" onSort={handleSort} sort={sort}>Filename</TableHeader>
              <TableHeader field="experiment" onSort={handleSort} sort={sort}>Experiment</TableHeader>
              <th
                onClick={() => handleSort('condition')}
                className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface transition-colors select-none"
              >
                <div className="flex items-center gap-1">
                  <EditableHeader
                    colName={conditionCol}
                    onRename={renameConditionColumn}
                    onRemove={() => {}}
                    hideRemove
                  />
                  <SortIcon field="condition" sort={sort} />
                </div>
              </th>
              {customColumns.map((col) => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  <EditableHeader
                    colName={col}
                    onRename={renameColumn}
                    onRemove={removeColumn}
                  />
                </th>
              ))}
              <TableHeader field="replicate" className="text-right" onSort={handleSort} sort={sort}>Replicate</TableHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-background divide-y divide-border">
            {filteredAndSortedFiles.slice((page - 1) * pageSize, page * pageSize).map((file, index) => {
              const isSelected = selectedFiles.has(file.filename);
              
              return (
                <tr
                  key={file.filename}
                  className={`
                    transition-colors
                    ${isSelected ? 'bg-primary/5' : 'hover:bg-surface'}
                  `}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleFileSelection(file.filename)}
                      className="w-4 h-4 text-primary border-border rounded focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-text">
                      {file.filename}
                    </div>
                    <div className="text-xs text-text-muted">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <EditableBadge
                      value={file.experiment}
                      isEditing={editingCell === `${file.filename}-exp`}
                      onEdit={() => setEditingCell(`${file.filename}-exp`)}
                      onSave={(val) => { updateFileMetadata(file.filename, { experiment: val }); setEditingCell(null); }}
                      onCancel={() => setEditingCell(null)}
                      colorClass="bg-secondary/10 text-secondary"
                      data-testid="experiment-name"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <EditableBadge
                      value={file.condition}
                      isEditing={editingCell === `${file.filename}-cond`}
                      onEdit={() => setEditingCell(`${file.filename}-cond`)}
                      onSave={(val) => { updateFileMetadata(file.filename, { condition: val }); setEditingCell(null); }}
                      onCancel={() => setEditingCell(null)}
                      colorClass="bg-success/10 text-success"
                      data-testid={`condition-${file.condition}`}
                    />
                  </td>
                  {customColumns.map((col) => (
                    <td key={col} className="px-4 py-3">
                      <input
                        type="text"
                        value={config.metadata_columns?.[file.filename]?.[col] || ''}
                        onChange={(e) => updateCell(file.filename, col, e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-text font-mono">
                      #{file.replicate}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      data-testid={`remove-file-${index}`}
                      onClick={() => removeUploadedFile(file.filename)}
                      className="p-1.5 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors"
                      title="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {filteredAndSortedFiles.length === 0 && (
        <div className="text-center py-8 text-text-muted">
          No files match the current filters
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages} ({filteredAndSortedFiles.length} total)
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded text-text-muted hover:bg-surface hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-7 h-7 text-xs rounded transition-colors ${
                  p === page
                    ? 'bg-primary text-white font-medium'
                    : 'text-text-muted hover:bg-surface hover:text-text'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded text-text-muted hover:bg-surface hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-text-secondary pt-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">Experiments:</span>
          <span>{experiments.length > 0 ? experiments.join(', ') : 'None'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">Conditions:</span>
          <span>{conditions.length > 0 ? conditions.join(', ') : 'None'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">Total Files:</span>
          <span>{uploadedFiles.length}</span>
        </div>
      </div>
    </div>
  );
};

export default ExperimentTable;
