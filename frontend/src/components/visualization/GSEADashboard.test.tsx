import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GSEADashboard from './GSEADashboard';

vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="gsea-plot" />,
}));

describe('GSEADashboard', () => {
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

  it('does not render an empty chart before GSEA results exist', async () => {
    await act(async () => {
      root.render(
        <GSEADashboard
      data={{
        database: 'GO_Biological_Process_2025',
        results: [],
            significant_pathways: 0,
            overrepresented: 0,
            underrepresented: 0,
            total_pathways: 0,
          }}
          selectedPathway={null}
          onSelectPathway={() => undefined}
        />,
      );
    });

    expect(container.querySelector('[data-testid="gsea-plot"]')).toBeNull();
    expect(container.querySelector('[data-testid="gsea-overview"]')).toBeNull();
  });
});
