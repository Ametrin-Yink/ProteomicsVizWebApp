import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VisualizationManifestProvider } from '@/lib/visualization-context';
import { VisualizationPipelineWorkspace } from './VisualizationPipelineWorkspace';

let sessionId = 'session-id';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(sessionId ? `session_id=${sessionId}` : ''),
}));

describe('VisualizationPipelineWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionId = 'session-id';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(pipeline: string) {
    act(() => root.render(
      <VisualizationManifestProvider state={{
        status: 'ready',
        manifest: {
          pipeline,
          default_module: 'volcano',
          schema_version: 1,
          current_schema_version: 1,
          supported: true,
          requires_reprocessing: false,
          normalization_method: 'test',
          imputation_method: 'none',
          abundance_scale: 'log2',
          modules: [],
        },
      }}>
        <VisualizationPipelineWorkspace
          renderPTM={(id) => <div data-testid="ptm">{id}</div>}
        >
          <div data-testid="protein">protein</div>
        </VisualizationPipelineWorkspace>
      </VisualizationManifestProvider>,
    ));
  }

  it('selects the PTM workspace from the manifest', () => {
    render('ptm');

    expect(container.querySelector('[data-testid="ptm"]')?.textContent).toBe('session-id');
    expect(container.querySelector('[data-testid="protein"]')).toBeNull();
  });

  it('keeps the protein workspace for protein pipelines', () => {
    render('tmt');

    expect(container.querySelector('[data-testid="protein"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ptm"]')).toBeNull();
  });

  it('keeps the protein no-session state when no session is selected', () => {
    sessionId = '';
    render('ptm');

    expect(container.querySelector('[data-testid="protein"]')).not.toBeNull();
  });
});
