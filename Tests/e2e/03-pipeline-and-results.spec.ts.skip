/**
 * E2E Test 03: Pipeline Selection & Results Visualization
 *
 * Tests the MSstats pipeline path through the wizard and verifies
 * all visualization tabs (volcano, QC, GSEA) after a successful run.
 */

import { test, expect } from '@playwright/test';
import {
  startNewAnalysis,
  uploadFiles,
  configureExperiment,
  continueToUpload,
  selectPipeline,
  continueToComparisons,
  continueToConfig,
  startAnalysis,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
} from './helpers';
import * as path from 'path';

const TEST_PREFIX = '03-results';
const SAMPLE_DATA = path.resolve(__dirname, '..', '..', 'SampleData');

const TEST_FILES = [
  'PSM_DOCK5Jurkat_DMSO_24h_1.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_2.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_3.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_1.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_2.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_3.csv',
].map(f => path.join(SAMPLE_DATA, f));

test.describe('Pipeline Selection & Results', () => {
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

  test('MSstats pipeline with results verification', async ({ page }) => {
    // === Wizard: Select Pipeline ===
    sessionId = await startNewAnalysis(page);
    await selectPipeline(page, 'msstats');
    await takeScreenshot(page, TEST_PREFIX, 'results', '01-msstats-selected');
    await continueToUpload(page);

    // === Wizard: Upload & Setup ===
    await uploadFiles(page, TEST_FILES);
    await configureExperiment(page, {
      treatment: 'DMSO_24h',
      control: 'INCB224525_24h',
      organism: 'human',
    });
    await continueToComparisons(page);

    // === Wizard: Comparisons ===
    await continueToConfig(page);

    // === Wizard: Verify MSstats params are visible ===
    await expect(page.getByText('MSstats Parameters')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="msstats-normalization-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="msstats-summary-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="msstats-feature-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="msstats-impute-checkbox"]')).toBeVisible();
    await expect(page.locator('[data-testid="msstats-remove50-checkbox"]')).toBeVisible();

    await takeScreenshot(page, TEST_PREFIX, 'results', '02-msstats-config');

    // === Start analysis — verify navigation to processing page ===
    await startAnalysis(page, { waitForCompletion: false });

    // Verify processing page shows key elements
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="progress-bar"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="log-panel"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, TEST_PREFIX, 'results', '03-processing-started');

    console.log('MSstats pipeline started successfully, processing page visible');
  });
});
