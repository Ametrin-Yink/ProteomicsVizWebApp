import { describe, expect, it } from 'vitest';

import {
  generateReferenceComparisons,
  getConditionOptions,
} from '@/lib/comparison-options';
import type { SessionConfig } from '@/types';

const baseConfig: SessionConfig = {
  organism: 'human',
  resolve_shared_peptides: false,
  max_missing_fraction_per_condition: 0.4,
  min_psms_per_protein: 1,
};

describe('comparison condition options', () => {
  it('preserves TMT columns when key order differs and values contain plus signs', () => {
    const config: SessionConfig = {
      ...baseConfig,
      tmt_channel_mapping: {
        'sample::126': {
          Treatment: 'Drug+A',
          Condition: 'Case',
          replicate: 1,
        },
        'sample::127N': {
          Treatment: 'Vehicle',
          Condition: 'Control',
          replicate: 1,
        },
      },
    };

    const options = getConditionOptions('tmt', config);
    const reference = options.find(
      (option) => option.group.Condition === 'Control'
    )!;

    expect(generateReferenceComparisons(options, reference.key)).toEqual([
      {
        group1: { Condition: 'Case', Treatment: 'Drug+A' },
        group2: { Condition: 'Control', Treatment: 'Vehicle' },
      },
    ]);
  });

  it('excludes DIA bookkeeping columns from generated groups', () => {
    const config: SessionConfig = {
      ...baseConfig,
      metadata_columns: {
        'sample-1.csv': {
          experiment: 'Experiment 1',
          batch: 'Batch 1',
          replicate: '1',
          Condition: 'Control',
        },
      },
    };

    expect(getConditionOptions('dia', config)[0].group).toEqual({
      Condition: 'Control',
    });
  });
});
