import { describe, expect, it } from 'vitest';

import { useProcessingStore } from '@/stores/processing-store';
import { PROCESSING_STEPS } from '@/types/processing';

describe('processing stages', () => {
  it('describes the six-stage pipeline in backend order', () => {
    expect(PROCESSING_STEPS.map((step) => [step.id, step.name])).toEqual([
      [1, 'Prepare and Filter PSMs'],
      [2, 'Resolve Shared Peptides'],
      [3, 'Filter Coverage and Protein Eligibility'],
      [4, 'Protein Abundance'],
      [5, 'Differential Expression'],
      [6, 'QC Metrics'],
    ]);
  });

  it('uses the backend engine-specific labels for abundance and DE stages', () => {
    useProcessingStore.getState().initializeSteps('msstats');
    expect(useProcessingStore.getState().steps.map((step) => step.name)).toEqual([
      'Prepare and Filter PSMs',
      'Resolve Shared Peptides',
      'Filter Coverage and Protein Eligibility',
      'Protein Abundance (MSstats)',
      'Differential Expression (MSstats)',
      'QC Metrics',
    ]);
  });
});
