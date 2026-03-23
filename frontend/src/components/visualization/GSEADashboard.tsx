'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { GSEAData, GSEAResult } from '@/types/api';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface GSEADashboardProps {
  data: GSEAData;
  selectedPathway: GSEAResult | null;
  onSelectPathway: (pathway: GSEAResult) => void;
}

export default function GSEADashboard({
  data,
  selectedPathway,
  onSelectPathway,
}: GSEADashboardProps) {
  // Defensive: ensure data and data.results exist and are valid
  const hasValidData = data &&
    typeof data === 'object' &&
    'results' in data &&
    Array.isArray(data.results) &&
    data.results.length > 0;

  // Top enriched pathways bar chart
  const topPathwaysPlot = useMemo(() => {
    // Defensive: ensure data.results exists and is array
    if (!hasValidData) {
      return { traces: [], layout: {}, data: [] };
    }

    // Get top 5 positive and top 5 negative NES
    const sorted = [...data.results].sort((a, b) => b.nes - a.nes);
    const topPositive = sorted.slice(0, 5);
    const topNegative = sorted.slice(-5).reverse();

    const selectedPathways = [...topPositive, ...topNegative];

    const trace = {
      y: selectedPathways.map((p) => p.name.substring(0, 50) + (p.name.length > 50 ? '...' : '')),
      x: selectedPathways.map((p) => p.nes),
      type: 'bar' as const,
      orientation: 'h' as const,
      marker: {
        color: selectedPathways.map((p) => (p.nes > 0 ? '#E73564' : '#00ADEF')),
      },
      hovertemplate: '<b>%{y}</b><br>NES: %{x:.3f}<br>P-value: %{customdata:.2e}<extra></extra>',
      customdata: selectedPathways.map((p) => p.pval),
    };

    const layout = {
      title: { text: 'Top Enriched Pathways', font: { size: 14, color: '#111827' } },
      xaxis: {
        title: { text: 'Normalized Enrichment Score (NES)', font: { size: 12 } },
        zeroline: true,
        zerolinecolor: '#000',
        zerolinewidth: 1,
        gridcolor: '#E5E7EB',
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 10 },
      },
      plot_bgcolor: '#FFFFFF',
      paper_bgcolor: '#FFFFFF',
      margin: { l: 200, r: 30, t: 50, b: 50 },
      showlegend: false,
    };

    return { traces: [trace], layout, data: selectedPathways };
  }, [data.results]);

  const config = {
    displayModeBar: false,
    displaylogo: false,
    responsive: true,
  };

  // Handle bar click
  const handleClick = (event: { points?: Array<{ y: string }> }) => {
    if (event.points && event.points.length > 0) {
      const pathwayName = event.points[0].y;
      const pathway = data.results.find((p) =>
        p.name.substring(0, 50) + (p.name.length > 50 ? '...' : '') === pathwayName
      );
      if (pathway) {
        onSelectPathway(pathway);
      }
    }
  };

  return (
    <div data-testid="gsea-overview" className="space-y-6">
      {/* Overview Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Total Significant Pathways</div>
          <div data-testid="significant-pathways" className="text-2xl font-bold text-gray-900">
            {data.significant_pathways}
          </div>
          <div className="text-xs text-gray-400">Adj P-value ≤ 0.05</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Overrepresented</div>
          <div data-testid="overrepresented-count" className="text-2xl font-bold text-pink-600">
            {data.overrepresented}
          </div>
          <div className="text-xs text-gray-400">NES &gt; 0</div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Underrepresented</div>
          <div data-testid="underrepresented-count" className="text-2xl font-bold text-blue-600">
            {data.underrepresented}
          </div>
          <div className="text-xs text-gray-400">NES &lt; 0</div>
        </div>
      </div>

      {/* Top Pathways Bar Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-[400px]">
          <Plot
            data={topPathwaysPlot.traces}
            layout={topPathwaysPlot.layout}
            config={config}
            onClick={handleClick}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
          />
        </div>
        <p className="text-xs text-gray-500 text-center mt-2">
          Click on a bar to view pathway details
        </p>
      </div>

      {/* Pathway Details Panel */}
      {selectedPathway && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Pathway Details
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Pathway Name</span>
                <span className="text-sm font-medium text-gray-900 text-right max-w-xs">
                  {selectedPathway.name}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Term ID</span>
                <span className="text-sm font-medium text-gray-900">
                  {selectedPathway.term}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">NES</span>
                <span
                  className={`text-sm font-medium ${
                    selectedPathway.nes > 0 ? 'text-pink-600' : 'text-blue-600'
                  }`}
                >
                  {selectedPathway.nes.toFixed(3)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">P-value</span>
                <span className="text-sm font-medium text-gray-900">
                  {selectedPathway.pval.toExponential(2)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Adj P-value (FDR)</span>
                <span className="text-sm font-medium text-gray-900">
                  {selectedPathway.fdr.toExponential(2)}
                </span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-500">Gene Count</span>
                <span className="text-sm font-medium text-gray-900">
                  {selectedPathway.matched_genes}
                </span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">
                Leading Edge Genes ({selectedPathway.lead_genes.length})
              </h4>
              <div className="bg-gray-50 rounded-lg p-3 max-h-[200px] overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  {selectedPathway.lead_genes.slice(0, 20).map((gene) => (
                    <span
                      key={gene}
                      className="inline-flex px-2 py-1 text-xs font-medium bg-white border border-gray-200 rounded-md text-gray-700"
                    >
                      {gene}
                    </span>
                  ))}
                  {selectedPathway.lead_genes.length > 20 && (
                    <span className="inline-flex px-2 py-1 text-xs text-gray-500">
                      +{selectedPathway.lead_genes.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
