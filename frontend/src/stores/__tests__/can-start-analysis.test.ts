import { describe, it, expect } from 'vitest';
import { canStartAnalysis } from '@/stores/analysis-store';
import type { SessionConfig } from '@/types';

const makeState = (overrides: Record<string, unknown> = {}) => ({
  uploadedFiles: [],
  selectedFiles: new Set<string>(),
  analysisType: null as string | null,
  config: {} as SessionConfig,
  ptmDetectedMods: [],
  ptmSelectedMods: [],
  ...overrides,
});

describe('canStartAnalysis', () => {
  it('should return false when no files selected', () => {
    const state = makeState({ selectedFiles: new Set(), config: { comparisons: [{ group1: { Condition: 'A' }, group2: { Condition: 'B' } }] } });
    expect(canStartAnalysis(state as Parameters<typeof canStartAnalysis>[0])).toBe(false);
  });

  it('should return false when no comparisons defined', () => {
    const state = makeState({ selectedFiles: new Set(['file1']), config: {} });
    expect(canStartAnalysis(state as Parameters<typeof canStartAnalysis>[0])).toBe(false);
  });

  it('should return true when files selected and comparisons defined (non-TMT)', () => {
    const state = makeState({
      selectedFiles: new Set(['file1', 'file2']),
      config: { comparisons: [{ group1: { Condition: 'A' }, group2: { Condition: 'B' } }] },
    });
    expect(canStartAnalysis(state as Parameters<typeof canStartAnalysis>[0])).toBe(true);
  });

  it('should return false for TMT when channels are not fully mapped', () => {
    const state = makeState({
      selectedFiles: new Set(['file1']),
      uploadedFiles: [
        { filename: 'file1', tmt_channels: ['126', '127N'], file_type: 'tmt' },
      ],
      config: {
        file_type: 'tmt',
        comparisons: [{ group1: { Condition: 'A' }, group2: { Condition: 'B' } }],
        tmt_channel_mapping: {},
      },
    });
    expect(canStartAnalysis(state as Parameters<typeof canStartAnalysis>[0])).toBe(false);
  });

  it('should return true for TMT when all channels are mapped', () => {
    const state = makeState({
      selectedFiles: new Set(['file1']),
      uploadedFiles: [
        { filename: 'file1', tmt_channels: ['126', '127N'], file_type: 'tmt' },
      ],
      config: {
        file_type: 'tmt',
        comparisons: [{ group1: { Condition: 'A' }, group2: { Condition: 'B' } }],
        tmt_channel_mapping: {
          'file1::126': { Condition: 'A', replicate: 1 },
          'file1::127N': { Condition: 'B', replicate: 2 },
        },
      },
    });
    expect(canStartAnalysis(state as Parameters<typeof canStartAnalysis>[0])).toBe(true);
  });
});
