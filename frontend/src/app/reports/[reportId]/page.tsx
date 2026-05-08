'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ChartScatter,
  Activity,
  Spline,
  GitCompare,
  ChartNetwork,
  Loader2,
  AlertCircle,
  Search,
  Download,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import cytoscape, { type Core } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';

cytoscape.use(coseBilkent);

// ─── Dynamic Plotly import ────────────────────────────────────────────────
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────

interface ReportMeta {
  name: string;
  session_name: string;
  created_at: string;
}

interface TabDef {
  id: string;
  label: string;
}

interface ReportData {
  report: ReportMeta;
  tabs: TabDef[];
  [tabId: string]: unknown;
}

interface VolcanoExport {
  figureSpec: { data: unknown[]; layout: Record<string, unknown> };
  deTable: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };
  markedProteins: string[];
  comparisonLabel: string;
}

interface QcFigureEntry {
  data: unknown[];
  layout: Record<string, unknown>;
}

interface QcExport {
  plots: Record<string, QcFigureEntry | null>;
}

interface GseaDatabaseExport {
  barChart: { data: unknown[]; layout: Record<string, unknown> };
  heatmap: { data: unknown[]; layout: Record<string, unknown> };
  pathwayTable: { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };
}

interface GseaExport {
  databases: string[];
  results: Record<string, GseaDatabaseExport>;
}

interface CompareExport {
  similarityMatrixSpec: { data: unknown[]; layout: Record<string, unknown> } | null;
  heatmapSpec: { data: unknown[]; layout: Record<string, unknown> } | null;
  comparisonLabel: string;
}

interface BioNetExport {
  cytoscapeElements: {
    nodes: cytoscape.ElementDefinition[];
    edges: cytoscape.ElementDefinition[];
  };
  edgeTypes: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  volcano: ChartScatter,
  qc: Activity,
  gsea: Spline,
  compare: GitCompare,
  bionet: ChartNetwork,
};

const EDGE_COLORS: Record<string, string> = {
  Activation: '#22c55e',
  Inhibition: '#ef4444',
  IncreaseAmount: '#f97316',
  DecreaseAmount: '#3b82f6',
  Complex: '#8b5cf6',
  Binding: '#8b5cf6',
  Phosphorylation: '#eab308',
  Dephosphorylation: '#f59e0b',
  Ubiquitination: '#ec4899',
  Deubiquitination: '#f472b6',
  Acetylation: '#06b6d4',
  Sumoylation: '#14b8a6',
  Methylation: '#6366f1',
  Demethylation: '#818cf8',
  Hydroxylation: '#84cc16',
  Palmitoylation: '#a1a1aa',
  Myristoylation: '#a1a1aa',
  Farnesylation: '#a1a1aa',
  Geranylgeranylation: '#a1a1aa',
  GtpActivation: '#22c55e',
  GapActivation: '#ef4444',
  GefActivation: '#22c55e',
  Cleavage: '#ef4444',
  Degradation: '#ef4444',
  Translocation: '#a855f7',
  Transactivation: '#22c55e',
  SelfInteraction: '#d4d4d8',
  ActiveForm: '#22c55e',
  InactiveForm: '#ef4444',
};

