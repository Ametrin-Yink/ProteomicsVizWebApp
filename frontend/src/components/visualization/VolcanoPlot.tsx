'use client';

import React, { useMemo, useCallback, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { DEResult, VolcanoFilters } from '@/types/api';
import { getVolcanoPointColor } from '@/lib/utils';
import { MousePointer2, Square, Lasso, X } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

// CSS to disable drag layer pointer events in click mode
const CLICK_MODE_CSS = `
  .volcano-plot-click-mode .js-plotly-plot .draglayer {
    pointer-events: none !important;
  }
`;

interface VolcanoPlotProps {
  data: DEResult[];
  filters: VolcanoFilters;
  selectedProteins: Set<string>;
  markedProteins: Set<string>;
  onSelectProteins: (proteins: string[], mode?: 'click' | 'box' | 'lasso') => void;
  onSelectionModeChange?: (mode: 'click' | 'box' | 'lasso') => void;
  onClearSelection?: () => void;
}

type SelectionMode = 'click' | 'box' | 'lasso';

export default function VolcanoPlot({
  data,
  filters,
  selectedProteins,
  markedProteins,
  onSelectProteins,
  onSelectionModeChange,
  onClearSelection,
}: VolcanoPlotProps) {
  const [selectionMode, setSelectionModeState] = useState<SelectionMode>('click');
  const plotRef = useRef<HTMLDivElement>(null);

  // Notify parent when selection mode changes
  const setSelectionMode = useCallback((mode: SelectionMode) => {
    setSelectionModeState(mode);
    onSelectionModeChange?.(mode);
  }, [onSelectionModeChange]);

  // Prepare plot data
  const plotData = useMemo(() => {
    // Calculate -log10(p-value)
    const xValues = data.map((d) => d.log_fc);
    const yValues = data.map((d) => -Math.log10(d.pval || 1e-300));

    // Determine colors based on significance
    const colors = data.map((d) =>
      getVolcanoPointColor(d.log_fc, d.pval, d.adj_pval, filters)
    );

    // Determine sizes based on selection
    const sizes = data.map((d) =>
      selectedProteins.has(d.master_protein_accessions) ? 12 : 6
    );

    // Determine opacities
    const opacities = data.map((d) =>
      selectedProteins.has(d.master_protein_accessions) ? 1.0 : 0.7
    );

    // Determine border colors
    const lineColors = data.map((d) =>
      selectedProteins.has(d.master_protein_accessions) ? '#000000' : 'transparent'
    );

    // Determine line widths
    const lineWidths = data.map((d) =>
      selectedProteins.has(d.master_protein_accessions) ? 2 : 0
    );

    // Create hover text - handle multiple UniProt IDs
    const hoverText = data.map((d) => {
      // Parse gene names for multiple accessions
      const accessions = d.master_protein_accessions.split(/[,;]/).map(s => s.trim()).filter(Boolean);
      const genes = d.gene_name ? d.gene_name.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];
      const geneDisplay = genes.length > 0 ? genes.join(', ') : 'N/A';

      return `<b>${accessions.join(', ')}</b><br>` +
        `Gene: ${geneDisplay}<br>` +
        `Log2 FC: ${(d.log_fc ?? 0).toFixed(3)}<br>` +
        `P-value: ${(d.pval ?? 1).toExponential(2)}<br>` +
        `Adj P-value: ${(d.adj_pval ?? 1).toExponential(2)}`;
    });

    // Use arrays directly (WebGL handles rendering order efficiently)
    return [
      {
        x: xValues,
        y: yValues,
        mode: 'markers' as const,
        type: 'scattergl' as const,
        marker: {
          color: colors,
          size: sizes,
          opacity: opacities,
          line: {
            color: lineColors,
            width: lineWidths,
          },
        },
        text: hoverText,
        hoverinfo: 'text',
        customdata: data.map((d) => d.master_protein_accessions),
        name: 'Proteins',
      },
      // Marker labels trace -- only for marked proteins
      {
        x: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => d.log_fc),
        y: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => -Math.log10(d.pval || 1e-300)),
        mode: 'text' as const,
        type: 'scatter' as const,
        text: data.filter((d) => markedProteins.has(d.master_protein_accessions)).map((d) => d.gene_name || d.master_protein_accessions.split(/[,;]/)[0].trim()),
        textposition: 'top center' as const,
        texttemplate: '%{text}',
        hoverinfo: 'skip',
        showlegend: false,
        marker: {
          size: 0,
          opacity: 0,
        },
        name: 'Markers',
      },
    ];
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
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 60, r: 30, t: 50, b: 60 },
      dragmode: 'select' as const,
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

  // Handle selection events (box/lasso)
  const handleSelected = useCallback(
    (event: { points?: Array<{ customdata: string }> }) => {
      if (event.points && event.points.length > 0) {
        const selected = event.points.map((p) => p.customdata);
        onSelectProteins(selected, selectionMode);
      }
    },
    [onSelectProteins, selectionMode]
  );

  // Handle click events - select single protein (replaces any existing selection)
  const handleClick = useCallback(
    (event: { points?: Array<{ customdata: string }> }) => {
      if (selectionMode === 'click' && event.points && event.points.length > 0) {
        const protein = event.points[0].customdata;
        onSelectProteins([protein], 'click');
      }
    },
    [onSelectProteins, selectionMode]
  );

  // Handle double-click events - select single protein (same as single click)
  const handleDoubleClick = useCallback(
    (event: { points?: Array<{ customdata: string }> }) => {
      if (selectionMode === 'click' && event.points && event.points.length > 0) {
        const protein = event.points[0].customdata;
        onSelectProteins([protein], 'click');
      }
    },
    [onSelectProteins, selectionMode]
  );

  // Get dragmode based on selection mode
  const dragmode = useMemo(() => {
    switch (selectionMode) {
      case 'box':
        return 'select' as const;
      case 'lasso':
        return 'lasso' as const;
      default:
        return false as const; // Disable drag/selection in click mode to allow point clicking
    }
  }, [selectionMode]);

  // Update layout with current dragmode
  const layoutWithDragMode = useMemo(() => ({
    ...layout,
    dragmode,
    xaxis: {
      ...layout.xaxis,
      fixedrange: selectionMode === 'click', // Disable zoom/pan in click mode
    },
    yaxis: {
      ...layout.yaxis,
      fixedrange: selectionMode === 'click', // Disable zoom/pan in click mode
    },
  }), [layout, dragmode, selectionMode]);

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200 p-4">
      {/* Inject CSS for click mode */}
      {selectionMode === 'click' && <style>{CLICK_MODE_CSS}</style>}

      {/* Selection mode buttons */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 mr-2">Selection Mode:</span>
          <button
            data-testid="mode-click"
            onClick={() => setSelectionMode('click')}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              selectionMode === 'click'
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <MousePointer2 className="w-4 h-4" />
            Click
          </button>
          <button
            data-testid="mode-box"
            onClick={() => setSelectionMode('box')}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              selectionMode === 'box'
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Square className="w-4 h-4" />
            Box
          </button>
          <button
            data-testid="mode-lasso"
            onClick={() => setSelectionMode('lasso')}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              selectionMode === 'lasso'
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Lasso className="w-4 h-4" />
            Lasso
          </button>
        </div>

          <button
            data-testid="clear-selection-btn"
            onClick={onClearSelection}
            disabled={selectedProteins.size === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
            Clear Selection
          </button>
      </div>

      {/* Volcano plot */}
      <div
        ref={plotRef}
        data-testid="volcano-plot"
        className={`w-full h-[500px] ${selectionMode === 'click' ? 'volcano-plot-click-mode' : ''}`}
      >
        {data.length > 0 ? (
          <Plot
            data={plotData}
            layout={layoutWithDragMode}
            config={config}
            onSelected={selectionMode !== 'click' ? handleSelected : undefined}
            onClick={selectionMode === 'click' ? handleClick : undefined}
            onDoubleClick={selectionMode === 'click' ? handleDoubleClick : undefined}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No data available for volcano plot
          </div>
        )}
      </div>

      {/* Threshold lines indicator */}
      <div data-testid="threshold-lines" className="mt-2 text-xs text-gray-500 text-center">
        {filters.s0 > 0
          ? `Hyperbolic cutoff: S0 = ${(filters.s0 * filters.foldChange).toFixed(2)} (${(filters.s0 * 100).toFixed(0)}% of log₂FC threshold ±${filters.foldChange}), P-value = ${filters.pValue}`
          : `Threshold lines: Fold Change = ±${filters.foldChange}, P-value = ${filters.pValue}`}
      </div>
    </div>
  );
}
