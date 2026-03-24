'use client';

import React, { useMemo, useCallback, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { DEResult, VolcanoFilters } from '@/types/api';
import { getVolcanoPointColor } from '@/lib/utils';
import { MousePointer2, Square, Lasso, RotateCcw } from 'lucide-react';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface VolcanoPlotProps {
  data: DEResult[];
  filters: VolcanoFilters;
  selectedProteins: Set<string>;
  onSelectProteins: (proteins: string[], mode?: 'click' | 'box' | 'lasso') => void;
  onSelectionModeChange?: (mode: 'click' | 'box' | 'lasso') => void;
}

type SelectionMode = 'click' | 'box' | 'lasso';

export default function VolcanoPlot({
  data,
  filters,
  selectedProteins,
  onSelectProteins,
  onSelectionModeChange,
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

    // Sort by selection status (selected on top)
    const indices = data.map((_, i) => i);
    indices.sort((a, b) => {
      const aSelected = selectedProteins.has(data[a].master_protein_accessions);
      const bSelected = selectedProteins.has(data[b].master_protein_accessions);
      return aSelected === bSelected ? 0 : aSelected ? 1 : -1;
    });

    const sortedX = indices.map((i) => xValues[i]);
    const sortedY = indices.map((i) => yValues[i]);
    const sortedColors = indices.map((i) => colors[i]);
    const sortedSizes = indices.map((i) => sizes[i]);
    const sortedOpacities = indices.map((i) => opacities[i]);
    const sortedLineColors = indices.map((i) => lineColors[i]);
    const sortedLineWidths = indices.map((i) => lineWidths[i]);
    const sortedHoverText = indices.map((i) => hoverText[i]);
    const sortedProteins = indices.map((i) => data[i].master_protein_accessions);

    return [
      {
        x: sortedX,
        y: sortedY,
        mode: 'markers' as const,
        type: 'scatter' as const,
        marker: {
          color: sortedColors,
          size: sortedSizes,
          opacity: sortedOpacities,
          line: {
            color: sortedLineColors,
            width: sortedLineWidths,
          },
        },
        text: sortedHoverText,
        hoverinfo: 'text',
        customdata: sortedProteins,
        name: 'Proteins',
      },
    ];
  }, [data, filters, selectedProteins]);

  // Calculate threshold lines
  const thresholdShapes = useMemo(() => {
    const shapes: Array<{
      type: 'line';
      x0: number;
      x1: number;
      y0: number;
      y1: number;
      line: { color: string; width: number; dash: 'dash' };
    }> = [];

    const maxY = Math.max(...data.map((d) => -Math.log10(d.pval || 1e-300))) * 1.1;
    const maxX = Math.max(...data.map((d) => Math.abs(d.log_fc))) * 1.1;

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

  // Handle click events - always clear previous selection
  const handleClick = useCallback(
    (event: { points?: Array<{ customdata: string }> }) => {
      if (event.points && event.points.length > 0) {
        const protein = event.points[0].customdata;
        onSelectProteins([protein], 'click');
      }
    },
    [onSelectProteins]
  );

  // Handle reset zoom - use Plotly.relayout to reset axes
  const handleResetZoom = useCallback(() => {
    if (plotRef.current && (window as unknown as { Plotly?: { relayout: (el: HTMLElement, update: Record<string, unknown>) => void } }).Plotly) {
      const Plotly = (window as unknown as { Plotly: { relayout: (el: HTMLElement, update: Record<string, unknown>) => void } }).Plotly;
      Plotly.relayout(plotRef.current, {
        'xaxis.autorange': true,
        'yaxis.autorange': true,
      });
    }
  }, []);

  // Get dragmode based on selection mode
  const dragmode = useMemo(() => {
    switch (selectionMode) {
      case 'box':
        return 'select' as const;
      case 'lasso':
        return 'lasso' as const;
      default:
        return 'pan' as const; // Use 'pan' in click mode to allow click interactions
    }
  }, [selectionMode]);

  // Update layout with current dragmode
  const layoutWithDragMode = useMemo(() => ({
    ...layout,
    dragmode,
    // Enable click mode events
    clickmode: selectionMode === 'click' ? 'event+select' : undefined,
  }), [layout, dragmode, selectionMode]);

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200 p-4">
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
          data-testid="reset-zoom-btn"
          onClick={handleResetZoom}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Zoom
        </button>
      </div>

      {/* Volcano plot */}
      <div ref={plotRef} data-testid="volcano-plot" className="w-full h-[500px]">
        {data.length > 0 ? (
          <Plot
            data={plotData}
            layout={layoutWithDragMode}
            config={config}
            onSelected={selectionMode !== 'click' ? handleSelected : undefined}
            onClick={handleClick}
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
        Threshold lines: Fold Change = ±{filters.foldChange}, P-value = {filters.pValue}
      </div>
    </div>
  );
}
