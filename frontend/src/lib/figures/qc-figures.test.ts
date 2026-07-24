import { describe, it, expect } from 'vitest';
import { buildQcExport, canonicalToQCData } from '@/lib/figures/qc-figures';
import type {
  QCOverviewData,
  QCPerSampleData,
  QCDifferentialData,
  QCData,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockOverview(overrides?: Partial<QCOverviewData>): QCOverviewData {
  return {
    group_by: 'condition',
    groups: [
      {
        group_by: 'condition',
        group_value: 'Drug',
        sample_count: 2,
        observation_count: 4,
        q1: 10,
        median: 12,
        q3: 14,
        observed_count: 4,
        imputed_count: 0,
        missing_count: 0,
        protein_cv_count: 2,
        protein_cv_q1: 0.1,
        protein_cv_median: 0.2,
        protein_cv_q3: 0.3,
        peptide_cv_count: 4,
        peptide_cv_q1: 0.15,
        peptide_cv_median: 0.25,
        peptide_cv_q3: 0.35,
        lowerfence: 4,
        upperfence: 20,
      },
    ],
    next_cursor: null,
    group_count: 1,
    matching_group_count: 1,
    pca: [
      { sample_id: 'Drug_1', pc1: 1.0, pc2: 0.5, condition: 'Drug' },
      { sample_id: 'Drug_2', pc1: 1.5, pc2: 0.8, condition: 'Drug' },
    ],
    normalization_method: 'center.median',
    imputation_method: 'MinDet',
    abundance_scale: 'log2',
    pca_method: 'exact',
    pc1_variance: 50,
    pc2_variance: 30,
    ...overrides,
  };
}

function mockPerSample(overrides?: Partial<QCPerSampleData>): QCPerSampleData {
  return {
    protein_intensity: [
      {
        sample_id: 'Drug_1',
        condition: 'Drug',
        abundance_q1: 10,
        abundance_median: 12,
        abundance_q3: 14,
      },
      {
        sample_id: 'Drug_2',
        condition: 'Drug',
        abundance_q1: 9,
        abundance_median: 11,
        abundance_q3: 13,
      },
    ],
    protein_completeness: [
      { sample_id: 'Drug_1', condition: 'Drug', total: 100, present: 80, missing: 20 },
      { sample_id: 'Drug_2', condition: 'Drug', total: 100, present: 75, missing: 25 },
    ],
    psm_completeness: [
      { sample_id: 'Drug_1', condition: 'Drug', total: 500, present: 400, missing: 100 },
      { sample_id: 'Drug_2', condition: 'Drug', total: 500, present: 380, missing: 120 },
    ],
    psm_intensity: [
      {
        condition: 'Drug',
        replicate: '1',
        result_layer: 'protein',
        sample_count: 1,
        q1: 8,
        median: 10,
        q3: 12,
      },
    ],
    ...overrides,
  };
}

function mockDifferential(overrides?: Partial<QCDifferentialData>): QCDifferentialData {
  return {
    comparison_id: 'Drug_vs_Control',
    tested_count: 100,
    significant_count: 10,
    failed_count: 0,
    pvalue_distribution: {
      bins: [0, 0.25, 0.5, 0.75, 1.0],
      counts: [40, 30, 20, 10],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canonicalToQCData
// ---------------------------------------------------------------------------

describe('canonicalToQCData', () => {
  it('converts PCA from row-based to column-based format', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.pca).toBeDefined();
    expect(qcData.pca!.samples).toEqual(['Drug_1', 'Drug_2']);
    expect(qcData.pca!.pc1).toEqual([1.0, 1.5]);
    expect(qcData.pca!.pc2).toEqual([0.5, 0.8]);
    expect(qcData.pca!.conditions).toEqual(['Drug', 'Drug']);
    expect(qcData.pca!.pc1_variance).toBe(50);
    expect(qcData.pca!.pc2_variance).toBe(30);
  });

  it('converts p-value distribution from differential data', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.pvalue_distribution).toEqual(differential.pvalue_distribution);
    expect(qcData.pvalue_distributions).toEqual({
      [differential.comparison_id]: differential.pvalue_distribution,
    });
  });

  it('converts PSM CV from group peptide_cv quartiles', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.psm_cv).toBeDefined();
    expect(qcData.psm_cv!['Drug']).toEqual([0.15, 0.25, 0.35]);
  });

  it('converts Protein CV from group protein_cv quartiles', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.protein_cv).toBeDefined();
    expect(qcData.protein_cv!['Drug']).toEqual([0.1, 0.2, 0.3]);
  });

  it('converts PSM intensity distributions', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.intensity_distributions).toBeDefined();
    expect(qcData.intensity_distributions!.psm_boxplot).toBeDefined();
    expect(qcData.intensity_distributions!.psm_boxplot['Drug']).toBeDefined();
    expect(qcData.intensity_distributions!.psm_boxplot['Drug']['1']).toEqual([8, 10, 12]);
  });

  it('converts protein intensity distributions', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.intensity_distributions!.protein_boxplot).toBeDefined();
    expect(qcData.intensity_distributions!.protein_boxplot['Drug_1']).toEqual([10, 12, 14]);
    expect(qcData.intensity_distributions!.protein_boxplot['Drug_2']).toEqual([9, 11, 13]);
  });

  it('converts protein data completeness', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.data_completeness).toBeDefined();
    expect(qcData.data_completeness!['Drug_1']).toEqual({ present: 80, missing: 20 });
    expect(qcData.data_completeness!['Drug_2']).toEqual({ present: 75, missing: 25 });
  });

  it('converts PSM completeness', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.psm_completeness).toBeDefined();
    expect(qcData.psm_completeness!['Drug_1']).toEqual({ present: 400, missing: 100 });
    expect(qcData.psm_completeness!['Drug_2']).toEqual({ present: 380, missing: 120 });
  });

  it('handles missing differential data gracefully', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();

    const qcData = canonicalToQCData(overview, perSample, null);

    expect(qcData.pvalue_distribution).toBeUndefined();
    expect(qcData.pvalue_distributions).toBeUndefined();
  });

  it('handles empty groups without error', () => {
    const overview = mockOverview({ groups: [] });
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.psm_cv).toBeUndefined();
    expect(qcData.protein_cv).toBeUndefined();
  });

  it('skips groups with null CV quartiles', () => {
    const overview = mockOverview({
      groups: [
        {
          group_by: 'condition',
          group_value: 'Drug',
          sample_count: 2,
          observation_count: 4,
          q1: 10,
          median: 12,
          q3: 14,
          observed_count: 4,
          imputed_count: 0,
          missing_count: 0,
          protein_cv_count: null,
          protein_cv_q1: null,
          protein_cv_median: null,
          protein_cv_q3: null,
          peptide_cv_count: null,
          peptide_cv_q1: null,
          peptide_cv_median: null,
          peptide_cv_q3: null,
          lowerfence: null,
          upperfence: null,
        },
      ],
    });
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.psm_cv).toBeUndefined();
    expect(qcData.protein_cv).toBeUndefined();
  });

  it('handles empty per-sample arrays', () => {
    const overview = mockOverview();
    const perSample = mockPerSample({
      protein_intensity: [],
      protein_completeness: [],
      psm_completeness: [],
      psm_intensity: [],
    });
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.intensity_distributions).toBeUndefined();
    expect(qcData.data_completeness).toBeUndefined();
    expect(qcData.psm_completeness).toBeUndefined();
  });

  it('handles empty PCA data', () => {
    const overview = mockOverview({ pca: [] });
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.pca).toBeUndefined();
  });

  it('filters null values from intensity distributions', () => {
    const perSample = mockPerSample({
      protein_intensity: [
        {
          sample_id: 'Drug_1',
          condition: 'Drug',
          abundance_q1: null,
          abundance_median: 12,
          abundance_q3: null,
        },
      ],
      psm_intensity: [
        {
          condition: 'Drug',
          replicate: '1',
          result_layer: 'protein',
          sample_count: 1,
          q1: null,
          median: 10,
          q3: null,
        },
      ],
    });
    const overview = mockOverview();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.intensity_distributions!.protein_boxplot['Drug_1']).toEqual([12]);
    expect(qcData.intensity_distributions!.psm_boxplot['Drug']['1']).toEqual([10]);
  });

  it('handles null pc1_variance and pc2_variance', () => {
    const overview = mockOverview({ pc1_variance: null, pc2_variance: null });
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const qcData = canonicalToQCData(overview, perSample, differential);

    expect(qcData.pca!.pc1_variance).toBe(0);
    expect(qcData.pca!.pc2_variance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildQcExport — canonical input path
// ---------------------------------------------------------------------------

describe('buildQcExport with canonical data input', () => {
  it('produces all 8 chart entries when full canonical data is provided', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const result = buildQcExport({
      data: {} as QCData,
      overview,
      perSample,
      differential,
      conditionList: ['Drug'],
    });

    const plotKeys = [
      'pca',
      'pvalue',
      'psmCv',
      'proteinCv',
      'psmIntensity',
      'proteinIntensity',
      'completeness',
      'psmCompleteness',
    ];

    for (const key of plotKeys) {
      expect(result.plots[key]).not.toBeNull();
    }
  });

  it('pvalue is null when differential is omitted', () => {
    const overview = mockOverview();
    const perSample = mockPerSample();

    const result = buildQcExport({
      data: {} as QCData,
      overview,
      perSample,
      conditionList: ['Drug'],
    });

    expect(result.plots.pvalue).toBeNull();
  });

  it('completeness charts are null when per-sample data has empty arrays', () => {
    const overview = mockOverview();
    const perSample = mockPerSample({
      protein_intensity: [],
      protein_completeness: [],
      psm_completeness: [],
      psm_intensity: [],
    });
    const differential = mockDifferential();

    const result = buildQcExport({
      data: {} as QCData,
      overview,
      perSample,
      differential,
      conditionList: ['Drug'],
    });

    expect(result.plots.completeness).toBeNull();
    expect(result.plots.psmCompleteness).toBeNull();
    expect(result.plots.psmIntensity).toBeNull();
    expect(result.plots.proteinIntensity).toBeNull();
  });

  it('PCA chart is null when overview has empty PCA', () => {
    const overview = mockOverview({ pca: [] });
    const perSample = mockPerSample();
    const differential = mockDifferential();

    const result = buildQcExport({
      data: {} as QCData,
      overview,
      perSample,
      differential,
      conditionList: ['Drug'],
    });

    expect(result.plots.pca).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildQcExport — legacy input path (unchanged behavior)
// ---------------------------------------------------------------------------

describe('buildQcExport with legacy QCData input', () => {
  it('produces all 8 chart entries when full QCData is provided', () => {
    const qcData: QCData = {
      pca: {
        samples: ['Drug_1', 'Drug_2'],
        pc1: [1.0, 1.5],
        pc2: [0.5, 0.8],
        conditions: ['Drug', 'Drug'],
        pc1_variance: 50,
        pc2_variance: 30,
      },
      pvalue_distribution: {
        bins: [0, 0.25, 0.5, 0.75, 1.0],
        counts: [40, 30, 20, 10],
      },
      psm_cv: { Drug: [0.15, 0.25, 0.35] },
      protein_cv: { Drug: [0.1, 0.2, 0.3] },
      intensity_distributions: {
        psm_boxplot: { Drug: { '1': [8, 10, 12] } },
        protein_boxplot: { Drug_1: [10, 12, 14], Drug_2: [9, 11, 13] },
      },
      data_completeness: {
        Drug_1: { present: 80, missing: 20 },
        Drug_2: { present: 75, missing: 25 },
      },
      psm_completeness: {
        Drug_1: { present: 400, missing: 100 },
        Drug_2: { present: 380, missing: 120 },
      },
    };

    const result = buildQcExport({
      data: qcData,
      conditionList: ['Drug'],
    });

    const plotKeys = [
      'pca',
      'pvalue',
      'psmCv',
      'proteinCv',
      'psmIntensity',
      'proteinIntensity',
      'completeness',
      'psmCompleteness',
    ];

    for (const key of plotKeys) {
      expect(result.plots[key]).not.toBeNull();
    }
  });

  it('returns null entries for missing QCData fields', () => {
    const result = buildQcExport({
      data: {} as QCData,
    });

    expect(result.plots.pca).toBeNull();
    expect(result.plots.pvalue).toBeNull();
    expect(result.plots.psmCv).toBeNull();
    expect(result.plots.proteinCv).toBeNull();
    expect(result.plots.psmIntensity).toBeNull();
    expect(result.plots.proteinIntensity).toBeNull();
    expect(result.plots.completeness).toBeNull();
    expect(result.plots.psmCompleteness).toBeNull();
  });
});
