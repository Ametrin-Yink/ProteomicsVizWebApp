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
  configureExperiment,
  continueToPipeline,
  selectPipeline,
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

  test('Insufficient replicates blocks validation', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    // Upload only 1 file per condition (need 3 minimum)
    const fewFiles = [VALID_FILES[0], VALID_FILES[3]]; // 1 DMSO + 1 INCB
    await uploadFiles(page, fewFiles);

    // Wait for experiment table and validation panel to fully render
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // Validation panel should show errors about insufficient replicates
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible({ timeout: 15000 });

    await takeScreenshot(page, TEST_PREFIX, 'errors', '02-insufficient-replicates');
  });

  test('Same treatment and control shows validation error', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    await uploadFiles(page, VALID_FILES);
    await page.waitForTimeout(2000);

    // Set both treatment and control to DMSO_24h
    await page.locator('[data-testid="treatment-select"]').selectOption('DMSO_24h');
    await page.locator('[data-testid="control-select"]').selectOption('DMSO_24h');

    await page.waitForTimeout(1000);

    // Should show validation error
    await expect(page.locator('[data-testid="validation-error"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, TEST_PREFIX, 'errors', '03-same-treatment-control');
  });

  test('Continue button disabled without organism selection', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    await uploadFiles(page, VALID_FILES);
    await page.waitForTimeout(2000);

    // Set treatment/control but NOT organism
    await page.locator('[data-testid="treatment-select"]').selectOption('DMSO_24h');
    await page.locator('[data-testid="control-select"]').selectOption('INCB224525_24h');

    await page.waitForTimeout(1000);

    // Continue button should be disabled
    const continueBtn = page.locator('[data-testid="upload-continue-btn"]');
    await expect(continueBtn).toBeDisabled({ timeout: 5000 });

    await takeScreenshot(page, TEST_PREFIX, 'errors', '04-continue-disabled');
  });

  test('Back navigation preserves uploaded files', async ({ page }) => {
    sessionId = await startNewAnalysis(page);

    await uploadFiles(page, VALID_FILES);
    await configureExperiment(page, {
      treatment: 'DMSO_24h',
      control: 'INCB224525_24h',
      organism: 'human',
    });

    // Navigate to pipeline
    await continueToPipeline(page);
    await selectPipeline(page, 'msqrob2');

    // Navigate back to upload
    await page.locator('[data-testid="pipeline-back-btn"]').click();
    await expect(page).toHaveURL(/\/new\/upload\?session=/, { timeout: 10000 });

    // Files should still be visible in the experiment table
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 15000 });

    // Treatment should still be set
    const treatmentSelect = page.locator('[data-testid="treatment-select"]');
    await expect(treatmentSelect).toHaveValue('DMSO_24h');

    await takeScreenshot(page, TEST_PREFIX, 'errors', '05-back-navigation-preserves-state');
  });
});
