import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VisualizationModuleBoundary } from './VisualizationModuleBoundary';
import type { VisualizationManifestState } from '@/lib/visualization-context';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

const readyState: VisualizationManifestState = {
  status: 'ready',
  manifest: {
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
      { id: 'compare', visible: true, enabled: false, disabled_reason: 'At least two comparisons are required', data_scopes: ['ptm'] },
      { id: 'gsea', visible: false, enabled: false, disabled_reason: null, data_scopes: [] },
    ],
  },
};

describe('VisualizationModuleBoundary', () => {
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

  function render(state: VisualizationManifestState, pathname: string, onRetry = vi.fn()) {
    act(() => root.render(
      <VisualizationModuleBoundary
        state={state}
        pathname={pathname}
        sessionId="session-id"
        onRetry={onRetry}
      >
        <div data-testid="module-content">content</div>
      </VisualizationModuleBoundary>,
    ));
    return onRetry;
  }

  it('keeps loading separate from failure', () => {
    render({ status: 'loading' }, '/analysis/visualization');

    expect(container.querySelector('[data-testid="visualization-manifest-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="module-content"]')).toBeNull();
  });

  it('shows a retryable manifest error', () => {
    const onRetry = render(
      { status: 'error', message: 'HTTP 500' },
      '/analysis/visualization',
    );

    expect(container.textContent).toContain('HTTP 500');
    act(() => container.querySelector('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('blocks direct access to hidden and disabled modules', () => {
    render(readyState, '/analysis/visualization/gsea');
    expect(container.querySelector('[data-testid="visualization-module-unavailable"]')).not.toBeNull();

    render(readyState, '/analysis/visualization/compare');
    expect(container.textContent).toContain('At least two comparisons are required');
  });

  it('renders enabled module content', () => {
    render(readyState, '/analysis/visualization');

    expect(container.querySelector('[data-testid="module-content"]')).not.toBeNull();
  });
});
