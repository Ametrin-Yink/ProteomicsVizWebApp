import { describe, expect, it } from 'vitest';

import {
  getModulesForManifest,
  getVisualizationUrl,
} from '@/config/visualization-modules';
import type { VisualizationManifest } from '@/types/api';

describe('PTM visualization routing', () => {
  it('opens completed PTM sessions on the PTM volcano page', () => {
    expect(getVisualizationUrl('session-1', 'ptm')).toBe(
      '/analysis/visualization?session_id=session-1&pipeline=ptm'
    );
  });

  it('uses the manifest to hide unavailable modules and disable unavailable actions', () => {
    const manifest: VisualizationManifest = {
    pipeline: 'ptm',
    default_module: 'volcano',
    schema_version: 1,
    current_schema_version: 1,
    supported: true,
    requires_reprocessing: false,
    normalization_method: 'background_peptide',
    imputation_method: 'none',
    abundance_scale: 'log2',
    modules: [
        { id: 'volcano', visible: true, enabled: true, disabled_reason: null, data_scopes: ['ptm'] },
        { id: 'qc', visible: true, enabled: true, disabled_reason: null, data_scopes: ['ptm'] },
        {
          id: 'compare',
          visible: true,
          enabled: false,
          disabled_reason: 'At least two comparisons are required',
          data_scopes: ['ptm'],
        },
        { id: 'gsea', visible: false, enabled: false, disabled_reason: null, data_scopes: [] },
        { id: 'bionet', visible: false, enabled: false, disabled_reason: null, data_scopes: [] },
      ],
    };

    const modules = getModulesForManifest(manifest);

    expect(modules.map((module) => module.id)).toEqual([
      'volcano',
      'qc',
      'compare',
    ]);
    expect(modules.find((module) => module.id === 'compare')).toMatchObject({
      enabled: false,
      disabled_reason: 'At least two comparisons are required',
      data_scopes: ['ptm'],
    });
  });
});
