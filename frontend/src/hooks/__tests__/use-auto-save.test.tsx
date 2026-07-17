import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoSave } from '@/hooks/use-auto-save';
import type { SessionConfig } from '@/types';

const mockUpdateConfig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  sessionsApi: {
    updateConfig: mockUpdateConfig,
  },
}));

const baseConfig: SessionConfig = {
  organism: 'human',
  resolve_shared_peptides: false,
  max_missing_fraction_per_condition: 0.4,
  min_psms_per_protein: 1,
};

function HookHarness({
  sessionId,
  config,
  debounceMs = 100,
  enabled = true,
  capture,
}: {
  sessionId: string;
  config: SessionConfig;
  debounceMs?: number;
  enabled?: boolean;
  capture: (value: ReturnType<typeof useAutoSave>) => void;
}) {
  capture(useAutoSave(sessionId, config, { debounceMs, enabled }));
  return null;
}

describe('useAutoSave', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useAutoSave> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mockUpdateConfig.mockReset();
    mockUpdateConfig.mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(config: SessionConfig, enabled = true, sessionId = 'session-1') {
    act(() => {
      root.render(
        <HookHarness
          sessionId={sessionId}
          config={config}
          enabled={enabled}
          capture={(value) => { latest = value; }}
        />
      );
    });
  }

  it('debounces changes and saves the latest configuration', async () => {
    render({ ...baseConfig, logfc_threshold: 1 });
    render({ ...baseConfig, logfc_threshold: 2 });

    act(() => vi.advanceTimersByTime(99));
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateConfig).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ logfc_threshold: 2 })
    );
  });

  it('does not schedule saves when disabled or missing a session', async () => {
    render(baseConfig, false);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    render(baseConfig, true, '');
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it('prevents overlapping saves', async () => {
    let resolveSave: (() => void) | undefined;
    mockUpdateConfig.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSave = resolve; })
    );
    render(baseConfig, false);

    await act(async () => {
      const first = latest!.saveNow();
      const second = latest!.saveNow();
      await Promise.resolve();
      resolveSave!();
      await Promise.all([first, second]);
    });

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    expect(latest?.isSaving).toBe(false);
  });

  it('saves a newer configuration after an in-flight save finishes', async () => {
    let resolveFirstSave: (() => void) | undefined;
    mockUpdateConfig
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveFirstSave = resolve; })
      )
      .mockResolvedValue(undefined);
    render({ ...baseConfig, logfc_threshold: 1 }, false);

    let firstSave!: Promise<void>;
    await act(async () => {
      firstSave = latest!.saveNow();
      await Promise.resolve();
    });

    render({ ...baseConfig, logfc_threshold: 2 }, false);
    const secondSave = latest!.saveNow();

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);

    resolveFirstSave!();
    await act(async () => {
      await Promise.all([firstSave, secondSave]);
    });

    expect(mockUpdateConfig).toHaveBeenCalledTimes(2);
    expect(mockUpdateConfig).toHaveBeenLastCalledWith(
      'session-1',
      expect.objectContaining({ logfc_threshold: 2 })
    );
  });

  it('reports an error only after three consecutive failures', async () => {
    mockUpdateConfig.mockRejectedValue(new Error('network unavailable'));
    render(baseConfig, false);

    await act(async () => { await latest!.saveNow(); });
    await act(async () => { await latest!.saveNow(); });
    expect(latest?.saveError).toBeNull();

    await act(async () => { await latest!.saveNow(); });
    expect(latest?.saveError).toBe(
      'Save failed repeatedly: network unavailable'
    );
  });
});
