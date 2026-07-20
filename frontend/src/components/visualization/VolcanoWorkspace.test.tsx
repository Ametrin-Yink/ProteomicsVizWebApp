import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VolcanoSummaryBar,
  VolcanoWorkspace,
} from './VolcanoWorkspace';

describe('VolcanoWorkspace', () => {
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

  it('shares counts, batch selection, and the plot/detail layout', async () => {
    const onBatchMark = vi.fn();

    function Harness() {
      const [selection, setSelection] = useState<Set<string>>(new Set());
      return (
        <>
          <VolcanoSummaryBar
            title="Analysis"
            comparisonOptions={[
              { value: 'A_vs_B', label: 'A vs B' },
              { value: 'C_vs_D', label: 'C vs D' },
            ]}
            selectedComparison="A_vs_B"
            onComparisonChange={() => undefined}
            entityCount={25}
            entityLabel="PTM sites"
            differentialCounts={{ total: 3, up: 2, down: 1 }}
            batchSelection={selection}
            onBatchSelectionChange={setSelection}
            onBatchMark={onBatchMark}
          />
          <VolcanoWorkspace details={<div>Details panel</div>}>
            <div>Plot and table</div>
          </VolcanoWorkspace>
        </>
      );
    }

    await act(async () => root.render(<Harness />));

    expect(container.textContent).toContain('25 PTM sites');
    expect(container.textContent).toContain('3 DE (2↑ 1↓)');
    expect(container.textContent).toContain('Plot and table');
    expect(container.textContent).toContain('Details panel');

    const batchButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mark Significant in Batch'
    );
    await act(async () => batchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const selectAll = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => selectAll?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mark 2 comparison(s)'
    );
    await act(async () => submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onBatchMark).toHaveBeenCalledOnce();
  });
});
