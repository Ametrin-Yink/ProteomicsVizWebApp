/**
 * E2E Test 01: New Analysis Wizard — Happy Path
 *
 * Full journey through the 3-step wizard with msqrob2 pipeline:
 *   1. Upload & Setup → 2. Pipeline → 3. Configure → Start → Results
 *
 * Uses 6 PSM CSV files (2 conditions × 3 replicates) from SampleData/.
 */

import { test, expect } from '@playwright/test';
import {
  startNewAnalysis,
  uploadFiles,
  configureExperiment,
  continueToPipeline,
  selectPipeline,
  continueToConfig,
  startAnalysis,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
} from './helpers';
import * as path from 'path';

const TEST_PREFIX = '01-wizard';
const SAMPLE_DATA = path.resolve(__dirname, '..', '..', 'SampleData');

const TEST_FILES = [
  // DMSO_24h — 3 replicates (treatment)
  'PSM_DOCK5Jurkat_DMSO_24h_1.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_2.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_3.csv',
  // INCB224525_24h — 3 replicates (control)
  'PSM_DOCK5Jurkat_INCB224525_24h_1.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_2.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_3.csv',
].map(f => path.join(SAMPLE_DATA, f));

test.describe('New Analysis Wizard — Happy Path', () => {
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

  test('Complete wizard flow with msqrob2 pipeline', async ({ page }) => {
    // === Step 1: Start new analysis ===
    sessionId = await startNewAnalysis(page);
    console.log(`Session created: ${sessionId}`);

    await takeScreenshot(page, TEST_PREFIX, 'wizard', '01-home-after-create');

    // Verify we're on the upload page with wizard step indicator
    await expect(page.locator('[data-testid="wizard-step-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-step-2"]')).toBeVisible();
    await expect(page.locator('[data-testid="wizard-step-3"]')).toBeVisible();

    // === Step 1: Upload files ===
    await uploadFiles(page, TEST_FILES);
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '02-files-uploaded');

    // Verify file table appears
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 10000 });

    // === Step 1: Configure experiment ===
    await configureExperiment(page, {
      treatment: 'DMSO_24h',
      control: 'INCB224525_24h',
      organism: 'human',
      removeRazor: true,
      strictFiltering: false,
    });
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '03-experiment-configured');

    // Verify validation panel shows no errors
    const validationErrors = page.locator('[data-testid="validation-error"]');
    await expect(validationErrors).toHaveCount(0, { timeout: 15000 });

    // Continue to pipeline selection
    await continueToPipeline(page);
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '04-pipeline-page');

    // === Step 2: Select msqrob2 pipeline ===
    await selectPipeline(page, 'msqrob2');
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '05-msqrob2-selected');

    // Verify the card shows selected state
    const msqrob2Card = page.locator('[data-testid="pipeline-card-msqrob2"]');
    await expect(msqrob2Card).toBeVisible();

    // Continue to config
    await continueToConfig(page);
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '06-config-page');

    // === Step 3: Verify config page ===
    // Should show msqrob2 badge, not MSstats params
    await expect(page.getByText('msqrob2 Pipeline')).toBeVisible({ timeout: 5000 });

    // MSstats-specific section should NOT be visible
    const msstatsSection = page.getByText('MSstats Parameters');
    await expect(msstatsSection).toHaveCount(0);

    // Experiment summary should show our config
    await expect(page.getByText('DMSO_24h')).toBeVisible();
    await expect(page.getByText('INCB224525_24h')).toBeVisible();

    await takeScreenshot(page, TEST_PREFIX, 'wizard', '07-config-summary');

    // === Start analysis ===
    // Waits for processing complete + redirect to visualization
    await startAnalysis(page, { waitForCompletion: true, timeout: 600000 });

    // === Verify results page rendered ===
    await expect(page.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 30000 });
    await takeScreenshot(page, TEST_PREFIX, 'wizard', '08-results-volcano');

    console.log('Wizard happy path completed successfully');
  });
});
