'use client';

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { BioNetNode, BioNetEdge } from '@/types/api';

cytoscape.use(coseBilkent);

// Color map for INDRA interaction types. Compound edges (e.g. "Activation, Complex")
// match the first type found. Unrecognized types default to grey.
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

function edgeColor(interaction: string): string {
  for (const [type, color] of Object.entries(EDGE_COLORS)) {
    if (interaction.includes(type)) return color;
  }
  return '#9ca3af';
}

type LayoutName = 'cose-bilkent' | 'concentric' | 'grid' | 'circle';

interface BioNetNetworkProps {
  nodes: BioNetNode[];
  edges: BioNetEdge[];
  pvalueCutoff: number;
  logfcCutoff: number;
  keyTargets: string[];
}

export default function BioNetNetwork({
  nodes,
  edges,
  pvalueCutoff,
  logfcCutoff,
  keyTargets,
}: BioNetNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedLayout, setSelectedLayout] = useState<LayoutName>('cose-bilkent');
  const [showLegend, setShowLegend] = useState(true);
  const [search, setSearch] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showEdgeFilter, setShowEdgeFilter] = useState(false);

  const isSignificant = useCallback(
    (pvalue: number, logFC: number) =>
      pvalue < pvalueCutoff && Math.abs(logFC) > logfcCutoff,
    [pvalueCutoff, logfcCutoff]
  );

  // Derive edge types actually present in the data (for filter checkboxes)
  const edgeTypes = useMemo(() => {
    const types = new Set<string>();
    edges.forEach((e) => {
      e.interaction.split(',').forEach((t) => types.add(t.trim()));
    });
    return Array.from(types).sort();
  }, [edges]);

  // Initialize / rebuild Cytoscape when data or hiddenTypes change
  useEffect(() => {
    if (!containerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [
      ...nodes.map((n) => {
        const sig = isSignificant(n.pvalue, n.logFC);
        return {
          data: {
            id: n.id,
            label: n.hgncName || n.id,
            logFC: n.logFC,
            pvalue: n.pvalue,
            hgncName: n.hgncName,
            significant: sig,
            upregulated: sig && n.logFC > 0,
            isKeyTarget: keyTargets.includes(n.hgncName) || keyTargets.includes(n.id),
          },
        };
      }),
      ...edges.map((e, i) => ({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          interaction: e.interaction,
          evidenceCount: e.evidenceCount,
          paperCount: e.paperCount,
          evidenceLink: e.evidenceLink,
          sourceCounts: e.sourceCounts,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // Node style
        {
          selector: 'node',
          style: {
            'background-color': (ele: cytoscape.NodeSingular) => {
              const sig = ele.data('significant');
              if (!sig) return '#9ca3af';
              return ele.data('upregulated') ? '#ef4444' : '#3b82f6';
            },
            width: (ele: cytoscape.NodeSingular) =>
              20 + Math.min(Math.abs(ele.data('logFC')) * 8, 40),
            height: (ele: cytoscape.NodeSingular) =>
              20 + Math.min(Math.abs(ele.data('logFC')) * 8, 40),
            label: 'data(label)',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            color: '#374151',
            'border-width': 0,
          },
        },
        // Key target diamond shape
        {
          selector: 'node[isKeyTarget]',
          style: {
            shape: 'diamond',
            'border-width': 2,
            'border-color': '#f59e0b',
          },
        },
        // Edge style — color by primary interaction type
        {
          selector: 'edge',
          style: {
            width: (ele: cytoscape.EdgeSingular) =>
              1 + Math.min(ele.data('evidenceCount'), 10) * 0.5,
            'line-color': (ele: cytoscape.EdgeSingular) =>
              edgeColor(ele.data('interaction') as string),
            'target-arrow-color': (ele: cytoscape.EdgeSingular) =>
              edgeColor(ele.data('interaction') as string),
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(interaction)',
            'font-size': '8px',
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
            color: '#6b7280',
          },
        },
        // Hover highlight
        {
          selector: 'node:active',
          style: { 'border-width': 2, 'border-color': '#6366f1' },
        },
        // Search-found node glow
        {
          selector: 'node.found',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
            'background-blacken': -0.3,
          },
        },
      ],
      layout: { name: 'cose-bilkent' },
      wheelSensitivity: 0.3,
    });

    // Click node -> highlight neighbors
    cy.on('tap', 'node', (evt: EventObject) => {
      const node = evt.target;
      cy.elements().removeClass('highlighted');
      node.addClass('highlighted');
      node.neighborhood().addClass('highlighted');
    });

    // Click edge -> open evidence link
    cy.on('tap', 'edge', (evt: EventObject) => {
      const edge = evt.target;
      const link = edge.data('evidenceLink');
      if (link) {
        window.open(link, '_blank');
      }
    });

    // Tap background -> clear highlight
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) {
        cy.elements().removeClass('highlighted');
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [nodes, edges, isSignificant, keyTargets]);

  // Toggle edge visibility without rebuilding the graph
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().forEach((edge) => {
      const it = edge.data('interaction') as string;
      const types = it.split(',').map((s) => s.trim());
      const hidden = types.some((t) => hiddenTypes.has(t));
      edge.style('display', hidden ? 'none' : 'element');
    });
  }, [hiddenTypes]);

  // Toggle edge type visibility without rebuilding the graph
  const toggleEdgeType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  // Change layout
  const applyLayout = useCallback((name: LayoutName) => {
    if (!cyRef.current) return;
    setSelectedLayout(name);
    const opts = { name, animate: true };
    cyRef.current.layout(opts as unknown as cytoscape.LayoutOptions).run();
  }, []);

  // Search for a node and center on it
  const doSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!cyRef.current || !search.trim()) return;
    const cy = cyRef.current;
    const q = search.trim().toLowerCase();
    cy.elements().removeClass('found');

    const match = cy.nodes().filter((n) =>
      n.data('id').toLowerCase() === q ||
      n.data('hgncName')?.toLowerCase() === q ||
      n.data('label')?.toLowerCase() === q ||
      n.data('hgncName')?.toLowerCase().includes(q) ||
      n.data('id').toLowerCase().includes(q)
    ).first();

    if (match.length > 0) {
      match.addClass('found');
      cy.animate({
        center: { eles: match },
        zoom: Math.max(cy.zoom(), 1.2),
        duration: 500,
      });
    }
  }, [search]);

  // Export PNG
  const exportPNG = useCallback(() => {
    if (!cyRef.current) return;
    const b64 = cyRef.current.png({ full: true, bg: '#ffffff' });
    const link = document.createElement('a');
    link.download = 'bionet-network.png';
    link.href = b64;
    link.click();
  }, []);

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* Search */}
        <form onSubmit={doSearch} className="flex items-center gap-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find protein..."
            className="w-32 px-2 py-1 text-xs border border-border rounded bg-background text-text-primary"
          />
          <button
            type="submit"
            className="px-2 py-1 text-xs bg-primary text-white rounded hover:opacity-90"
          >
            Find
          </button>
        </form>

        <div className="w-px h-5 bg-border" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-text-muted mr-1">Layout:</span>
          {(['cose-bilkent', 'concentric', 'grid', 'circle'] as LayoutName[]).map(
            (name) => (
              <button
                key={name}
                onClick={() => applyLayout(name)}
                className={`px-2 py-1 text-xs rounded ${
                  selectedLayout === name
                    ? 'bg-primary text-white'
                    : 'bg-background border border-border text-text-secondary hover:bg-surface'
                }`}
              >
                {name}
              </button>
            )
          )}
        </div>

        <div className="w-px h-5 bg-border" />

        <button
          onClick={exportPNG}
          className="px-2 py-1 text-xs rounded bg-background border border-border text-text-secondary hover:bg-surface"
        >
          Export PNG
        </button>

        <button
          onClick={() => setShowLegend(!showLegend)}
          className={`px-2 py-1 text-xs rounded ${
            showLegend ? 'bg-primary text-white' : 'bg-background border border-border text-text-secondary'
          }`}
        >
          Legend
        </button>

        <button
          onClick={() => setShowEdgeFilter(!showEdgeFilter)}
          className={`px-2 py-1 text-xs rounded ${
            showEdgeFilter ? 'bg-primary text-white' : 'bg-background border border-border text-text-secondary'
          }`}
        >
          Edge filter
        </button>
      </div>

      {/* Edge type filter */}
      {showEdgeFilter && edgeTypes.length > 0 && (
        <div className="flex items-center gap-3 mb-3 p-2 bg-surface rounded border border-border flex-wrap">
          <span className="text-xs text-text-muted">Show:</span>
          {edgeTypes.map((type) => {
            const color = EDGE_COLORS[type] || '#9ca3af';
            return (
              <label
                key={type}
                className="flex items-center gap-1 text-xs text-text-primary cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!hiddenTypes.has(type)}
                  onChange={() => toggleEdgeType(type)}
                  className="rounded"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: color }}
                />
                {type}
              </label>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Upregulated
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Downregulated
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Not significant
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#22c55e] inline-block" /> Activation
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#ef4444] inline-block" /> Inhibition
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#8b5cf6] inline-block" /> Complex
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#f97316] inline-block" /> IncreaseAmount
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#3b82f6] inline-block" /> DecreaseAmount
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-[#eab308] inline-block" /> Phosphorylation
          </span>
        </div>
      )}

      {/* Cytoscape canvas */}
      <div
        ref={containerRef}
        role="img"
        aria-label={`Biological network graph showing ${nodes.length} nodes and ${edges.length} edges`}
        className="w-full rounded-lg border border-border bg-white"
        style={{ minHeight: 500 }}
      />

      {/* Accessible data table toggle */}
      <details className="mt-2">
        <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary select-none focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 rounded px-1">
          View network data as table
        </summary>
        <div className="mt-2 overflow-x-auto border border-border rounded-lg" role="region" aria-label="Network node and edge data">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Biological network nodes and edges data</caption>
            <thead>
              <tr className="bg-surface border-b border-border">
                <th scope="col" className="px-3 py-2 font-medium text-text-primary">Type</th>
                <th scope="col" className="px-3 py-2 font-medium text-text-primary">ID</th>
                <th scope="col" className="px-3 py-2 font-medium text-text-primary">HGNC Name</th>
                <th scope="col" className="px-3 py-2 font-medium text-text-primary">log2FC</th>
                <th scope="col" className="px-3 py-2 font-medium text-text-primary">Adj. p-value</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id} className="border-b border-border-subtle hover:bg-surface/50">
                  <td className="px-3 py-1.5 text-text-muted">node</td>
                  <td className="px-3 py-1.5 text-text-primary font-mono">{n.id}</td>
                  <td className="px-3 py-1.5 text-text-primary">{n.hgncName}</td>
                  <td className="px-3 py-1.5 text-text-primary">{n.logFC.toFixed(3)}</td>
                  <td className="px-3 py-1.5 text-text-primary">{n.pvalue.toExponential(2)}</td>
                </tr>
              ))}
              {edges.map((e, i) => (
                <tr key={`e${i}`} className="border-b border-border-subtle hover:bg-surface/50">
                  <td className="px-3 py-1.5 text-text-muted">edge</td>
                  <td className="px-3 py-1.5 text-text-primary font-mono">{e.source} -&gt; {e.target}</td>
                  <td className="px-3 py-1.5 text-text-primary">{e.interaction}</td>
                  <td className="px-3 py-1.5 text-text-primary">{e.evidenceCount}</td>
                  <td className="px-3 py-1.5 text-text-primary">{e.paperCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Node detail tooltip (shown on click) */}
      <NodeTooltip cyRef={cyRef} />
    </div>
  );
}

/** Shows a tooltip panel when a node is selected. */
function NodeTooltip({ cyRef }: { cyRef: React.RefObject<Core | null> }) {
  const [nodeData, setNodeData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handler = (evt: EventObject) => {
      const node = evt.target;
      if (node.isNode()) {
        setNodeData({
          id: node.data('id'),
          hgncName: node.data('hgncName'),
          logFC: node.data('logFC'),
          pvalue: node.data('pvalue'),
        });
      }
    };

    cy.on('tap', 'node', handler);
    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) setNodeData(null);
    });

    return () => {
      cy.removeListener('tap', 'node', handler);
    };
  }, [cyRef]);

  if (!nodeData) return null;

  return (
    <div className="absolute top-2 right-2 bg-background border border-border rounded-lg p-3 shadow-lg text-xs z-10 max-w-[200px]">
      <p className="font-semibold text-text-primary mb-1">
        {String(nodeData.hgncName || nodeData.id)}
      </p>
      <p className="text-text-secondary">
        UniProt: {String(nodeData.id)}
      </p>
      <p className="text-text-secondary">
        log2FC: {Number(nodeData.logFC).toFixed(3)}
      </p>
      <p className="text-text-secondary">
        Adj. p-value: {Number(nodeData.pvalue).toExponential(2)}
      </p>
    </div>
  );
}
