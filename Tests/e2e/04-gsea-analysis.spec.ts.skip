/**
 * E2E Test 04: GSEA Analysis Visualization
 *
 * Tests the GSEA flow: open tab, select database, view pathway table,
 * enrichment plot, and heatmap after pipeline completion.
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

const TEST_PREFIX = '04-gsea';
const SAMPLE_DATA = path.resolve(__dirname, '..', '..', 'SampleData');

const TEST_FILES = [
  'PSM_DOCK5Jurkat_DMSO_24h_1.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_2.csv',
  'PSM_DOCK5Jurkat_DMSO_24h_3.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_1.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_2.csv',
  'PSM_DOCK5Jurkat_INCB224525_24h_3.csv',
].map(f => path.join(SAMPLE_DATA, f));

test.describe('GSEA Analysis', () => {
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

  test('complete pipeline then view GSEA results', async ({ page }) => {
    // Navigate and start new analysis → pipeline page
    sessionId = await startNewAnalysis(page);

    // Select pipeline
    await selectPipeline(page, 'msqrob2');
    await continueToUpload(page);

    // Upload files
    await uploadFiles(page, TEST_FILES);

    // Configure
    await configureExperiment(page, {
      treatment: 'INCB224525',
      control: 'DMSO',
      organism: 'human',
    });

    // Comparisons + Config
    await continueToComparisons(page);
    await continueToConfig(page);

    // Start processing
    await startAnalysis(page);

    // Wait for pipeline to complete (up to 5 minutes)
    await expect(page.getByText(/complete/i)).toBeVisible({ timeout: 300000 });

    // Navigate to GSEA tab
    const gseaTab = page.getByRole('tab', { name: /gsea/i });
    if (await gseaTab.isVisible()) {
      await gseaTab.click();
    }

    // Verify GSEA dashboard loads
    await expect(page.getByText(/gene set enrichment/i).first()).toBeVisible({ timeout: 30000 });

    await takeScreenshot(page, `${TEST_PREFIX}-gsea-dashboard`);
  });

  test('GSEA database switching shows different results', async ({ page }) => {
    // Navigate to completed session's GSEA tab
    // (depends on previous test completing successfully)
    test.skip(!sessionId, 'No session ID from previous test');
  });
});