function resolveEdgeColor(interaction: string): string {
  for (const [type, color] of Object.entries(EDGE_COLORS)) {
    if (interaction.includes(type)) return color;
  }
  return '#9ca3af';
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function downloadCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[], filename: string): void {
  const header = columns.map((c) => JSON.stringify(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => JSON.stringify(String(row[c.key] ?? ''))).join(','))
    .join('\n');
  const blob = new Blob(['﻿' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── DataTable Component ──────────────────────────────────────────────────

interface DataTableColumn {
  key: string;
  label: string;
}

interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  pageSize?: number;
  searchable?: boolean;
  filename?: string;
}

function DataTable({ columns, rows, pageSize = 25, searchable = true, filename = 'export' }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);

  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [filter]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(q)),
    );
  }, [rows, filter, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        {searchable ? (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Filter..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface"
            />
          </div>
        ) : (
          <div />
        )}
        <button
          onClick={() => downloadCsv(sorted, columns, filename)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface hover:bg-border rounded-lg transition-colors"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface sticky top-0">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="text-left px-4 py-2.5 font-medium text-text-secondary cursor-pointer hover:text-text-primary whitespace-nowrap select-none"
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-text-muted">
                  No matching rows
                </td>
              </tr>
            ) : (
              paged.map((row, i) => (
                <tr key={i} className="border-t border-border hover:bg-surface/50 transition-colors">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-2 text-text-primary whitespace-nowrap">
                      {formatCellValue(row[col.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border text-sm text-text-secondary">
        <span>
          {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          {filter.trim() && filtered.length !== sorted.length
            ? ` (${filtered.length} shown)`
            : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-2 py-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <span className="text-xs">
            {safePage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="px-2 py-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function formatCellValue(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'number') {
    if (Math.abs(val) < 0.01 || Math.abs(val) > 10000) return val.toExponential(2);
    return val.toFixed(4);
  }
  return String(val);
}

// ─── Tab: Volcano ─────────────────────────────────────────────────────────

function VolcanoTab({ data: raw }: { data: unknown }) {
  const volcanoData = raw as VolcanoExport | undefined;
  if (!volcanoData?.figureSpec) {
    return <EmptyTab message="No volcano plot data available" />;
  }

  return (
    <div className="space-y-6">
      {/* Comparison Label */}
      <div className="flex items-center gap-2 text-text-secondary">
        <span className="font-semibold text-text-primary">Comparison:</span>
        <span>{volcanoData.comparisonLabel || 'Treatment vs Control'}</span>
      </div>

      {/* Volcano Plot */}
      <div className="bg-background rounded-lg border border-border p-4">
        <Plot
          data={volcanoData.figureSpec.data}
          layout={{ ...volcanoData.figureSpec.layout, autosize: true }}
          style={{ width: '100%', height: 500 }}
          useResizeHandler
          config={{ responsive: true, displayModeBar: false, staticPlot: false }}
        />
      </div>

      {/* DE Table */}
      {volcanoData.deTable?.columns?.length && volcanoData.deTable?.rows?.length ? (
        <div>
          <h3 className="text-base font-semibold mb-3">Differentially Expressed Proteins</h3>
          <DataTable
            columns={volcanoData.deTable.columns}
            rows={volcanoData.deTable.rows}
            filename={`de_proteins_${volcanoData.comparisonLabel?.replace(/[^a-zA-Z0-9]/g, '_') || 'export'}`}
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Tab: QC ──────────────────────────────────────────────────────────────

const QC_PLOT_LABELS: Record<string, string> = {
  pca: 'PCA Analysis',
  pvalue: 'P-value Distribution',
  psmCv: 'PSM CV by Condition',
  proteinCv: 'Protein CV by Condition',
  psmIntensity: 'PSM Intensity Distribution',
  proteinIntensity: 'Protein Intensity Distribution',
  completeness: 'Protein Data Completeness by Sample',
  psmCompleteness: 'PSM Data Completeness by Sample',
};

function QCTab({ data: raw }: { data: unknown }) {
  const qcData = raw as QcExport | undefined;
  const plotEntries = Object.entries(qcData?.plots ?? {}).filter(
    ([, v]) => v !== null && v !== undefined,
  ) as [string, QcFigureEntry][];

  if (plotEntries.length === 0) {
    return <EmptyTab message="No QC plot data available" />;
  }

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {plotEntries.map(([key, spec]) => (
          <div key={key} className="bg-background rounded-lg border border-border p-3">
            <Plot
              data={spec.data}
              layout={{ ...spec.layout, autosize: true }}
              style={{ width: '100%', height: 380 }}
              useResizeHandler
              config={{ responsive: true, displayModeBar: false, staticPlot: false }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: GSEA ────────────────────────────────────────────────────────────

function GSEATab({ data: raw }: { data: unknown }) {
  const gseaData = raw as GseaExport | undefined;

  const [selectedDb, setSelectedDb] = useState<string>('');

  const databases = gseaData?.databases ?? [];
  const dbResults = gseaData?.results ?? {};

  // Auto-select first database
  useEffect(() => {
    if (!selectedDb && databases.length > 0) {
      setSelectedDb(databases[0]);
    }
  }, [databases, selectedDb]);

  const activeDb = selectedDb && dbResults[selectedDb] ? dbResults[selectedDb] : null;

  if (!databases.length) {
    return <EmptyTab message="No GSEA data available" />;
  }

  return (
    <div className="space-y-6">
      {/* Database Selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-text-secondary">Database:</label>
        <div className="flex gap-2">
          {databases.map((db) => (
            <button
              key={db}
              onClick={() => setSelectedDb(db)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedDb === db
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-surface text-text-secondary hover:text-text-primary border border-border'
              }`}
            >
              {db}
            </button>
          ))}
        </div>
      </div>

      {activeDb && (
        <>
          {/* Bar Chart + Heatmap in 2-col grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-background rounded-lg border border-border p-3">
              <Plot
                data={activeDb.barChart.data}
                layout={{ ...activeDb.barChart.layout, autosize: true }}
                style={{ width: '100%', height: 400 }}
                useResizeHandler
                config={{ responsive: true, displayModeBar: false, staticPlot: false }}
              />
            </div>
            <div className="bg-background rounded-lg border border-border p-3">
              <Plot
                data={activeDb.heatmap.data}
                layout={{ ...activeDb.heatmap.layout, autosize: true }}
                style={{ width: '100%', height: 400 }}
                useResizeHandler
                config={{ responsive: true, displayModeBar: false, staticPlot: false }}
              />
            </div>
          </div>

          {/* Pathway Table */}
          {activeDb.pathwayTable?.columns?.length ? (
            <div>
              <h3 className="text-base font-semibold mb-3">Pathway Results</h3>
              <DataTable
                columns={activeDb.pathwayTable.columns}
                rows={activeDb.pathwayTable.rows}
                pageSize={20}
                filename={`gsea_${selectedDb}_pathways`}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Tab: Compare ─────────────────────────────────────────────────────────

function CompareTab({ data: raw }: { data: unknown }) {
  const compareData = raw as CompareExport | undefined;

  if (!compareData?.similarityMatrixSpec && !compareData?.heatmapSpec) {
    return <EmptyTab message="No comparison data available" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-text-secondary">
        <span className="font-semibold text-text-primary">Comparisons:</span>
        <span>{compareData.comparisonLabel || 'N/A'}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {compareData.similarityMatrixSpec && (
          <div className="bg-background rounded-lg border border-border p-3">
            <Plot
              data={compareData.similarityMatrixSpec.data}
              layout={{ ...compareData.similarityMatrixSpec.layout, autosize: true }}
              style={{ width: '100%', height: Math.max(400, (compareData.similarityMatrixSpec.layout as Record<string, unknown>).height as number || 400) }}
              useResizeHandler
              config={{ responsive: true, displayModeBar: false, staticPlot: false }}
            />
          </div>
        )}
        {compareData.heatmapSpec && (
          <div className="bg-background rounded-lg border border-border p-3">
            <Plot
              data={compareData.heatmapSpec.data}
              layout={{ ...compareData.heatmapSpec.layout, autosize: true }}
              style={{ width: '100%', height: Math.max(400, (compareData.heatmapSpec.layout as Record<string, unknown>).height as number || 400) }}
              useResizeHandler
              config={{ responsive: true, displayModeBar: false, staticPlot: false }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: BioNet ──────────────────────────────────────────────────────────

function BioNetTab({ data: raw }: { data: unknown }) {
  const bionetData = raw as BioNetExport | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [search, setSearch] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const elements = bionetData?.cytoscapeElements;
  const edgeTypes = bionetData?.edgeTypes ?? [];

  // Toggle a hidden edge type
  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Reset hidden types
  const clearFilters = useCallback(() => {
    setHiddenTypes(new Set());
    setSearch('');
  }, []);

  // Initialize / update Cytoscape
  useEffect(() => {
    if (!containerRef.current || !elements) return;

    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const allNodes = elements.nodes;
    const allEdges = elements.edges;

    // Filter edges by hidden types
    const visibleEdges = allEdges.filter((e) => {
      const interaction = e.data.interaction as string;
      if (!interaction) return true;
      for (const hidden of hiddenTypes) {
        if (interaction.includes(hidden)) return false;
      }
      return true;
    });

    // Get visible node IDs
    const visibleNodeIds = new Set<string>();
    visibleEdges.forEach((e) => {
      visibleNodeIds.add(e.data.source as string);
      visibleNodeIds.add(e.data.target as string);
    });
    // Always include nodes that might not have edges but exist
    allNodes.forEach((n) => {
      visibleNodeIds.add(n.data.id as string);
    });

    // Filter nodes by search
    const finalNodes = allNodes.filter((n) => {
      if (!search.trim()) return visibleNodeIds.has(n.data.id as string);
      const label = String((n.data.label ?? n.data.id ?? '')).toLowerCase();
      const id = String(n.data.id ?? '').toLowerCase();
      const q = search.toLowerCase();
      return label.includes(q) || id.includes(q);
    });

    const finalNodeIds = new Set(finalNodes.map((n) => n.data.id as string));
    const finalEdges = visibleEdges.filter(
      (e) => finalNodeIds.has(e.data.source as string) && finalNodeIds.has(e.data.target as string),
    );

    if (finalNodes.length === 0) {
      return;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...finalNodes, ...finalEdges],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            width: 40,
            height: 40,
            'background-color': '#3B82F6',
            color: '#1e293b',
            'font-size': '11px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'padding-top': '6px',
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': (ele: cytoscape.EdgeSingular) => resolveEdgeColor(String(ele.data('interaction') ?? '')),
            'target-arrow-color': '#6B7280',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.2,
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'node[isKeyTarget]',
          style: {
            'border-width': 3,
            'border-color': '#F59E0B',
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'node[significant][!upregulated]',
          style: {
            'background-color': '#22c55e',
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'node[significant][upregulated]',
          style: {
            'background-color': '#ef4444',
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'node[!significant]',
          style: {
            'background-color': '#9ca3af',
          } as cytoscape.CssStyleDeclaration,
        },
        {
          selector: 'edge:selected',
          style: {
            width: 3,
            'line-color': '#F59E0B',
          } as cytoscape.CssStyleDeclaration,
        },
      ],
      layout: {
        name: 'cose-bilkent',
        animate: false,
        nodeRepulsion: () => 10000,
        idealEdgeLength: () => 120,
        gravity: 0.25,
        numIter: 1000,
      } as cytoscape.LayoutOptions,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, hiddenTypes, search]);

  if (!elements) {
    return <EmptyTab message="No BioNet data available" />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap bg-background border border-border rounded-lg p-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search proteins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Edge type filters */}
        {edgeTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted font-medium">Edge types:</span>
            {edgeTypes.map((type) => {
              const hidden = hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                    hidden
                      ? 'border-border bg-surface text-text-muted line-through opacity-50'
                      : 'border-border/60 bg-surface text-text-secondary hover:bg-border/30'
                  }`}
                  style={hidden ? undefined : { borderColor: resolveEdgeColor(type) + '66', color: resolveEdgeColor(type) }}
                >
                  {type}
                </button>
              );
            })}
            {(hiddenTypes.size > 0 || search) && (
              <button
                onClick={clearFilters}
                className="px-2 py-0.5 text-xs text-error hover:bg-error/5 rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cytoscape Container */}
      <div
        ref={containerRef}
        className="bg-background rounded-lg border border-border"
        style={{ height: '600px', width: '100%' }}
      />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-center text-text-secondary">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-base">{message}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function ReportViewerPage() {
  const params = useParams();
  const reportId = params.reportId as string;

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('');

  // Fetch report data on mount
  useEffect(() => {
    if (!reportId) return;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        // Fetch the data.json from the report assets
        const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/assets/data.json`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Report not found');
          throw new Error(`Failed to load report (${res.status})`);
        }
        const json: ReportData = await res.json();

        if (!json.tabs || !Array.isArray(json.tabs) || json.tabs.length === 0) {
          throw new Error('Report contains no visualization tabs');
        }

        setData(json);
        setActiveTab(json.tabs[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [reportId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-text-secondary">Loading report...</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="bg-error/5 border border-error/20 rounded-lg p-6 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-error mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-error mb-2">Error Loading Report</h2>
          <p className="text-sm text-error/80 mb-4">{error}</p>
          <a
            href="/reports"
            className="inline-flex items-center px-4 py-2 bg-surface text-text-primary rounded-lg hover:bg-border transition-colors text-sm"
          >
            Back to Reports
          </a>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!data || !data.tabs?.length) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-lg">This report has no content</p>
          <a
            href="/reports"
            className="inline-flex items-center px-4 py-2 mt-4 bg-surface text-text-primary rounded-lg hover:bg-border transition-colors text-sm"
          >
            Back to Reports
          </a>
        </div>
      </div>
    );
  }

  const activeTabData = activeTab ? (data as Record<string, unknown>)[activeTab] : undefined;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <div className="bg-background border-b border-border px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{data.report.name}</h1>
            <p className="text-xs text-text-muted">
              {data.report.session_name} &middot; {formatDate(data.report.created_at)}
            </p>
          </div>
          <a
            href="/reports"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            &larr; All Reports
          </a>
        </div>
      </div>

      {/* Tab Bar (matches visualization layout Navigation style) */}
      <div className="bg-background border-b border-border sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center py-2">
            <div className="flex items-center gap-1">
              {data.tabs.map((tab) => {
                const Icon = TAB_ICONS[tab.id] || ChartScatter;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary/5 text-primary'
                        : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
        {activeTab === 'volcano' && <VolcanoTab data={activeTabData} />}
        {activeTab === 'qc' && <QCTab data={activeTabData} />}
        {activeTab === 'gsea' && <GSEATab data={activeTabData} />}
        {activeTab === 'compare' && <CompareTab data={activeTabData} />}
        {activeTab === 'bionet' && <BioNetTab data={activeTabData} />}
        {activeTab && !['volcano', 'qc', 'gsea', 'compare', 'bionet'].includes(activeTab) && (
          <EmptyTab message={`Unknown tab: ${activeTab}`} />
        )}
      </div>
    </div>
  );
}
