'use client';

import React, { useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { DEResult, VolcanoFilters } from '@/types/api';
import { getVolcanoPointColor, parseDelimited } from '@/lib/utils';
import { X } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface VolcanoPlotProps {
  data: DEResult[];
  filters: VolcanoFilters;
  selectedProteins: Set<string>;
  markedProteins: Set<string>;
  onSelectProteins: (proteins: string[]) => void;
  onClearSelection?: () => void;
}

export default function VolcanoPlot({
  data,
  filters,
  selectedProteins,
  markedProteins,
  onSelectProteins,
  onClearSelection,
}: VolcanoPlotProps) {
  const plotRef = useRef<HTMLDivElement>(null);

  // Prepare plot data
  const plotData = useMemo(() => {
    // Single pass: build all point properties at once
    const points = data.map((d) => {
      const isSelected = selectedProteins.has(d.master_protein_accessions);
      return {
        x: d.log_fc,
        y: -Math.log10(d.pval || 1e-300),
        color: getVolcanoPointColor(d.log_fc, d.pval, d.adj_pval, filters),
        size: isSelected ? 12 : 6,
        opacity: isSelected ? 1.0 : 0.7,
        lineColor: isSelected ? '#000000' : 'transparent',
        lineWidth: isSelected ? 2 : 0,
        customdata: d.master_protein_accessions,
      };
    });

    // Create hover text - handle multiple UniProt IDs
    const hoverText = data.map((d) => {
      const accessions = parseDelimited(d.master_protein_accessions);
      const genes = d.gene_name ? parseDelimited(d.gene_name) : [];
      const geneDisplay = genes.length > 0 ? genes.join(', ') : 'N/A';

      return `<b>${accessions.join(', ')}</b><br>` +
        `Gene: ${geneDisplay}<br>` +
        `Log2 FC: ${(d.log_fc ?? 0).toFixed(3)}<br>` +
        `P-value: ${(d.pval ?? 1).toExponential(2)}<br>` +
        `Adj P-value: ${(d.adj_pval ?? 1).toExponential(2)}`;
    });

    // Use Canvas scatter (not WebGL) for reliable click/hover hit detection
    const mainTrace = {
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      mode: 'markers' as const,
      type: 'scatter' as const,
      marker: {
        color: points.map((p) => p.color),
        size: points.map((p) => p.size),
        opacity: points.map((p) => p.opacity),
        line: {
          color: points.map((p) => p.lineColor),
          width: points.map((p) => p.lineWidth),
        },
      },
      text: hoverText,
      hoverinfo: 'text',
      customdata: points.map((p) => p.customdata),
      name: 'Proteins',
    };

    // Marker labels trace -- only for marked proteins
    const marked = data.filter((d) => markedProteins.has(d.master_protein_accessions));

    return marked.length > 0
      ? [mainTrace, {
          x: marked.map((d) => d.log_fc),
          y: marked.map((d) => -Math.log10(d.pval || 1e-300)),
          mode: 'text' as const,
          type: 'scatter' as const,
          text: marked.map((d) => d.gene_name || parseDelimited(d.master_protein_accessions)[0]),
          textposition: 'top center' as const,
          texttemplate: '%{text}',
          hoverinfo: 'skip',
          showlegend: false,
          marker: { size: 0, opacity: 0 },
          name: 'Markers',
        }]
      : [mainTrace];
  }, [data, filters, selectedProteins, markedProteins]);

  // Calculate threshold lines
  const thresholdShapes = useMemo(() => {
    const shapes: Array<
      | { type: 'line'; x0: number; x1: number; y0: number; y1: number; line: { color: string; width: number; dash: 'dash' } }
      | { type: 'path'; path: string; line: { color: string; width: number; dash: 'dash' } }
    > = [];

    const maxY = 10;
    const maxX = Math.max(...data.map((d) => Math.abs(d.log_fc))) * 1.1;

    const actualS0 = filters.s0 * filters.foldChange;

    if (actualS0 > 0) {
      // Hyperbolic S0-factor curves: y = y0 + c / (|x| - actualS0)
      // where c = y0 * (foldChange - actualS0). The curve asymptotes to y0
      // (the p-value line), never crossing it, with vertical asymptote at |x| = actualS0.
      const pLog10Threshold = -Math.log10(filters.pValue);
      const c = pLog10Threshold * (filters.foldChange - actualS0);

      // Generate path for right curve (positive logFC)
      let rightPath = '';
      const step = 0.02;
      for (let x = actualS0 + step; x <= maxX; x += step) {
        const y = pLog10Threshold + c / (x - actualS0);
        if (y <= maxY) {
          rightPath += (rightPath === '' ? `M ${x} ${y}` : ` L ${x} ${y}`);
        }
      }
      if (rightPath) shapes.push({ type: 'path', path: rightPath, line: { color: '#9CA3AF', width: 1, dash: 'dash' } });

      // Generate path for left curve (negative logFC)
      let leftPath = '';
      for (let x = -maxX; x < -actualS0 - step; x += step) {
        const y = pLog10Threshold + c / (-x - actualS0);
        if (y <= maxY) {
          leftPath += (leftPath === '' ? `M ${x} ${y}` : ` L ${x} ${y}`);
        }
      }
      if (leftPath) shapes.push({ type: 'path', path: leftPath, line: { color: '#9CA3AF', width: 1, dash: 'dash' } });
    } else {
      // Standard rectangular cutoff: vertical + horizontal lines
      // Vertical lines at +/- fold change threshold
      shapes.push({
        type: 'line',
        x0: filters.foldChange,
        x1: filters.foldChange,
        y0: 0,
        y1: maxY,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      });
      shapes.push({
        type: 'line',
        x0: -filters.foldChange,
        x1: -filters.foldChange,
        y0: 0,
        y1: maxY,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      });

      // Horizontal line at p-value threshold
      const yThreshold = -Math.log10(filters.pValue);
      shapes.push({
        type: 'line',
        x0: -maxX,
        x1: maxX,
        y0: yThreshold,
        y1: yThreshold,
        line: { color: '#9CA3AF', width: 1, dash: 'dash' },
      });
    }

    return shapes;
  }, [filters, data]);

  // Layout configuration
  const layout = useMemo(
    () => ({
      title: {
        text: 'Volcano Plot',
        font: { size: 18, color: '#111827' },
      },
      xaxis: {
        title: { text: 'log₂(Treatment/Control)', font: { size: 14 } },
        zeroline: true,
        zerolinecolor: '#D1D5DB',
        zerolinewidth: 1,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        title: { text: '-log₁₀(p-value)', font: { size: 14 } },
        range: [0, 10],
        zeroline: true,
        zerolinecolor: '#D1D5DB',
        zerolinewidth: 1,
        gridcolor: '#E5E7EB',
      },
      shapes: thresholdShapes,
      showlegend: false,
      hovermode: 'closest' as const,
      clickmode: 'event' as const,
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: 30, t: 50, b: 60 },
    }),
    [thresholdShapes]
  );

  // Config for plot
  const config = useMemo(
    () => ({
      displayModeBar: true,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      displaylogo: false,
      responsive: true,
    }),
    []
  );

  // Handle click/double-click events - select single protein
  const handlePointClick = useCallback(
    (event?: { points?: Array<{ customdata: string }> }) => {
      console.log('[VolcanoPlot] click event fired:', event);
      if (event?.points && event.points.length > 0) {
        console.log('[VolcanoPlot] selected protein:', event.points[0].customdata);
        onSelectProteins([event.points[0].customdata]);
      } else {
        console.log('[VolcanoPlot] no points in click event');
      }
    },
    [onSelectProteins]
  );

  // Layout with click-mode settings (no drag, no zoom/pan)
  const layoutWithDragMode = useMemo(() => ({
    ...layout,
    dragmode: false as const,
    xaxis: {
      ...layout.xaxis,
      fixedrange: true,
    },
    yaxis: {
      ...layout.yaxis,
      fixedrange: true,
    },
  }), [layout]);

  return (
    <div className="w-full bg-background rounded-lg border border-border p-4">
      {/* Legend bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#E73564' }}></span>
            <span>Upregulated (Treatment &gt; Control)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#00ADEF' }}></span>
            <span>Downregulated (Control &gt; Treatment)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#6B7280' }}></span>
            <span>Not Significant</span>
          </div>
        </div>

        <button
          data-testid="clear-selection-btn"
          onClick={onClearSelection}
          disabled={selectedProteins.size === 0}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-error bg-background border-error/30 rounded-md hover:bg-error/5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-4 h-4" />
          Clear Selection
        </button>
      </div>

      {/* Volcano plot */}
      <div
        ref={plotRef}
        data-testid="volcano-plot"
        className="volcano-plot-click-mode w-full h-[400px] sm:h-[500px] lg:h-[550px]"
      >
        {data.length > 0 ? (
          <Plot
            data={plotData}
            layout={layoutWithDragMode}
            config={config}
            onClick={handlePointClick}
            onDoubleClick={handlePointClick}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-text-muted">
            No data available for volcano plot
          </div>
        )}
      </div>

      {/* Threshold lines indicator */}
      <div data-testid="threshold-lines" className="mt-2 text-xs text-text-muted text-center">
        {filters.s0 > 0
          ? `Hyperbolic cutoff: S0 = ${(filters.s0 * filters.foldChange).toFixed(2)} (${(filters.s0 * 100).toFixed(0)}% of log₂FC threshold ±${filters.foldChange}), P-value = ${filters.pValue}`
          : `Threshold lines: Fold Change = ±${filters.foldChange}, P-value = ${filters.pValue}`}
      </div>
    </div>
  );
}
