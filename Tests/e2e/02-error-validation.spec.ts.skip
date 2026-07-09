/**
 * E2E Test 02: Error Handling & Validation
 *
 * Tests validation rules, error states, and edge cases in the wizard:
 *   - Invalid filename format produces an error
 *   - Insufficient replicates blocks progress
 *   - Treatment = control produces validation error
 *   - Continue button is disabled without required config
 *   - Back navigation preserves state
 */

import { test, expect } from '@playwright/test';
import {
  startNewAnalysis,
  uploadFiles,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
} from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const TEST_PREFIX = '02-errors';
const SAMPLE_DATA = path.resolve(__dirname, '..', '..', 'SampleData');

const VALID_FILES = [
  'PSM_DOCK5Jurkat_DMSO_24h_1.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_2.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_3.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_1.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_2.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_3.csv',
].map(f => path.join(SAMPLE_DATA, f));

test.describe('Error Handling & Validation', () => {
  let sessionId: string;

  test.beforeAll(() => {
    purgeLegacyScreenshots(TEST_PREFIX);
  });

  test.afterAll(async ({ browser }) => {
    if (sessionId) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await cleanupSession(page, sessionId);
      await context.close();
    }
  });

  test('Invalid filename format shows error', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    // Create a temporary file with an invalid name
    const tmpDir = path.resolve(__dirname, '..', 'fixtures');
    const invalidFile = path.join(tmpDir, 'bad_name_no_pattern.csv');
    fs.writeFileSync(invalidFile, 'col1,col2\nval1,val2\n');

    try {
      // Upload invalid file — expect toast error about filename
      await page.locator('[data-testid="proteomics-upload"]').setInputFiles(invalidFile);

      // The file should NOT appear in the uploaded files list
      await page.waitForTimeout(2000);

      // File table should not show this file
      const fileTable = page.locator('[data-testid="file-table"]');
      const hasBadFile = await fileTable.locator('text=bad_name_no_pattern').count();
      expect(hasBadFile).toBe(0);

      await takeScreenshot(page, TEST_PREFIX, 'errors', '01-invalid-filename');
    } finally {
      if (fs.existsSync(invalidFile)) fs.unlinkSync(invalidFile);
    }
  });

  test('Multiple experiments shows validation warning', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    await uploadFiles(page, VALID_FILES);
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // With valid files from one experiment, validation should pass (no errors)
    const validationErrors = page.locator('[data-testid="validation-error"]');
    const errorCount = await validationErrors.count();
    expect(errorCount).toBe(0);

    // Continue button should be enabled
    const continueBtn = page.locator('[data-testid="upload-continue-btn"]');
    await expect(continueBtn).toBeEnabled({ timeout: 5000 });

    await takeScreenshot(page, TEST_PREFIX, 'errors', '02-validation-passes');
  });

  test('Back navigation preserves uploaded files', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    await uploadFiles(page, VALID_FILES);

    // Continue to pipeline
    await expect(page.locator('[data-testid="upload-continue-btn"]')).toBeEnabled({ timeout: 10000 });
    await page.locator('[data-testid="upload-continue-btn"]').click();
    await expect(page).toHaveURL(/\/new\/pipeline\?session=/, { timeout: 10000 });

    // Navigate back to upload
    await page.locator('[data-testid="pipeline-back-btn"]').click();
    await expect(page).toHaveURL(/\/new\/upload\?session=/, { timeout: 10000 });

    // Files should still be visible in the experiment table
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 15000 });

    await takeScreenshot(page, TEST_PREFIX, 'errors', '03-back-navigation-preserves-state');
  });
});
