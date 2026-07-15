/**
 * TmtChannelMapping Component
 * Editable table mapping TMT channels to condition groups and replicates.
 * Supports multi-file TMT via collapsible sections per file (handled at page level).
 */

'use client';

import React, { useState, useMemo, useRef } from 'react';
import { Plus, Download, Upload, X, AlertCircle } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import type { UploadedFileInfo } from '@/types';

interface TmtChannelMappingProps {
  /** Single TMT file whose channels to map */
  file: UploadedFileInfo;
  /** If true, render in a compact mode for collapsible sections */
  compact?: boolean;
}

export const TmtChannelMapping: React.FC<TmtChannelMappingProps> = ({ file, compact }) => {
  const allMapping = useAnalysisStore((s) => s.config.tmt_channel_mapping ?? {});
  const updateChannelMapping = useAnalysisStore((s) => s.updateChannelMapping);
  const importChannelMapping = useAnalysisStore((s) => s.importChannelMapping);
  const updateFileMetadata = useAnalysisStore((s) => s.updateFileMetadata);
  const { addToast } = useUIStore();

  const [newColName, setNewColName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channels = useMemo(() => file.tmt_channels || [], [file.tmt_channels]);

  // Filter mapping to only this file's entries (keys are filename::channel)
  const tmtChannelMapping = useMemo(() => {
    const prefix = file.filename + '::';
    const result: Record<string, Record<string, string | number>> = {};
    for (const [key, val] of Object.entries(allMapping)) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = val;
      }
    }
    return result;
  }, [allMapping, file.filename]);

  // Derive group column names from existing mapping (exclude 'replicate')
  const groupColumns = useMemo(() => {
    const cols = new Set<string>();
    Object.values(tmtChannelMapping).forEach((entry) => {
      Object.keys(entry).forEach((k) => {
        if (k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [tmtChannelMapping]);

  // Count mapped channels (have at least one group value and replicate)
  const mappedCount = useMemo(() => {
    return channels.filter((ch) => {
      const entry = tmtChannelMapping[ch];
      if (!entry) return false;
      const hasGroupVal = groupColumns.some((col) => {
        const v = entry[col];
        return v !== undefined && v !== null && String(v).trim() !== '';
      });
      const hasReplicate = entry.replicate !== undefined && entry.replicate !== null && Number(entry.replicate) > 0;
      return hasGroupVal && hasReplicate;
    }).length;
  }, [channels, tmtChannelMapping, groupColumns]);

  const allMapped = mappedCount === channels.length && channels.length > 0;

  // --- Column management ---
  const addColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    if (groupColumns.includes(name)) {
      addToast('warning', `Column "${name}" already exists`);
      return;
    }
    channels.forEach((channel) => {
      updateChannelMapping(file.filename, channel, { [name]: '' });
    });
    setNewColName('');
  };

  const removeColumn = (colName: string) => {
    channels.forEach((channel) => {
      const entry = tmtChannelMapping[channel];
      if (!entry) return;
      const { [colName]: _, ...rest } = entry;
      updateChannelMapping(file.filename, channel, rest);
    });
  };

  const renameColumn = (oldName: string, newName: string) => {
    if (!newName || newName === oldName) return;
    if (groupColumns.filter((c) => c !== oldName).includes(newName)) {
      addToast('warning', `Column "${newName}" already exists`);
      return;
    }
    channels.forEach((channel) => {
      const entry = tmtChannelMapping[channel] || {};
      if (oldName in entry) {
        const val = entry[oldName];
        const { [oldName]: _, ...rest } = entry;
        updateChannelMapping(file.filename, channel, { ...rest, [newName]: val });
      }
    });
  };

  const updateField = (channel: string, col: string, value: string | number) => {
    updateChannelMapping(file.filename, channel, { [col]: value });
  };

  const updateExperimentName = (name: string) => {
    updateFileMetadata(file.filename, { experiment: name });
  };

  // --- CSV Import ---
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const csvFile = e.target.files?.[0];
    if (!csvFile) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = (evt.target?.result as string).replace(/\r/g, '');
        importChannelMapping(text);
        addToast('success', 'Channel mapping imported');
      } catch (err) {
        addToast('error', `Failed to parse CSV: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(csvFile);
    e.target.value = '';
  };

  // --- CSV Export ---
  const handleExportCSV = () => {
    const headers = ['Channel', ...groupColumns, 'Replicate'];
    const rows = channels.map((channel) => {
      const entry = tmtChannelMapping[channel] || {};
      const values = [channel];
      groupColumns.forEach((col) => {
        const val = String(entry[col] ?? '');
        const needsEscape = val.includes(',') || val.includes('"') || val.includes('\n');
        values.push(needsEscape ? `"${val.replace(/"/g, '""')}"` : val);
      });
      values.push(String(entry.replicate ?? ''));
      return values.join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tmt_mapping_${file.filename.replace(/\.[^.]+$/, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Channel mapping exported as CSV');
  };

  if (channels.length === 0) {
    return (
      <div className="text-sm text-text-muted italic p-4">
        No TMT channels detected for this file.
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* Experiment name + File info */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted whitespace-nowrap">Experiment Name:</label>
          <input
            type="text"
            value={file.experiment || ''}
            onChange={(e) => updateExperimentName(e.target.value)}
            placeholder="Enter experiment name"
            className="px-3 py-1.5 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent w-56"
          />
        </div>
        <div className="text-sm text-text-muted">
          {channels.length} channels detected
          {!allMapped && channels.length > 0 && (
            <span className="ml-2 text-warning">
              ({mappedCount} mapped)
            </span>
          )}
        </div>
      </div>

      {/* Column Manager */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
            placeholder="New group (e.g., drug, time)"
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
            <Upload className="w-4 h-4" /> Import Mapping CSV
          </button>
          <button
            onClick={handleExportCSV}
            disabled={channels.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export Mapping CSV
          </button>
        </div>
      </div>

      {/* Channel Mapping Table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Channel
              </th>
              {groupColumns.map((col) => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  <EditableColumnHeader
                    colName={col}
                    onRename={(newName) => renameColumn(col, newName)}
                    onRemove={() => removeColumn(col)}
                  />
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Replicate
              </th>
            </tr>
          </thead>
          <tbody className="bg-background divide-y divide-border">
            {channels.map((channel) => {
              const entry = tmtChannelMapping[channel] || {};
              return (
                <tr key={channel} className="hover:bg-surface transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono font-medium text-text">{channel}</span>
                  </td>
                  {groupColumns.map((col) => (
                    <td key={col} className="px-4 py-3">
                      <input
                        type="text"
                        value={String(entry[col] ?? '')}
                        onChange={(e) => updateField(channel, col, e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      value={entry.replicate ?? ''}
                      onChange={(e) => updateField(channel, 'replicate', parseInt(e.target.value, 10) || 0)}
                      className="w-20 px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mapping status */}
      {!allMapped && channels.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-warning">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{channels.length - mappedCount} channel(s) not yet fully mapped</span>
        </div>
      )}
    </div>
  );
};

/** Editable column header with rename/remove */
const EditableColumnHeader: React.FC<{
  colName: string;
  onRename: (newName: string) => void;
  onRemove: () => void;
}> = ({ colName, onRename, onRemove }) => {
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
            if (e.key === 'Enter') { onRename(editValue.trim()); setIsEditing(false); }
            if (e.key === 'Escape') { setIsEditing(false); setEditValue(colName); }
          }}
          onBlur={() => { onRename(editValue.trim()); setIsEditing(false); }}
          className="w-24 px-1 py-0.5 bg-surface border border-primary rounded text-xs focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group">
      <button
        onClick={() => { setEditValue(colName); setIsEditing(true); }}
        className="hover:text-primary transition-colors text-left"
      >
        {colName}
      </button>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all"
        title={`Remove ${colName}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

export default TmtChannelMapping;
