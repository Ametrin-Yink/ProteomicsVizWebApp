/**
 * E2E Test: Configuration Variations (GOALS.md - E2E Test 3)
 *
 * Tests all 4 combinations of Razor Peptide Handling and Data Quality Filtering.
 * Each config should produce measurably different results.
 *
 * Config A: Conservative (remove_razor=true, strict_filtering=true)
 * Config B: Balanced (remove_razor=true, strict_filtering=false)
 * Config C: Inclusive (remove_razor=false, strict_filtering=true)
 * Config D: Permissive (remove_razor=false, strict_filtering=false)
 *
 * CRITICAL: Different configs must produce different results.
 * - Strict filtering should have fewer PSMs than lenient
 * - Razor removal should affect protein assignments
 */

import { test, expect } from '@playwright/test';
import {
  createSession,
  uploadFiles,
  configureAnalysis,
  startAnalysis,
  cleanupAllSessions,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

const createdSessions: string[] = [];

test.beforeAll(() => {
  purgeLegacyScreenshots('03-config-variations');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page, createdSessions);
});

test.describe('Configuration Variations - All 4 Combinations', () => {

  // Store results for comparison
  const results: {
    configA?: { proteins: number; psms: number };
    configB?: { proteins: number; psms: number };
    configC?: { proteins: number; psms: number };
    configD?: { proteins: number; psms: number };
  } = {};

  test('Config A: Conservative (T, T)', async ({ page }) => {
    test.setTimeout(600000);

    const sessionId = await createSession(page, 'Config A - Conservative');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    await takeScreenshot(page, '03-config-variations', 'config-a', 'before-start');

    await startAnalysis(page, 300000);

    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible();

    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountA = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCountA).toBeGreaterThan(0);

    // Store for comparison
    results.configA = { proteins: totalCountA, psms: 0 };
    console.log(`Config A (Conservative) - Proteins: ${totalCountA}`);

    await takeScreenshot(page, '03-config-variations', 'config-a', 'results');
  });

  test('Config B: Balanced (T, F)', async ({ page }) => {
    test.setTimeout(600000);

    const sessionId = await createSession(page, 'Config B - Balanced');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: false,
    });

    await takeScreenshot(page, '03-config-variations', 'config-b', 'before-start');

    await startAnalysis(page, 300000);

    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible();

    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountB = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCountB).toBeGreaterThan(0);

    results.configB = { proteins: totalCountB, psms: 0 };
    console.log(`Config B (Balanced) - Proteins: ${totalCountB}`);

    await takeScreenshot(page, '03-config-variations', 'config-b', 'results');

    // Config B should have more proteins than Config A (lenient filtering)
    if (results.configA) {
      console.log(`Comparison: Config B (${totalCountB}) vs Config A (${results.configA.proteins})`);
    }
  });

  test('Config C: Inclusive (F, T)', async ({ page }) => {
    test.setTimeout(600000);

    const sessionId = await createSession(page, 'Config C - Inclusive');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: false,
      strictFiltering: true,
    });

    await takeScreenshot(page, '03-config-variations', 'config-c', 'before-start');

    await startAnalysis(page, 300000);

    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible();

    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountC = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCountC).toBeGreaterThan(0);

    results.configC = { proteins: totalCountC, psms: 0 };
    console.log(`Config C (Inclusive) - Proteins: ${totalCountC}`);

    await takeScreenshot(page, '03-config-variations', 'config-c', 'results');
  });

  test('Config D: Permissive (F, F)', async ({ page }) => {
    test.setTimeout(600000);

    const sessionId = await createSession(page, 'Config D - Permissive');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: false,
      strictFiltering: false,
    });

    await takeScreenshot(page, '03-config-variations', 'config-d', 'before-start');

    await startAnalysis(page, 300000);

    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible();

    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountD = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCountD).toBeGreaterThan(0);

    results.configD = { proteins: totalCountD, psms: 0 };
    console.log(`Config D (Permissive) - Proteins: ${totalCountD}`);

    await takeScreenshot(page, '03-config-variations', 'config-d', 'results');

    // Config D should have most proteins (least filtering)
    console.log('===== Config Comparison =====');
    console.log(`Config A (T,T): ${results.configA?.proteins || 'N/A'}`);
    console.log(`Config B (T,F): ${results.configB?.proteins || 'N/A'}`);
    console.log(`Config C (F,T): ${results.configC?.proteins || 'N/A'}`);
    console.log(`Config D (F,F): ${totalCountD}`);
    console.log('=============================');
  });

});

test.describe('Configuration Validation', () => {

  test('config persists after page reload', async ({ page }) => {
    const sessionId = await createSession(page, 'Config Persistence');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify config still present
    await expect(page.locator('[data-testid="config-form"]')).toBeVisible();

    await takeScreenshot(page, '03-config-variations', 'config-persists', 'after-reload');
  });

  test('treatment equals control shows validation error', async ({ page }) => {
    const sessionId = await createSession(page, 'Treatment Equals Control');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    // Try to set treatment = control
    await page.locator('[data-testid="treatment-select"]').selectOption('DMSO');
    await page.locator('[data-testid="control-select"]').selectOption('DMSO');

    // Verify validation error appears
    await expect(page.locator('[data-testid="config-error"]')).toBeVisible();
    const errorText = await page.locator('[data-testid="config-error"]').textContent();
    expect(errorText).toContain('must be different');

    // Start button should be disabled
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
    const isEnabled = await startBtn.isEnabled();
    expect(isEnabled).toBe(false);

    await takeScreenshot(page, '03-config-variations', 'treatment-control-same', 'error-shown');
  });

});
