import { beforeEach, describe, expect, it } from 'vitest';

import { migrateLegacyFilterConfig, useAnalysisStore } from '@/stores/analysis-store';

describe('analysis filter configuration', () => {
  beforeEach(() => {
    useAnalysisStore.getState().reset();
  });

  it('migrates the legacy strict preset and razor setting', () => {
    expect(migrateLegacyFilterConfig({
      remove_razor: true,
      strict_filtering: true,
      min_peptides_per_protein: 1,
    })).toEqual({
      resolve_shared_peptides: true,
      max_missing_fraction_per_condition: 0.2,
      min_psms_per_protein: 2,
    });
  });

  it('lets explicit new values take precedence over legacy values', () => {
    expect(migrateLegacyFilterConfig({
      resolve_shared_peptides: false,
      max_missing_fraction_per_condition: 0.3,
      min_psms_per_protein: 4,
      remove_razor: true,
      strict_filtering: true,
      min_peptides_per_protein: 2,
    })).toEqual({
      resolve_shared_peptides: false,
      max_missing_fraction_per_condition: 0.3,
      min_psms_per_protein: 4,
    });
  });

  it('clamps explicit values to their supported ranges', () => {
    useAnalysisStore.getState().setConfig({
      max_missing_fraction_per_condition: 2,
      min_psms_per_protein: 20,
    });

    const config = useAnalysisStore.getState().config;
    expect(config.max_missing_fraction_per_condition).toBe(1);
    expect(config.min_psms_per_protein).toBe(10);
  });
});
