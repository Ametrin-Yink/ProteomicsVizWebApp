import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import QCPlots from '@/components/visualization/QCPlots';
import type { QCData, QCOverviewData, QCDifferentialData, QCPerSampleData } from '@/types/api';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/dynamic so Plotly renders as our no-op mock immediately.
vi.mock('next/dynamic', () => ({
  default: () => {
    const MockPlotly = (props: any) => (
      <div
        data-testid="plotly"
        data-traces={JSON.stringify(props.data || [])}
        data-layout={JSON.stringify(props.layout || {})}
      />
    );
    return MockPlotly;
  },
}));

// Mock react-plotly.js (used by dynamic import under the hood).
vi.mock('react-plotly.js', () => ({
  default: ({ data, layout }: any) => (
    <div
      data-testid="plotly"
      data-traces={JSON.stringify(data || [])}
      data-layout={JSON.stringify(layout || {})}
    />
  ),
}));

// Mock lucide-react icons used in the plot card toolbar.
vi.mock('lucide-react', () => ({
  Maximize2: () => <svg data-testid="maximize-icon" />,
  Download: () => <svg data-testid="download-icon" />,
}));

// Mock the SearchableSelect since it has complex DOM interactions
vi.mock('@/components/ui/Select', () => ({
  SearchableSelect: ({ options, value, onChange }: any) => (
    <select
      data-testid="searchable-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

// JSDOM does not implement IntersectionObserver. Provide a mock that fires
// synchronously on observe() so LazyPlot sets visible=true within act().
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [
        {
          isIntersecting: true,
          target,
          intersectionRatio: 1,
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: Date.now(),
        },
      ] as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  (globalThis as any).IntersectionObserver = MockIntersectionObserver;
});

afterAll(() => {
  delete (globalThis as any).IntersectionObserver;
});

// ── Test Data ────────────────────────────────────────────────────────────────

const comparisonOptions = [{ value: 'Drug_vs_DMSO', label: 'Drug vs DMSO' }];
const conditionList = ['Drug', 'DMSO'];

const minimalData: QCData = {
  total_psms: 100,
  avg_psms_per_sample: 10,
  total_proteins: 50,
  avg_proteins_per_sample: 5,
};

const overview: QCOverviewData = {
  group_by: 'condition',
  groups: [
    {
      group_by: 'condition',
      group_value: 'Drug',
      sample_count: 3,
      observation_count: 30,
      q1: 4,
      median: 5,
      q3: 6,
      observed_count: 25,
      imputed_count: 3,
      missing_count: 2,
      protein_cv_median: 12,
      protein_cv_q1: 8,
      protein_cv_q3: 15,
      peptide_cv_median: 10,
      peptide_cv_q1: 6,
      peptide_cv_q3: 14,
    },
    {
      group_by: 'condition',
      group_value: 'DMSO',
      sample_count: 3,
      observation_count: 28,
      q1: 3,
      median: 4,
      q3: 5,
      observed_count: 22,
      imputed_count: 4,
      missing_count: 2,
      protein_cv_median: 14,
      protein_cv_q1: 10,
      protein_cv_q3: 18,
      peptide_cv_median: 11,
      peptide_cv_q1: 7,
      peptide_cv_q3: 16,
    },
  ],
  next_cursor: null,
  group_count: 2,
  matching_group_count: 2,
  pca: [
    { sample_id: 'Drug_1', pc1: 1, pc2: 0, condition: 'Drug' },
    { sample_id: 'DMSO_1', pc1: -1, pc2: 0, condition: 'DMSO' },
  ],
  normalization_method: 'median',
  imputation_method: 'knn',
  abundance_scale: 'log2',
  pc1_variance: 80,
  pc2_variance: 20,
};

const perSampleData: QCPerSampleData = {
  psm_intensity: [
    {
      condition: 'Drug',
      replicate: 'R1',
      result_layer: 'protein',
      sample_count: 3,
      q1: 4,
      median: 5,
      q3: 6,
    },
    {
      condition: 'DMSO',
      replicate: 'R1',
      result_layer: 'protein',
      sample_count: 3,
      q1: 3,
      median: 4,
      q3: 5,
    },
  ] as QCPerSampleData['psm_intensity'],
  protein_intensity: [
    { sample_id: 'Drug_1', condition: 'Drug', abundance_q1: 4, abundance_median: 5, abundance_q3: 6 },
    { sample_id: 'DMSO_1', condition: 'DMSO', abundance_q1: 3, abundance_median: 4, abundance_q3: 5 },
  ] as QCPerSampleData['protein_intensity'],
  protein_completeness: [
    { sample_id: 'Drug_1', condition: 'Drug', total: 100, present: 80, missing: 20 },
    { sample_id: 'DMSO_1', condition: 'DMSO', total: 100, present: 70, missing: 30 },
  ],
  psm_completeness: [
    { sample_id: 'Drug_1', condition: 'Drug', total: 500, present: 400, missing: 100 },
    { sample_id: 'DMSO_1', condition: 'DMSO', total: 500, present: 350, missing: 150 },
  ],
};

const differential: QCDifferentialData = {
  comparison_id: 'Drug_vs_DMSO',
  tested_count: 1000,
  significant_count: 50,
  failed_count: 10,
  pvalue_distribution: { bins: [0, 0.25, 0.5, 0.75, 1], counts: [20, 15, 10, 5] },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse traces from the plotly mock inside a specific plot container. */
function getPlotTraces(container: HTMLElement, plotId: string): any[] | null {
  const plotEl = container.querySelector(`[data-testid="${plotId}-plot"]`);
  if (!plotEl) return null;
  const noDataEl = plotEl.querySelector('[data-testid="no-data"]');
  if (noDataEl) return null;
  const plotlyEl = plotEl.querySelector('[data-testid="plotly"]');
  if (!plotlyEl) return null;
  return JSON.parse(plotlyEl.getAttribute('data-traces') || '[]');
}

/** Assert a plot has data and return its traces. */
function expectPlotHasData(container: HTMLElement, plotId: string): any[] {
  const traces = getPlotTraces(container, plotId);
  expect(traces).not.toBeNull();
  expect(traces!.length).toBeGreaterThan(0);
  return traces!;
}

/** Assert a plot shows "no data" (null useMemo). */
function expectPlotNoData(container: HTMLElement, plotId: string) {
  const plotEl = container.querySelector(`[data-testid="${plotId}-plot"]`);
  expect(plotEl).toBeTruthy();
  expect(plotEl!.querySelector('[data-testid="no-data"]')).toBeTruthy();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('QCPlots', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // ── boxStatsToValues (tested through component output) ─────────────────

  describe('boxStatsToValues', () => {
    it('returns array of length 200 + outliers.length when outliers are present', async () => {
      const legacyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        intensity_distributions: {
          psm_boxplot: {
            Condition_A: {
              q1: 5,
              median: 10,
              q3: 15,
              lowerfence: 2,
              upperfence: 18,
              outliers: [99, 100],
            } as any,
          } as any,
          protein_boxplot: {},
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={legacyData}
            overview={null}
            perSampleData={null}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-intensity');
      // boxStatsToValues for one condition with 2 outliers: 200 + 2 = 202
      expect(traces[0].y).toHaveLength(202);
      // First 25 values are lower fence (2)
      expect(traces[0].y.slice(0, 25)).toEqual(Array(25).fill(2));
      // Last 2 values are the outliers (99, 100)
      expect(traces[0].y.slice(-2)).toEqual([99, 100]);
    });

    it('computes fences from IQR when lowerfence/upperfence are missing', async () => {
      const legacyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        intensity_distributions: {
          psm_boxplot: {
            Condition_A: {
              q1: 5,
              median: 10,
              q3: 15,
              // no lowerfence / upperfence
            } as any,
          } as any,
          protein_boxplot: {},
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={legacyData}
            overview={null}
            perSampleData={null}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-intensity');
      const y = traces[0].y;
      expect(y).toHaveLength(200);
      // IQR = 15-5 = 10; effectiveLf = 5 - 1.5*10 = -10
      expect(y.slice(0, 25)).toEqual(Array(25).fill(-10));
      // effectiveUf = 15 + 1.5*10 = 30
      expect(y.slice(-25)).toEqual(Array(25).fill(30));
    });
  });

  // ── normalizeBoxData (tested through component output) ─────────────────

  describe('normalizeBoxData', () => {
    it('handles box-stats dict input producing correct trace structure', async () => {
      const legacyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        intensity_distributions: {
          psm_boxplot: {
            Drug: {
              q1: 5,
              median: 10,
              q3: 15,
              lowerfence: 2,
              upperfence: 18,
              outliers: [99],
            } as any,
          } as any,
          protein_boxplot: {},
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={legacyData}
            overview={null}
            perSampleData={null}
            conditionList={conditionList}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-intensity');
      expect(traces).toHaveLength(1);
      expect(traces[0].type).toBe('box');
      expect(traces[0].marker).toHaveProperty('color');
      // Flat box-stats uses labelFn(key) with no subKey, producing "Drug - "
      expect(traces[0].name).toBe('Drug - ');
    });

    it('handles legacy list input {condition: number[]} nested under replicate', async () => {
      const legacyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        intensity_distributions: {
          psm_boxplot: {
            Drug: {
              R1: [1, 2, 3, 4, 5],
            } as any,
          } as any,
          protein_boxplot: {},
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={legacyData}
            overview={null}
            perSampleData={null}
            conditionList={conditionList}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-intensity');
      expect(traces).toHaveLength(1);
      expect(traces[0].type).toBe('box');
      // Legacy nested list path: y is the original array
      expect(traces[0].y).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles empty input {} producing empty traces array (no data)', async () => {
      const emptyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        intensity_distributions: {
          psm_boxplot: {} as any,
          protein_boxplot: {},
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={emptyData}
            overview={null}
            perSampleData={null}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      // When psm_boxplot has no keys, normalizeBoxData returns empty traces,
      // and the plot returns null (no data available).
      expectPlotNoData(container, 'psm-intensity');
    });
  });

  // ── All 10 plot types ──────────────────────────────────────────────────

  describe('All 10 plot types', () => {
    it('renders PCA plot from overview path', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'pca');
      expect(traces[0].type).toBe('scattergl');
      expect(traces[0].mode).toBe('markers');
      // Each condition becomes its own trace
      expect(traces).toHaveLength(2);
      expect(traces[0].x).toEqual([1]); // Drug
      expect(traces[1].x).toEqual([-1]); // DMSO
    });

    it('renders group abundance plot with line.color and marker.color', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'group-abundance');
      expect(traces).toHaveLength(2);
      for (const trace of traces) {
        expect(trace.marker).toHaveProperty('color');
        expect(trace.line).toHaveProperty('color');
      }
    });

    it('renders provenance plot', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'provenance');
      expect(traces).toHaveLength(3);
      expect(traces[0].type).toBe('bar');
    });

    it('renders pvalue distribution plot from differential data', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            differential={differential}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'pvalue');
      expect(traces).toHaveLength(1);
      expect(traces[0].type).toBe('bar');
      // bin midpoints: (bin[i] + bin[i+1]) / 2 when bins.length !== counts.length
      // bins[0..3] = [0, 0.25, 0.5, 0.75]; midpoints = [0.125, 0.375, 0.625, 0.875]
      expect(traces[0].x).toEqual([0.125, 0.375, 0.625, 0.875]);
      expect(traces[0].y).toEqual([20, 15, 10, 5]);
    });

    it('renders PSM CV plot from overview path', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-cv');
      expect(traces).toHaveLength(2);
      // Overview path uses q1/median/q3 properties with line.color
      expect(traces[0]).toHaveProperty('q1');
      expect(traces[0]).toHaveProperty('median');
      expect(traces[0]).toHaveProperty('q3');
      expect(traces[0]).toHaveProperty('line');
    });

    it('renders Protein CV plot from overview path', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'protein-cv');
      expect(traces).toHaveLength(2);
      expect(traces[0]).toHaveProperty('q1');
      expect(traces[0]).toHaveProperty('median');
      expect(traces[0]).toHaveProperty('q3');
      expect(traces[0]).toHaveProperty('line');
    });

    it('renders PSM intensity plot from perSampleData', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            perSampleData={perSampleData}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-intensity');
      expect(traces).toHaveLength(2);
      expect(traces[0].type).toBe('box');
      // buildIntensityBoxTraces always produces 200-length y arrays
      expect(traces[0].y).toHaveLength(200);
      expect(traces[1].y).toHaveLength(200);
    });

    it('renders Protein intensity plot from perSampleData', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            perSampleData={perSampleData}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'protein-intensity');
      expect(traces).toHaveLength(2);
      expect(traces[0].type).toBe('box');
      expect(traces[0].y).toHaveLength(200);
    });

    it('renders protein completeness plot from perSampleData', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            perSampleData={perSampleData}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'completeness');
      expect(traces).toHaveLength(2); // present + missing bars
      expect(traces[0].type).toBe('bar');
      // x values are the sample_ids
      expect(traces[0].x).toEqual(['Drug_1', 'DMSO_1']);
    });

    it('renders PSM completeness plot from perSampleData', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            perSampleData={perSampleData}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'psm-completeness');
      expect(traces).toHaveLength(2); // present + missing bars
      expect(traces[0].type).toBe('bar');
      expect(traces[0].x).toEqual(['Drug_1', 'DMSO_1']);
    });
  });

  // ── Group abundance marker.color ───────────────────────────────────────

  describe('group abundance boxplots marker.color', () => {
    it('uses marker.color and line.color for group abundance traces', async () => {
      await act(async () => {
        root.render(
          <QCPlots
            data={minimalData}
            overview={overview}
            conditionList={conditionList}
            selectedComparison="Drug_vs_DMSO"
            onComparisonChange={vi.fn()}
            comparisonOptions={comparisonOptions}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const traces = expectPlotHasData(container, 'group-abundance');
      expect(traces).toHaveLength(2);
      for (const t of traces) {
        expect(t.marker).toHaveProperty('color');
        expect(typeof t.marker.color).toBe('string');
        expect(t.line).toHaveProperty('color');
      }
    });
  });

  // ── Fallback: legacy data paths ────────────────────────────────────────

  describe('Fallback to legacy data paths', () => {
    it('uses legacy data paths when overview and perSampleData are null', async () => {
      const legacyData: QCData = {
        total_psms: 100,
        avg_psms_per_sample: 10,
        total_proteins: 50,
        avg_proteins_per_sample: 5,
        pca: {
          samples: ['Drug_1', 'DMSO_1'],
          pc1: [2, -2],
          pc2: [1, -1],
          conditions: ['Drug', 'DMSO'],
          pc1_variance: 70,
          pc2_variance: 15,
        },
        pvalue_distribution: { bins: [0, 0.5, 1], counts: [30, 10] },
        psm_cv: { Drug: [5, 10, 15], DMSO: [6, 12, 18] },
        protein_cv: { Drug: [8, 12, 16], DMSO: [9, 14, 17] },
        intensity_distributions: {
          psm_boxplot: {
            Drug: { R1: [1, 2, 3, 4, 5] } as any,
          } as any,
          protein_boxplot: {
            Drug_1: [10, 11, 12],
          } as any,
        },
        data_completeness: {
          Drug_1: { present: 80, missing: 20 },
          DMSO_1: { present: 70, missing: 30 },
        },
        psm_completeness: {
          Drug_1: { present: 400, missing: 100 },
          DMSO_1: { present: 350, missing: 150 },
        },
      };

      await act(async () => {
        root.render(
          <QCPlots
            data={legacyData}
            overview={null}
            perSampleData={null}
            conditionList={conditionList}
            selectedComparison=""
            onComparisonChange={vi.fn()}
            comparisonOptions={[]}
            groupBy="condition"
          />,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      // PCA from legacy data.pca (scatter, not scattergl).
      // Each condition becomes its own trace via transformPCARowBased + grouping.
      const pcaTraces = expectPlotHasData(container, 'pca');
      expect(pcaTraces[0].type).toBe('scatter');
      expect(pcaTraces).toHaveLength(2);
      expect(pcaTraces[0].x).toEqual([2]); // Drug
      expect(pcaTraces[1].x).toEqual([-2]); // DMSO

      // PSM CV from legacy data.psm_cv
      const psmCVTraces = expectPlotHasData(container, 'psm-cv');
      expect(psmCVTraces.length).toBeGreaterThan(0);

      // Protein CV from legacy data.protein_cv
      const proteinCVTraces = expectPlotHasData(container, 'protein-cv');
      expect(proteinCVTraces.length).toBeGreaterThan(0);

      // PSM Intensity from legacy data.intensity_distributions.psm_boxplot
      const psmIntTraces = expectPlotHasData(container, 'psm-intensity');
      expect(psmIntTraces.length).toBeGreaterThan(0);

      // Protein Intensity from legacy data.intensity_distributions.protein_boxplot
      const protIntTraces = expectPlotHasData(container, 'protein-intensity');
      expect(protIntTraces.length).toBeGreaterThan(0);

      // Completeness from legacy data.data_completeness
      const compTraces = expectPlotHasData(container, 'completeness');
      expect(compTraces.length).toBe(2);

      // PSM Completeness from legacy data.psm_completeness
      const psmCompTraces = expectPlotHasData(container, 'psm-completeness');
      expect(psmCompTraces.length).toBe(2);

      // P-value from legacy data.pvalue_distribution
      const pvalTraces = expectPlotHasData(container, 'pvalue');
      expect(pvalTraces.length).toBe(1);

      // Group abundance and provenance still show "no data" (no overview)
      expectPlotNoData(container, 'group-abundance');
      expectPlotNoData(container, 'provenance');
    });
  });
});
