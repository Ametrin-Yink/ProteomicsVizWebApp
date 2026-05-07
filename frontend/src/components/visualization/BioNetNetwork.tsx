'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { BioNetNode, BioNetEdge } from '@/types/api';

cytoscape.use(coseBilkent);

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

  const isSignificant = useCallback(
    (pvalue: number, logFC: number) =>
      pvalue < pvalueCutoff && Math.abs(logFC) > logfcCutoff,
    [pvalueCutoff, logfcCutoff]
  );

  // Initialize Cytoscape
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
              if (!sig) return '#9ca3af'; // grey for non-sig
              return ele.data('upregulated') ? '#ef4444' : '#3b82f6'; // red up, blue down
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
        // Edge style
        {
          selector: 'edge',
          style: {
            width: (ele: cytoscape.EdgeSingular) =>
              1 + Math.min(ele.data('evidenceCount'), 10) * 0.5,
            'line-color': (ele: cytoscape.EdgeSingular) => {
              const it = ele.data('interaction') as string;
              if (it.includes('DecreaseAmount') && it.includes('IncreaseAmount'))
                return '#a855f7'; // purple for bidirectional
              if (it.includes('DecreaseAmount')) return '#ef4444';
              return '#22c55e';
            },
            'target-arrow-color': (ele: cytoscape.EdgeSingular) => {
              const it = ele.data('interaction') as string;
              if (it.includes('DecreaseAmount') && it.includes('IncreaseAmount'))
                return '#a855f7';
              if (it.includes('DecreaseAmount')) return '#ef4444';
              return '#22c55e';
            },
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

  // Change layout
  const applyLayout = useCallback((name: LayoutName) => {
    if (!cyRef.current) return;
    setSelectedLayout(name);
    const opts = { name, animate: true };
    cyRef.current.layout(opts as unknown as cytoscape.LayoutOptions).run();
  }, []);

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
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary">
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
            <span className="w-2 h-2 bg-green-500 inline-block" /> IncreaseAmount
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-red-500 inline-block" /> DecreaseAmount
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-purple-500 inline-block" /> Both
          </span>
        </div>
      )}

      {/* Cytoscape canvas */}
      <div
        ref={containerRef}
        className="w-full rounded-lg border border-border bg-white"
        style={{ minHeight: 500 }}
      />

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
