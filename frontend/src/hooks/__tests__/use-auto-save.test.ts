import { describe, it, expect, vi } from 'vitest';

// Mock sessionsApi before importing the module under test
const mockUpdateConfig = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api-client', () => ({
  sessionsApi: {
    updateConfig: mockUpdateConfig,
  },
}));

describe('useAutoSave', () => {
  it('exports a function named useAutoSave', async () => {
    const mod = await import('@/hooks/use-auto-save');
    expect(typeof mod.useAutoSave).toBe('function');
  });

  it('function toString contains expected implementation details', async () => {
    const mod = await import('@/hooks/use-auto-save');
    const src = mod.useAutoSave.toString();
    // Debounce config
    expect(src).toContain('debounceMs');
    expect(src).toContain('800');
    // Return value fields
    expect(src).toContain('isSaving');
    expect(src).toContain('saveError');
    expect(src).toContain('saveNow');
    // Uses setTimeout for debounce
    expect(src).toContain('setTimeout');
  });

  it('uses sessionsApi.updateConfig for save', async () => {
    const mod = await import('@/hooks/use-auto-save');
    const src = mod.useAutoSave.toString();
    expect(src).toContain('sessionsApi.updateConfig');
  });
});
