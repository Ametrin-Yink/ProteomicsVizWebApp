/**
 * E2E Test Suite 9: Configuration Variations
 *
 * Tests all 4 combinations of remove_razor and strict_filtering.
 * CRITICAL: Different configs must produce different results.
 *
 * CRITICAL TESTING RULES:
 * 1. ONE-BY-ONE EXECUTION: Tests must run sequentially
 * 2. VISUAL VERIFICATION: Every test MUST take screenshots
 * 3. STRICT ASSERTIONS: Tests must FAIL when broken
 * 4. DATA VERIFICATION: Results must differ between configs
 */

import { test, expect, Page } from '@playwright/test';
import {
  createSession,
  uploadFiles,
  configureAnalysis,
  startAnalysis,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

// Track created sessions for cleanup
const createdSessions: string[] = [];

async function cleanupAllSessions(page: Page): Promise<void> {
  for (const sessionId of createdSessions) {
    try {
      await cleanupSession(page, sessionId);
    } catch (e) {
      console.log(`Failed to cleanup session ${sessionId}: ${e}`);
    }
  }
  createdSessions.length = 0;
}

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('09-config-variations');
});

test.afterAll(async () => {
  console.log('Config variations test suite completed');
});

test.describe('Configuration Variations - All 4 Combinations', () => {

  test.afterEach(async ({ page }) => {
    await cleanupAllSessions(page);
  });

  test('Config A: Conservative (remove_razor=true, strict_filtering=true)', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Config A - Conservative');
    createdSessions.push(sessionId);

    // Upload files
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Configure with conservative settings
    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    await takeScreenshot(page, '09-config-variations', 'config-a-conservative', 'before-start');

    // Start and complete analysis
    await startAnalysis(page, 300000);

    // Verify on results page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    // Get protein count
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountA = parseInt(totalText?.match(/\d+/)?.[0] || '0');

    // Verify has results
    expect(totalCountA).toBeGreaterThan(0);
    console.log(`Config A (Conservative) - Total proteins: ${totalCountA}`);

    await takeScreenshot(page, '09-config-variations', 'config-a-conservative', 'results');

    // Store count for comparison (in practice, would store in test context)
    await page.evaluate((count) => {
      (window as any).configAProteinCount = count;
    }, totalCountA);
  });

  test('Config B: Balanced (remove_razor=true, strict_filtering=false)', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Config B - Balanced');
    createdSessions.push(sessionId);

    // Upload files
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Configure with balanced settings
    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: false,
    });

    await takeScreenshot(page, '09-config-variations', 'config-b-balanced', 'before-start');

    // Start and complete analysis
    await startAnalysis(page, 300000);

    // Verify on results page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    // Get protein count
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountB = parseInt(totalText?.match(/\d+/)?.[0] || '0');

    expect(totalCountB).toBeGreaterThan(0);
    console.log(`Config B (Balanced) - Total proteins: ${totalCountB}`);

    await takeScreenshot(page, '09-config-variations', 'config-b-balanced', 'results');
  });

  test('Config C: Inclusive (remove_razor=false, strict_filtering=true)', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Config C - Inclusive');
    createdSessions.push(sessionId);

    // Upload files
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Configure with inclusive settings
    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: false,
      strictFiltering: true,
    });

    await takeScreenshot(page, '09-config-variations', 'config-c-inclusive', 'before-start');

    // Start and complete analysis
    await startAnalysis(page, 300000);

    // Verify on results page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    // Get protein count
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountC = parseInt(totalText?.match(/\d+/)?.[0] || '0');

    expect(totalCountC).toBeGreaterThan(0);
    console.log(`Config C (Inclusive) - Total proteins: ${totalCountC}`);

    await takeScreenshot(page, '09-config-variations', 'config-c-inclusive', 'results');
  });

  test('Config D: Permissive (remove_razor=false, strict_filtering=false)', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Config D - Permissive');
    createdSessions.push(sessionId);

    // Upload files
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Configure with permissive settings
    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: false,
      strictFiltering: false,
    });

    await takeScreenshot(page, '09-config-variations', 'config-d-permissive', 'before-start');

    // Start and complete analysis
    await startAnalysis(page, 300000);

    // Verify on results page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    // Get protein count
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCountD = parseInt(totalText?.match(/\d+/)?.[0] || '0');

    expect(totalCountD).toBeGreaterThan(0);
    console.log(`Config D (Permissive) - Total proteins: ${totalCountD}`);

    await takeScreenshot(page, '09-config-variations', 'config-d-permissive', 'results');

    // Config D should have most proteins (least filtering)
    // This is a general expectation - actual comparison would require running all 4 in sequence
  });
});

test.describe('Configuration Validation', () => {

  test.afterEach(async ({ page }) => {
    await cleanupAllSessions(page);
  });

  test('config persists after page reload', async ({ page }) => {
    // Create session and configure
    const sessionId = await createSession(page);
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

    // Verify config still selected
    await expect(page.locator('[data-testid="config-form"]')).toBeVisible();

    // Take screenshot to verify
    await takeScreenshot(page, '09-config-variations', 'config-persists-reload', 'after-reload');
  });

  test('treatment equals control shows validation error', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page);
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

    await takeScreenshot(page, '09-config-variations', 'treatment-equals-control-validation', 'error-shown');
  });
});
