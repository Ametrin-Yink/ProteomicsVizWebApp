# Unified Experiment Structure Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Experiment Structure panel and Condition Metadata panel into a
single unified panel on the Upload page, add CSV import/export, remove metadata
editing from downstream pages, and add a read-only Summary page before processing.

**Architecture:** Expand the existing `ExperimentTable` component with custom
metadata columns, CSV import/export, and auto-population logic. Strip the
Condition Metadata section from the Comparisons page and the Sample Metadata
grid from ConfigPanel. Add a new Summary page as the final wizard step.
Repurpose the Config page's "Start Analysis" logic on the Summary page.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand with Immer

---

### Task 1: Sync updateFileMetadata with metadata_columns in the store

**Files:**
- Modify: `frontend/src/stores/analysis-store.ts:152-160`

- [ ] **Step 1: Update updateFileMetadata to also sync metadata_columns**

Edit `frontend/src/stores/analysis-store.ts`, replace the `updateFileMetadata`
action (lines 152-160):

```typescript
updateFileMetadata: (filename, updates) => {
  set((state) => {
    const file = state.uploadedFiles.find((f: ParsedFilename) => f.filename === filename);
    if (file) {
      if (updates.experiment !== undefined) file.experiment = updates.experiment;
      if (updates.condition !== undefined) file.condition = updates.condition;
    }
    // Sync to metadata_columns so the unified panel and downstream consumers stay consistent
    if (!state.config.metadata_columns) state.config.metadata_columns = {};
    if (!state.config.metadata_columns[filename]) state.config.metadata_columns[filename] = {};
    if (updates.experiment !== undefined) state.config.metadata_columns[filename].experiment = updates.experiment;
    if (updates.condition !== undefined) state.config.metadata_columns[filename].condition = updates.condition;
  });
},
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/analysis-store.ts
git commit -m "feat: sync updateFileMetadata to metadata_columns in analysis store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Expand ExperimentTable with custom metadata columns and CSV import/export

**Files:**
- Modify: `frontend/src/components/analysis/ExperimentTable.tsx`

- [ ] **Step 1: Add imports and new state variables**

Replace the imports (lines 8-10) and state declarations (lines 106-118) in
`ExperimentTable.tsx`:

```typescript
import React, { useState, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Filter, Search, X, Plus, Download, Upload } from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
```

After the `EditableBadge` component (line 87), add a new `EditableHeader`
component for custom column headers:

```typescript
const EditableHeader: React.FC<{
  colName: string;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (colName: string) => void;
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
        onClick={() => { setEditValue(colName); setIsEditing(true); }}
        className="hover:text-primary transition-colors"
      >
        {colName}
      </button>
      <button
        onClick={() => onRemove(colName)}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-all"
        title={`Remove ${colName}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Add custom column state and auto-population logic**

Replace the state declarations inside `ExperimentTable` (lines 106-118) with:

```typescript
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

  // Auto-populate metadata_columns from uploaded files on mount
  React.useEffect(() => {
    if ((!config.metadata_columns || Object.keys(config.metadata_columns).length === 0) && uploadedFiles.length > 0) {
      const init: Record<string, Record<string, string>> = {};
      uploadedFiles.forEach((f) => {
        init[f.filename] = {
          experiment: f.experiment,
          condition: f.condition,
          replicate: String(f.replicate),
        };
      });
      setConfig({ metadata_columns: init });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive custom column names (exclude core columns: experiment, condition, replicate)
  const customColumns = useMemo(() => {
    if (!config.metadata_columns) return [];
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && k !== 'condition' && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns]);
```

- [ ] **Step 3: Add metadata column management functions**

Add these functions after the `useEffect` for page reset (line 204):

```typescript
  // --- Custom column management ---
  const addColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    if (customColumns.includes(name)) {
      addToast('warning', `Column "${name}" already exists`);
      return;
    }
    const current = { ...(config.metadata_columns || {}) };
    Object.keys(current).forEach((fn) => {
      current[fn] = { ...current[fn], [name]: '' };
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

  const updateCell = (filename: string, col: string, value: string) => {
    const current = { ...(config.metadata_columns || {}) };
    if (!current[filename]) current[filename] = {};
    current[filename] = { ...current[filename], [col]: value };
    setConfig({ metadata_columns: current });
  };

  // --- CSV Import/Export ---
  const handleExportCSV = () => {
    if (uploadedFiles.length === 0) return;
    const allCols = ['experiment', 'condition', 'replicate', ...customColumns];
    const header = ['filename', ...allCols].join(',');
    const rows = uploadedFiles.map((file) => {
      const meta = config.metadata_columns?.[file.filename] || {};
      const values = [file.filename];
      allCols.forEach((col) => {
        const val = meta[col] ?? '';
        const escaped = val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
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

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i]);
          const fn = values[filenameIdx];
          if (!fn || !uploadedFilenames.has(fn)) continue;
          if (!current[fn]) current[fn] = {};
          colNames.forEach((col, ci) => {
            current[fn][col] = values[headers.indexOf(col)] || '';
          });
          merged++;
        }
        setConfig({ metadata_columns: current });
        addToast('success', `Merged metadata for ${merged} file(s)`);
      } catch {
        addToast('error', 'Failed to parse CSV file');
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = '';
  };

  const parseCSVLine = (line: string): string[] => {
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
  };
```

Place `parseCSVLine` as a module-level function **above** `export const ExperimentTable`
(not inside the component). It's a pure utility with no React dependencies.

- [ ] **Step 4: Add the Column Manager Bar before the filter bar**

Replace the filter bar div (lines 222-271) — insert the column manager bar
above the existing filters:

```tsx
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
```

- [ ] **Step 5: Add custom column headers and cells to the table**

Replace the table header `<tr>` (lines 277-293) — add dynamic custom column
headers after Replicate and before Actions:

```tsx
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
              <TableHeader field="condition" onSort={handleSort} sort={sort}>Condition</TableHeader>
              <TableHeader field="replicate" className="text-right" onSort={handleSort} sort={sort}>Replicate</TableHeader>
              {customColumns.map((col) => (
                <th key={col} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  <EditableHeader
                    colName={col}
                    onRename={renameColumn}
                    onRemove={removeColumn}
                  />
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
```

Replace the table cell rendering (lines 307-361) — add custom column cells:

```tsx
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm text-text font-mono">
                      #{file.replicate}
                    </span>
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
                  <td className="px-4 py-3">
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors. Fix any type issues.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/analysis/ExperimentTable.tsx
git commit -m "feat: expand ExperimentTable with custom metadata columns and CSV import/export

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Strip Condition Metadata section from Comparisons page

**Files:**
- Modify: `frontend/src/app/new/comparisons/page.tsx`

- [ ] **Step 1: Remove metadata editing state and functions**

Remove lines 24-26 (metadata editor state: `newColName`, `editingColName`, `editColValue`).
Remove lines 57-70 (auto-population useEffect).
Remove lines 119-195 (metadata editing functions: `addColumn`, `startRenameColumn`,
`finishRenameColumn`, `removeColumn`, `updateCell`).
Remove the `conditionColumns` useMemo (lines 73-82) — it's no longer needed.

- [ ] **Step 2: Remove the Condition Metadata section (SECTION 1)**

Remove lines 317-408 (the entire `<section>` for "Condition Metadata").

- [ ] **Step 3: Update the header subtitle**

Change line 313 from:
```tsx
<p className="text-text-muted mt-1">
  Define condition columns, then drag cards to build comparisons
</p>
```
to:
```tsx
<p className="text-text-muted mt-1">
  Drag condition cards into groups to build comparisons
</p>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors. Fix any unused import/variable issues.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/new/comparisons/page.tsx
git commit -m "refactor: remove Condition Metadata section from Comparisons page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Clean up ConfigPanel and update Config page navigation

**Files:**
- Modify: `frontend/src/components/analysis/ConfigPanel.tsx`
- Modify: `frontend/src/app/new/config/page.tsx`

- [ ] **Step 1: Remove Sample Metadata grid from ConfigPanel**

Remove lines 292-393 in `ConfigPanel.tsx` — the entire block starting with
`{template === "multi_condition_comparison" && (` through the closing `)}`.
This removes the "Sample Metadata" grid with the metadata table and "Add Column" input.

Also remove the `newColumnName` state (`const [newColumnName, setNewColumnName] = useState('');` on line 20)
since it was only used by the removed section.

- [ ] **Step 2: Update Config page to navigate to Summary**

In `frontend/src/app/new/config/page.tsx`:

Replace `handleStartAnalysis` (lines 50-68) to navigate to summary instead:

```typescript
  const handleContinue = async () => {
    if (!canStart || !sessionId) return;
    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsStarting(false);
      return;
    }

    setIsStarting(false);
    router.push(`/new/summary?session=${sessionId}`);
  };
```

Replace the button text and icon (lines 252-274) — change from "Start Analysis" with
Play icon to "Continue to Summary" with ArrowRight:

```tsx
        <button
          data-testid="config-continue-btn"
          onClick={handleContinue}
          disabled={!canStart || isStarting}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            canStart && !isStarting
              ? 'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
              : 'bg-border text-text-muted cursor-not-allowed'
          )}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              Continue to Summary
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
```

Add `ArrowRight` to the imports from lucide-react on line 10.

Remove the Experiment Summary section (lines 201-224) — the summary page now
handles this.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/analysis/ConfigPanel.tsx frontend/src/app/new/config/page.tsx
git commit -m "refactor: remove metadata grid from ConfigPanel, route to new Summary page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Create the Summary page

**Files:**
- Create: `frontend/src/app/new/summary/page.tsx`

- [ ] **Step 1: Create the summary page**

Write `frontend/src/app/new/summary/page.tsx`:

```tsx
'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Play, Loader2, Dna, BarChart3,
  FileText, Table2, GitCompare, Sliders, CheckCircle,
} from 'lucide-react';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useUIStore } from '@/stores/ui-store';
import { sessionsApi, processingApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function formatGroup(g: Record<string, string>): string {
  return Object.entries(g).map(([, v]) => v).join('+') || '(any)';
}

function SummaryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';

  const state = useAnalysisStore();
  const { config, selectedPipeline, uploadedFiles } = state;
  const { addToast } = useUIStore();

  const [isStarting, setIsStarting] = React.useState(false);

  React.useEffect(() => {
    if (!sessionId) { router.replace('/'); }
    else if (!selectedPipeline) { router.replace(`/new/pipeline?session=${sessionId}`); }
  }, [sessionId, selectedPipeline, router]);

  const customColumns = React.useMemo(() => {
    if (!config.metadata_columns) return [];
    const cols = new Set<string>();
    Object.values(config.metadata_columns).forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== 'experiment' && k !== 'condition' && k !== 'replicate') cols.add(k);
      });
    });
    return Array.from(cols);
  }, [config.metadata_columns]);

  const totalSize = React.useMemo(
    () => uploadedFiles.reduce((sum, f) => sum + f.size, 0),
    [uploadedFiles]
  );

  const organismLabel = React.useMemo(() => {
    const org = state.availableOrganisms.find((o) => o.id === config.organism);
    return org?.display_name || config.organism || 'Not selected';
  }, [config.organism, state.availableOrganisms]);

  const handleBack = () => {
    router.push(`/new/config?session=${sessionId}`);
  };

  const handleStartAnalysis = async () => {
    if (!sessionId) return;
    setIsStarting(true);

    try {
      await sessionsApi.updateConfig(sessionId, config);
    } catch (error) {
      addToast('warning', `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      await processingApi.start(sessionId);
    } catch {
      addToast('error', 'Failed to start processing. Please try again.');
      setIsStarting(false);
      return;
    }

    router.push(`/analysis/processing?session_id=${sessionId}&pipeline=${selectedPipeline}`);
  };

  const pipelineLabel = selectedPipeline === 'msstats' ? 'MSstats' : 'msqrob2';
  const PipelineIcon = selectedPipeline === 'msstats' ? BarChart3 : Dna;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-3">
          <CheckCircle className="w-4 h-4" />
          Review &amp; Confirm
        </div>
        <h1 className="text-2xl font-bold text-text">Analysis Summary</h1>
        <p className="text-text-muted mt-1">
          Review all settings before starting the analysis
        </p>
      </div>

      {/* Pipeline */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <PipelineIcon className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Pipeline</h2>
          </div>
        </div>
        <div className="p-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <PipelineIcon className="w-4 h-4" />
            {pipelineLabel}
          </span>
        </div>
      </section>

      {/* Files */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Files</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 text-sm mb-4">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Files</span>
              <span className="text-text font-medium">{uploadedFiles.length}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Total Size</span>
              <span className="text-text font-medium">{(totalSize / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          </div>
        </div>
      </section>

      {/* Experiment Structure (read-only) */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Table2 className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Experiment Structure</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Filename</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Experiment</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Condition</th>
                  <th className="text-left py-2 px-3 text-text-muted font-medium text-xs">Replicate</th>
                  {customColumns.map((col) => (
                    <th key={col} className="text-left py-2 px-3 text-text-muted font-medium text-xs">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => {
                  const meta = config.metadata_columns?.[file.filename] || {};
                  return (
                    <tr key={file.filename} className="border-b border-border/50">
                      <td className="py-1.5 px-3 text-text text-xs font-mono truncate max-w-[200px]" title={file.filename}>
                        {file.filename}
                      </td>
                      <td className="py-1.5 px-3 text-text text-xs">{meta.experiment || file.experiment}</td>
                      <td className="py-1.5 px-3 text-text text-xs">{meta.condition || file.condition}</td>
                      <td className="py-1.5 px-3 text-text text-xs font-mono">#{meta.replicate || file.replicate}</td>
                      {customColumns.map((col) => (
                        <td key={col} className="py-1.5 px-3 text-text text-xs">{meta[col] || '—'}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Comparisons */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <GitCompare className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Comparisons</h2>
          </div>
        </div>
        <div className="p-5">
          {(!config.comparisons || config.comparisons.length === 0) ? (
            <p className="text-sm text-text-muted italic">No comparisons defined</p>
          ) : (
            <div className="space-y-1">
              {config.comparisons.map((comp, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-text px-3 py-2 bg-surface rounded-lg border border-border">
                  <span className="font-medium text-blue-700">{formatGroup(comp.group1)}</span>
                  <span className="text-text-muted">vs</span>
                  <span className="font-medium text-red-700">{formatGroup(comp.group2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Configuration */}
      <section className="bg-background border border-border rounded-lg">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <Sliders className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text">Configuration</h2>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Organism</span>
              <span className="text-text font-medium">{organismLabel}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Remove Razor Peptides</span>
              <span className={cn('font-medium', config.remove_razor ? 'text-success' : 'text-text-muted')}>
                {config.remove_razor ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Strict Filtering</span>
              <span className={cn('font-medium', config.strict_filtering ? 'text-success' : 'text-text-muted')}>
                {config.strict_filtering ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">P-Value Threshold</span>
              <span className="text-text font-medium">{config.pvalue_threshold ?? 0.05}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Log2 FC Threshold</span>
              <span className="text-text font-medium">{config.logfc_threshold ?? 1.0}</span>
            </div>
            <div className="bg-surface rounded-lg p-3">
              <span className="text-text-muted block text-xs">Min Peptides per Protein</span>
              <span className="text-text font-medium">{config.min_peptides_per_protein ?? 1}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Covariates (MSstats only) */}
      {selectedPipeline === 'msstats' && (config.covariate_columns?.length ?? 0) > 0 && (
        <section className="bg-background border border-border rounded-lg">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-lg font-semibold text-text">Covariates</h2>
          </div>
          <div className="p-5">
            <div className="flex flex-wrap gap-2">
              {config.covariate_columns?.map((col) => (
                <span key={col} className="px-3 py-1 bg-primary/10 border border-primary/30 rounded-lg text-sm text-primary">
                  {col}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-muted hover:text-text bg-surface border border-border rounded-lg hover:bg-border/20 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Configuration
        </button>
        <button
          data-testid="summary-start-analysis-btn"
          onClick={handleStartAnalysis}
          disabled={isStarting}
          className={cn(
            'inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
            'bg-primary text-white hover:bg-primary-dark shadow-sm hover:shadow'
          )}
        >
          {isStarting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Starting Analysis...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start Analysis
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted">Loading...</div>}>
      <SummaryContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/new/summary/page.tsx
git commit -m "feat: add read-only Summary page before analysis processing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Add Summary step to wizard layout

**Files:**
- Modify: `frontend/src/app/new/layout.tsx`

- [ ] **Step 1: Add summary step to wizard**

Add `CheckCircle` to the lucide-react import (line 11):
```typescript
import { ArrowLeft, Upload, GitBranch, GitCompare, Sliders, CheckCircle } from 'lucide-react';
```

Add the 5th step to the `steps` array (after line 19):
```typescript
const steps = [
  { id: 'upload', label: 'Upload & Setup', icon: Upload, route: '/new/upload', testId: 'wizard-step-1' },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch, route: '/new/pipeline', testId: 'wizard-step-2' },
  { id: 'comparisons', label: 'Comparisons', icon: GitCompare, route: '/new/comparisons', testId: 'wizard-step-3' },
  { id: 'config', label: 'Configure', icon: Sliders, route: '/new/config', testId: 'wizard-step-4' },
  { id: 'summary', label: 'Summary', icon: CheckCircle, route: '/new/summary', testId: 'wizard-step-5' },
];
```

Update `getStepIndex` (lines 22-27) to handle the summary route:
```typescript
function getStepIndex(pathname: string): number {
  if (pathname.includes('/new/summary')) return 4;
  if (pathname.includes('/new/config')) return 3;
  if (pathname.includes('/new/comparisons')) return 2;
  if (pathname.includes('/new/pipeline')) return 1;
  return 0;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/new/layout.tsx
git commit -m "feat: add Summary step to wizard layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Integration test — verify the full flow compiles and types check

**Files:**
- None modified (verification only)

- [ ] **Step 1: Full TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: Zero errors across all files.

- [ ] **Step 2: Lint check**

Run: `cd frontend && npm run lint`
Expected: No new errors. Fix any that appear.

- [ ] **Step 3: Quick build check**

Run: `cd frontend && npm run build`
Expected: Successful production build.

---

### Task 8: Final commit for any cleanup

**Files:**
- Any remaining changes

- [ ] **Step 1: Check git status**

Run: `git status`
Expected: Only planned files modified.

- [ ] **Step 2: Final commit if needed**

If any cleanup changes remain, commit them. Otherwise skip.
