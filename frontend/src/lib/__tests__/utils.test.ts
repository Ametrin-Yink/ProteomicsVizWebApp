import { describe, it, expect } from 'vitest';
import {
  isSignificantVolcano,
  getVolcanoPointColor,
  getSignificanceLabel,
  transformPCARowBased,
  formatNumber,
  formatPValue,
  parseDelimited,
  formatGroup,
  formatComparisonKey,
  formatDuration,
  truncateText,
  generateId,
} from '@/lib/utils';

describe('isSignificantVolcano', () => {
  const thresholds = {
    foldChange: 1.0,
    pValue: 0.05,
    adjPValue: 0.05,
    s0: 0,
  };

  it('marks significant upregulated protein', () => {
    expect(isSignificantVolcano(2.5, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('marks significant downregulated protein', () => {
    expect(isSignificantVolcano(-2.0, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('marks non-significant when logFC below threshold', () => {
    expect(isSignificantVolcano(0.5, 0.001, 0.005, thresholds)).toBe(false);
  });

  it('marks non-significant when pvalue above threshold', () => {
    expect(isSignificantVolcano(2.5, 0.5, 0.5, thresholds)).toBe(false);
  });

  it('marks non-significant when adjPval above threshold', () => {
    expect(isSignificantVolcano(2.5, 0.001, 0.5, thresholds)).toBe(false);
  });

  it('S0 hyperbolic: rejects points with abs(logFC) <= actualS0', () => {
    const s0Thresholds = { ...thresholds, s0: 0.5 };
    expect(isSignificantVolcano(0.4, 0.0001, 0.0001, s0Thresholds)).toBe(false);
  });

  it('S0 hyperbolic: accepts points well beyond the curve', () => {
    const s0Thresholds = { ...thresholds, s0: 0.1 };
    expect(isSignificantVolcano(1.5, 0.00001, 0.00001, s0Thresholds)).toBe(true);
  });

  it('handles logFC exactly at foldChange threshold', () => {
    expect(isSignificantVolcano(1.0, 0.001, 0.005, thresholds)).toBe(true);
  });

  it('handles pValue exactly at threshold', () => {
    expect(isSignificantVolcano(2.5, 0.05, 0.05, thresholds)).toBe(true);
  });
});

describe('getVolcanoPointColor', () => {
  const thresholds = { foldChange: 1.0, pValue: 0.05, adjPValue: 0.05, s0: 0 };

  it('returns pink for upregulated', () => {
    expect(getVolcanoPointColor(2.5, 0.001, 0.005, thresholds)).toBe('#E73564');
  });

  it('returns blue for downregulated', () => {
    expect(getVolcanoPointColor(-2.0, 0.001, 0.005, thresholds)).toBe('#00ADEF');
  });

  it('returns grey for not significant', () => {
    expect(getVolcanoPointColor(0.3, 0.5, 0.5, thresholds)).toBe('#6B7280');
  });
});

describe('getSignificanceLabel', () => {
  const thresholds = { foldChange: 1.0, pValue: 0.05, adjPValue: 0.05, s0: 0 };

  it('returns Upregulated', () => {
    expect(getSignificanceLabel(2.5, 0.001, 0.005, thresholds)).toBe('Upregulated');
  });

  it('returns Downregulated', () => {
    expect(getSignificanceLabel(-2.0, 0.001, 0.005, thresholds)).toBe('Downregulated');
  });

  it('returns Not Significant', () => {
    expect(getSignificanceLabel(0.3, 0.5, 0.5, thresholds)).toBe('Not Significant');
  });
});

describe('transformPCARowBased', () => {
  it('transforms column-based to row-based format', () => {
    const result = transformPCARowBased(
      ['S1', 'S2', 'S3'],
      [1.0, -2.0, 0.5],
      [3.0, -1.0, 0.0],
      ['Control', 'Treatment', 'Control'],
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ sample: 'S1', pc1: 1.0, pc2: 3.0, condition: 'Control' });
    expect(result[1]).toEqual({ sample: 'S2', pc1: -2.0, pc2: -1.0, condition: 'Treatment' });
  });

  it('handles empty arrays', () => {
    const result = transformPCARowBased([], [], [], []);
    expect(result).toEqual([]);
  });
});

describe('formatNumber', () => {
  it('formats regular numbers to specified decimal places', () => {
    expect(formatNumber(3.14159, 2)).toBe('3.14');
  });

  it('returns dash for null', () => {
    expect(formatNumber(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('-');
  });

  it('uses scientific notation for very small numbers', () => {
    const result = formatNumber(0.0001, 3);
    expect(result).toContain('e');
  });
});

describe('formatPValue', () => {
  it('uses scientific notation for small values', () => {
    const result = formatPValue(0.0001);
    expect(result).toContain('e');
  });

  it('uses fixed notation for moderate values', () => {
    expect(formatPValue(0.05)).toBe('0.0500');
  });

  it('returns dash for null', () => {
    expect(formatPValue(null)).toBe('-');
  });
});

describe('parseDelimited', () => {
  it('splits by comma', () => {
    expect(parseDelimited('A, B, C')).toEqual(['A', 'B', 'C']);
  });

  it('splits by semicolon', () => {
    expect(parseDelimited('P12345; P67890')).toEqual(['P12345', 'P67890']);
  });

  it('filters empty strings', () => {
    expect(parseDelimited('A,,B')).toEqual(['A', 'B']);
  });
});

describe('formatGroup', () => {
  it('joins values with +', () => {
    expect(formatGroup({ C: 'DrugA', T: '24h' })).toBe('DrugA+24h');
  });

  it('returns (any) for empty object', () => {
    expect(formatGroup({})).toBe('(any)');
  });
});

describe('formatComparisonKey', () => {
  it('replaces _vs_ with vs', () => {
    expect(formatComparisonKey('DrugA_vs_DMSO')).toBe('DrugA vs DMSO');
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats seconds only when under 60', () => {
    expect(formatDuration(45)).toBe('45s');
  });
});

describe('truncateText', () => {
  it('returns original if under max length', () => {
    expect(truncateText('short', 10)).toBe('short');
  });

  it('truncates with ellipsis if over max length', () => {
    expect(truncateText('this is a long string', 10)).toBe('this is a ...');
  });
});

describe('generateId', () => {
  it('returns a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
