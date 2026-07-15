/**
 * TmtChannelMapping Component
 * Editable table mapping TMT channels to condition groups and replicates.
 * Supports multi-file TMT via collapsible sections per file (handled at page level).
 */

'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Download, Upload, AlertCircle, Undo2 } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import type { UploadedFileInfo } from '@/types';
import { EditableColumnHeader } from '@/components/ui/EditableColumnHeader';

interface TmtChannelMappingProps {
  /** Single TMT file whose channels to map */
  file: UploadedFileInfo;
  /** If true, render in a compact mode for collapsible sections */
  compact?: boolean;
}

export const TmtChannelMapping: React.FC<TmtChannelMappingProps> = ({ file, compact }) => {
  const allMapping = useAnalysisStore((s) => s.config.tmt_channel_mapping ?? {});
  const setConfig = useAnalysisStore((s) => s.setConfig);
  const updateChannelMapping = useAnalysisStore((s) => s.updateChannelMapping);
  const importChannelMapping = useAnalysisStore((s) => s.importChannelMapping);
  const updateFileMetadata = useAnalysisStore((s) => s.updateFileMetadata);
  const { addToast } = useUIStore();

  const [newColName, setNewColName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<Array<Record<string, Record<string, unknown>>>>([]);
  const [isDetectingChannels, setIsDetectingChannels] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  // T-015/T-016: Simulate channel detection loading/error state
  const channels = useMemo(() => {
    if (!file.tmt_channels || file.tmt_channels.length === 0) {
      setIsDetectingChannels(true);
      setChannelError(null);
    }
    return file.tmt_channels || [];
  }, [file.tmt_channels]);

  // Clear loading state once channels are available or error is set
  useEffect(() => {
    if (file.tmt_channels && file.tmt_channels.length > 0) {
      setIsDetectingChannels(false);
      setChannelError(null);
    }
  }, [file.tmt_channels]);

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

  // T-021: Detect duplicate replicates within the same condition group
  const duplicateReplicates = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const [, entry] of Object.entries(tmtChannelMapping)) {
      const rep = entry.replicate;
      if (rep === undefined || rep === null || Number(rep) <= 0) continue;
      // Build condition group key from non-replicate columns
      const groupKey = Object.entries(entry)
        .filter(([k]) => k !== 'replicate')
        .map(([, v]) => String(v ?? ''))
        .filter(Boolean)
        .sort()
        .join('::');
      if (!groupKey) continue;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(Number(rep));
    }
    const result: string[] = [];
    for (const [group, reps] of Object.entries(groups)) {
      const dupes = reps.filter((r, i) => reps.indexOf(r) !== i);
      if (dupes.length > 0) {
        result.push(`${group} (replicates: ${[...new Set(dupes)].join(', ')})`);
      }
    }
    return result;
  }, [tmtChannelMapping]);

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
    if (!window.confirm(`Delete column "${colName}" and all its data? This cannot be undone.`)) return;
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

  const handleUpdateWithUndo = (channel: string, col: string, value: string | number) => {
    const current = useAnalysisStore.getState().config.tmt_channel_mapping ?? {};
    setHistory(prev => [...prev.slice(-20), structuredClone(current)]);
    updateChannelMapping(file.filename, channel, { [col]: value });
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setConfig({ tmt_channel_mapping: prev as Record<string, Record<string, string | number>> });
  };

  const updateExperimentName = (name: string) => {
    updateFileMetadata(file.filename, { experiment: name });
  };

  // --- CSV Import ---
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const csvFile = e.target.files?.[0];
    if (!csvFile) return;
    const mapping = useAnalysisStore.getState().config.tmt_channel_mapping ?? {};
    const hasExistingData = Object.keys(mapping).length > 0;
    if (hasExistingData) {
      if (!window.confirm('Importing CSV will replace all current channel assignments. Continue?')) {
        e.target.value = '';
        return;
      }
    }
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
    if (isDetectingChannels) {
      return (
        <div className="text-sm text-text-muted italic p-4 flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
          Detecting TMT channels...
        </div>
      );
    }
    if (channelError) {
      return (
        <div className="text-sm text-error p-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {channelError}
        </div>
      );
    }
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
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-surface border border-border rounded-md hover:bg-border/20 transition-colors text-text disabled:opacity-50 disabled:cursor-not-allowed"
            title="Undo last change"
          >
            <Undo2 className="w-4 h-4" /> Undo
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
                    name={col}
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
                        onChange={(e) => handleUpdateWithUndo(channel, col, e.target.value)}
                        className="w-full px-2 py-1 bg-surface border border-border rounded text-text text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={1}
                      value={entry.replicate ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        // T-020: Reject non-numeric and <= 0
                        const parsed = parseInt(val, 10);
                        if (val !== '' && (isNaN(parsed) || parsed <= 0)) {
                          addToast('error', 'Replicate must be a positive number');
                          return;
                        }
                        handleUpdateWithUndo(channel, 'replicate', parsed || 0);
                      }}
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

      {/* T-021: Duplicate replicate number warning */}
      {duplicateReplicates.length > 0 && (
        <div className="flex flex-col gap-1 text-sm text-warning">
          {duplicateReplicates.map((dup, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>Duplicate replicate number in condition group: {dup}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


export default TmtChannelMapping;
