import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessedAbundanceData } from '@/types/api';
import { PeptideAbundancePlot, ProteinAbundancePlot } from './AbundancePlot';

let capturedData: Array<Record<string, unknown>> = [];
let capturedLayout: Record<string, unknown> = {};

vi.mock('next/dynamic', () => ({
  default: () => (props: {
    data: Array<Record<string, unknown>>;
    layout: Record<string, unknown>;
  }) => {
    capturedData = props.data;
    capturedLayout = props.layout;
    return <div data-testid="plot" />;
  },
}));

function data(points: ProcessedAbundanceData['points']): ProcessedAbundanceData {
  return {
    protein_accession: 'P1',
    comparison_id: 'Drug_vs_DMSO',
    result_layer: 'protein',
    scale: 'log2',
    normalization_method: 'center.median',
    imputation_method: 'MinDet',
    groups: [
      {
        condition: 'DMSO', observation_count: 2, q1: 10, median: 11, q3: 12,
        lower_fence: 7, upper_fence: 15, observed_count: 2, imputed_count: 0,
        model_estimated_count: 0, imputation_fraction: 0,
      },
      {
        condition: 'Drug', observation_count: 1, q1: 14, median: 14, q3: 14,
        lower_fence: 14, upper_fence: 14, observed_count: 0, imputed_count: 1,
        model_estimated_count: 0, imputation_fraction: 1,
      },
    ],
    points,
    point_count: points.length,
    points_truncated: false,
  };
}

describe('processed abundance plots', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    capturedData = [];
    capturedLayout = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders aligned colored protein boxes on the processed log2 scale', () => {
    act(() => {
      root.render(<ProteinAbundancePlot data={data([
        { sample_id: 'DMSO_1', condition: 'DMSO', replicate: '1', batch: null, processed_log2_abundance: 10, provenance: 'observed' },
        { sample_id: 'DMSO_2', condition: 'DMSO', replicate: '2', batch: null, processed_log2_abundance: 12, provenance: 'observed' },
        { sample_id: 'Drug_1', condition: 'Drug', replicate: '1', batch: null, processed_log2_abundance: 14, provenance: 'imputed' },
      ])} />);
    });

    expect(capturedData.map((trace) => trace.type)).toEqual(['box', 'box']);
    expect(capturedData.map((trace) => trace.name)).toEqual(['DMSO', 'Drug']);
    expect(capturedData[0].marker).not.toEqual(capturedData[1].marker);
    expect(capturedLayout.boxmode).toBe('group');
    expect((capturedLayout.yaxis as { title: { text: string } }).title.text).toBe('Normalized log2 abundance');
  });

  it('renders peptide observations as one box per condition without min-max lines', () => {
    act(() => {
      root.render(<PeptideAbundancePlot data={data([
        { sample_id: 'DMSO_1', condition: 'DMSO', replicate: '1', batch: null, peptide_id: 'PEP1', processed_log2_abundance: 9.5, provenance: 'observed' },
        { sample_id: 'DMSO_1', condition: 'DMSO', replicate: '1', batch: null, peptide_id: 'PEP2', processed_log2_abundance: 10.5, provenance: 'observed' },
        { sample_id: 'Drug_1', condition: 'Drug', replicate: '1', batch: null, peptide_id: 'PEP1', processed_log2_abundance: 13.5, provenance: 'imputed' },
      ])} />);
    });

    expect(capturedData).toHaveLength(2);
    expect(capturedData.every((trace) => trace.type === 'box')).toBe(true);
    expect(capturedData.flatMap((trace) => trace.y as number[])).toEqual([9.5, 10.5, 13.5]);
  });
});
