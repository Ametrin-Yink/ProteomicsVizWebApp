import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Msqrob2ConfigForm from '@/components/analysis/Msqrob2ConfigForm';
import MsstatsConfigForm from '@/components/analysis/MsstatsConfigForm';
import type { SessionConfig } from '@/types';

const baseConfig: SessionConfig = {
  organism: 'human',
  resolve_shared_peptides: false,
  max_missing_fraction_per_condition: 0.4,
  min_psms_per_protein: 1,
};

describe('engine configuration forms', () => {
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

  it('shows high-quality controls only for MSstats highQuality selection', () => {
    const setConfig = vi.fn();
    act(() => root.render(<MsstatsConfigForm config={{ ...baseConfig, msstats_feature_selection: 'all' }} setConfig={setConfig} />));
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('MSstats Advanced'))!
        .click();
    });

    expect(container.querySelector('[data-testid="msstats-min-feature-input"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="msstats-remove-outliers-checkbox"]')).not.toBeInTheDocument();

    act(() => root.render(<MsstatsConfigForm config={{ ...baseConfig, msstats_feature_selection: 'highQuality' }} setConfig={setConfig} />));
    expect(container.querySelector('[data-testid="msstats-min-feature-input"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="msstats-remove-outliers-checkbox"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="msstats-remove50-checkbox"]')).not.toBeInTheDocument();
  });

  it('labels no msqrob2 imputation as retaining missing values', () => {
    act(() => root.render(<Msqrob2ConfigForm config={baseConfig} setConfig={vi.fn()} />));

    const noneOption = container.querySelector<HTMLOptionElement>(
      '[data-testid="msqrob2-imputation-select"] option[value="none"]'
    );
    expect(noneOption?.textContent).toBe('None (Retain missing as NA)');
  });
});
