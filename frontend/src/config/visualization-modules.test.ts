import { describe, expect, it } from 'vitest';

import {
  getModulesForPipeline,
  getVisualizationUrl,
} from '@/config/visualization-modules';

describe('PTM visualization routing', () => {
  it('opens completed PTM sessions on the PTM volcano page', () => {
    expect(getVisualizationUrl('session-1', 'ptm')).toBe(
      '/analysis/visualization/ptm-placeholder?session_id=session-1&pipeline=ptm&tab=volcano'
    );
  });

  it('shows protein analyses only when the optional protein layer exists', () => {
    expect(getModulesForPipeline('ptm', false).map((module) => module.id)).toEqual([
      'volcano',
      'qc',
      'compare',
    ]);
    expect(getModulesForPipeline('ptm', true).map((module) => module.id)).toEqual([
      'volcano',
      'qc',
      'compare',
      'gsea',
      'bionet',
    ]);
  });
});
