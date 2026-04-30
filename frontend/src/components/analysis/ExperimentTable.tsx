/**
 * ExperimentTable Component
 * Displays uploaded files with experiment structure and selection
 */

'use client';

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';


type SortField = 'filename' | 'experiment' | 'condition' | 'replicate';
type SortDirection = 'asc' | 'desc';

interface SortState {
  field: SortField;
  direction: SortDirection;
}

export const ExperimentTable: React.FC = () => {
  const [sort, setSort] = useState<SortState>({ field: 'filename', direction: 'asc' });
  const [filterText, setFilterText] = useState('');
  const [filterExperiment, setFilterExperiment] = useState<string>('all');
  const [filterCondition, setFilterCondition] = useState<string>('all');
  
  const {
    uploadedFiles,
    selectedFiles,
    toggleFileSelection,
    removeUploadedFile,
  } = useAnalysisStore();

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
  
  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sort.field !== field) {
      return <div className="w-4 h-4" />;
    }
    return sort.direction === 'asc' 
      ? <ChevronUp className="w-4 h-4" />
      : <ChevronDown className="w-4 h-4" />;
  };
  
  const TableHeader: React.FC<{
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }> = ({ field, children, className = '' }) => (
    <th
      onClick={() => handleSort(field)}
      className={`
        px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider
        cursor-pointer hover:bg-surface transition-colors select-none
        ${className}
      `}
    >
      <div className="flex items-center gap-1">
        {children}
        <SortIcon field={field} />
      </div>
    </th>
  );
  
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
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-surface rounded-lg">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search files..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
        
        {experiments.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-text-muted" />
            <select
              value={filterExperiment}
              onChange={(e) => setFilterExperiment(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Conditions</option>
              {conditions.map((cond) => (
                <option key={cond} value={cond}>{cond}</option>
              ))}
            </select>
          </div>
        )}
        
        <div className="flex-1" />
        
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
                  className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
                />
              </th>
              <TableHeader field="filename">Filename</TableHeader>
              <TableHeader field="experiment">Experiment</TableHeader>
              <TableHeader field="condition">Condition</TableHeader>
              <TableHeader field="replicate" className="text-right">Replicate</TableHeader>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border">
            {filteredAndSortedFiles.map((file, index) => {
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
                      className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
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
                    <span data-testid="experiment-name" className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary/10 text-secondary">
                      {file.experiment}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span data-testid={`condition-${file.condition}`} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                      {file.condition}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-text font-mono">
                      #{file.replicate}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      data-testid={`remove-file-${index}`}
                      onClick={() => removeUploadedFile(file.filename)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
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
