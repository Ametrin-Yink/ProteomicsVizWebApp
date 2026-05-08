/**
 * BioNet graph export builder.
 *
 * Pure function that builds the Cytoscape-compatible elements array and
 * derived edge-type list from raw BioNet node/edge data. Matches the
 * structure produced by the BioNetNetwork component so exported HTML
 * renders identically.
 */

import type { BioNetNode, BioNetEdge } from '@/types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Cytoscape-compatible element definitions mirroring what the
 * BioNetNetwork component builds in its useEffect.
 *
 * Nodes carry:
 *   id, label (hgncName || id), logFC, pvalue, hgncName,
 *   significant (boolean), upregulated (boolean|undefined),
 *   isKeyTarget (boolean)
 *
 * Edges carry:
 *   id, source, target, interaction, evidenceCount, paperCount,
 *   evidenceLink, sourceCounts
 */
export interface BioNetCytoscapeElements {
  nodes: cytoscape.ElementDefinition[];
  edges: cytoscape.ElementDefinition[];
}

export interface BioNetExport {
  /** Pre-built Cytoscape-compatible elements (nodes + edges). */
  cytoscapeElements: BioNetCytoscapeElements;
  /** Unique, sorted interaction types found across all edges. */
  edgeTypes: string[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a BioNet graph export from raw subnetwork data.
 *
 * @param nodes     Array of BioNet nodes (UniProt proteins with logFC/pvalue).
 * @param edges     Array of BioNet edges (INDRA interactions between
 *                  protein nodes).
 * @param keyTargets  Gene names or UniProt IDs to mark as key targets.
 * @param pvalueCutoff  Adjusted p-value threshold for significance.
 * @param logfcCutoff   |log2FC| threshold for significance.
 * @param runComparison  Optional comparison key for the report context.
 */
export function buildBioNetExport(
  nodes: BioNetNode[],
  edges: BioNetEdge[],
  keyTargets: string[],
  pvalueCutoff: number,
  logfcCutoff: number,
  _runComparison?: string,
): BioNetExport {
  const keyTargetSet = new Set(keyTargets);

  const nodeElements: cytoscape.ElementDefinition[] = nodes.map((n) => {
    const sig = n.pvalue < pvalueCutoff && Math.abs(n.logFC) > logfcCutoff;
    return {
      data: {
        id: n.id,
        label: n.hgncName || n.id,
        logFC: n.logFC,
        pvalue: n.pvalue,
        hgncName: n.hgncName,
        significant: sig,
        upregulated: sig ? n.logFC > 0 : undefined,
        isKeyTarget:
          keyTargetSet.has(n.hgncName) || keyTargetSet.has(n.id),
      },
    };
  });

  const edgeElements: cytoscape.ElementDefinition[] = edges.map((e, i) => ({
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
  }));

  // Derive unique edge types — same logic as BioNetNetwork's useMemo
  const typeSet = new Set<string>();
  edges.forEach((e) => {
    e.interaction.split(',').forEach((t) => typeSet.add(t.trim()));
  });
  const edgeTypes = Array.from(typeSet).sort();

  return {
    cytoscapeElements: { nodes: nodeElements, edges: edgeElements },
    edgeTypes,
  };
}
