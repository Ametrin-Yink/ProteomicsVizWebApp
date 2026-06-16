/**
 * E2E Test: PTM Analysis Workflow
 *
 * Full journey through the wizard with MSstatsPTM pipeline:
 *   1. Pipeline (PTM template + MSstatsPTM)
 *   2. Upload (PTM enrichment files, FASTA, select modifications)
 *   3. Comparisons
 *   4. Config
 *   5. Summary
 *   6. Start -> Processing -> Visualization with PTM tabs
 *
 * Uses PTM enrichment CSV files + FASTA from SampleData/PTM/.
 */

import { test, expect } from '@playwright/test';
import {
  startNewAnalysis,
  configureExperiment,
  continueToUpload,
  continueToComparisons,
  continueToConfig,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
} from './helpers';
import * as path from 'path';
import * as fs from 'fs';

const TEST_PREFIX = '02-ptm-workflow';
const SAMPLE_DATA = path.resolve(__dirname, '..', '..', 'SampleData');
const PTM_DIR = path.join(SAMPLE_DATA, 'PTM');

const PTM_ENRICHMENT_FILES = [
  // DMSO_24h -- 3 replicates (treatment)
  'PTM_DOCK5Jurkat_DMSO_24h_1.csv',
  'PTM_DOCK5Jurkat_DMSO_24h_2.csv',
  'PTM_DOCK5Jurkat_DMSO_24h_3.csv',
  // INCB224525_24h -- 3 replicates (control)
  'PTM_DOCK5Jurkat_INCB224525_24h_1.csv',
  'PTM_DOCK5Jurkat_INCB224525_24h_2.csv',
  'PTM_DOCK5Jurkat_INCB224525_24h_3.csv',
].map(f => path.join(PTM_DIR, f));

const FASTA_FILE = path.join(PTM_DIR, 'test.fasta');

test.describe('PTM Analysis Workflow', () => {
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

  test('Complete PTM wizard flow with MSstatsPTM pipeline', async ({ page }) => {
    // === Step 1: Select Pipeline ===
    sessionId = await startNewAnalysis(page);
    console.log(`Session created: ${sessionId}`);

    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '01-pipeline-page');

    // Select PTM template
    const ptmTemplateBtn = page.locator('[data-testid="template-btn-ptm"]');
    await expect(ptmTemplateBtn).toBeVisible({ timeout: 5000 });
    await ptmTemplateBtn.click();
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '02-ptm-template-selected');

    // Select MSstatsPTM pipeline card
    const ptmCard = page.locator('[data-testid="pipeline-card-ptm"]');
    await expect(ptmCard).toBeVisible({ timeout: 10000 });
    await ptmCard.click();
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '03-msstatsptm-selected');

    // Verify the card shows selected state
    await expect(ptmCard).toBeVisible();

    // Continue to upload
    await continueToUpload(page);
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '04-upload-page');

    // === Step 2: Upload PTM files ===
    // Verify PTM-specific UI elements
    await expect(page.locator('[data-testid="ptm-lf-btn"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="ptm-tmt-btn"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="ptm-enrichment-zone"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="fasta-zone"]')).toBeVisible({ timeout: 5000 });

    // Upload PTM enrichment files one-by-one via the hidden file input inside the enrichment zone
    for (const filePath of PTM_ENRICHMENT_FILES) {
      if (!fs.existsSync(filePath)) throw new Error(`PTM enrichment file not found: ${filePath}`);
      const input = page.locator('[data-testid="ptm-enrichment-zone"] input[type="file"]');
      await input.setInputFiles(filePath, { force: true });
      const fileName = path.basename(filePath);
      await expect(page.locator('[data-testid="ptm-enrichment-zone"]')).toContainText(fileName, { timeout: 15000 });
      await page.waitForTimeout(200);
    }
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '05-ptm-enrichment-uploaded');

    // Wait for detected modifications section to appear
    await expect(
      page.locator('[data-testid="ptm-mod-checkbox-Phosphorylation--STY-"]')
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator('[data-testid="ptm-mod-checkbox-Acetylation--K-"]')
    ).toBeVisible({ timeout: 5000 });
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '06-detected-mods');

    // Select detected modifications to include in analysis
    await page.locator('[data-testid="ptm-mod-checkbox-Phosphorylation--STY-"]').click();
    await page.locator('[data-testid="ptm-mod-checkbox-Acetylation--K-"]').click();

    // Set LF labeling type (explicit click even though it is the default)
    await page.locator('[data-testid="ptm-lf-btn"]').click();

    // Upload FASTA file via the custom upload flow
    if (!fs.existsSync(FASTA_FILE)) throw new Error(`FASTA file not found: ${FASTA_FILE}`);
    // Click "Custom Upload" in the FASTA zone
    const customFastaBtn = page.locator('[data-testid="fasta-zone"]').getByRole('button', { name: /custom upload/i });
    await customFastaBtn.click();
    await page.waitForTimeout(300);
    // Upload via the hidden file input inside the FASTA zone
    const fastaInput = page.locator('[data-testid="fasta-zone"] input[type="file"]');
    await fastaInput.setInputFiles(FASTA_FILE, { force: true });
    // Wait for the upload success indicator (check icon, filename)
    await expect(page.locator('[data-testid="fasta-zone"]')).toContainText('test.fasta', { timeout: 15000 });
    await page.waitForTimeout(500);

    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '07-fasta-uploaded');

    // === Step 3: Comparisons ===
    await continueToComparisons(page);
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '08-comparisons-page');

    // Verify condition cards are visible
    await expect(page.getByText('DMSO_24h')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('INCB224525_24h')).toBeVisible({ timeout: 5000 });

    // Continue to config
    await continueToConfig(page);
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '09-config-page');

    // === Step 4: Configure ===
    await configureExperiment(page, {
      treatment: 'DMSO_24h',
      control: 'INCB224525_24h',
      organism: 'human',
    });
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '10-experiment-configured');

    // Continue to summary
    const configContinueBtn = page.locator('[data-testid="config-continue-btn"]');
    await expect(configContinueBtn).toBeEnabled({ timeout: 5000 });
    await configContinueBtn.click();
    await expect(page).toHaveURL(/\/new\/summary\?session=/, { timeout: 10000 });
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '11-summary-page');

    // === Step 5: Start analysis ===
    const summaryStartBtn = page.locator('[data-testid="summary-start-analysis-btn"]');
    await expect(summaryStartBtn).toBeEnabled({ timeout: 5000 });
    await summaryStartBtn.click();

    // Navigate to processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible({ timeout: 15000 });
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '12-processing');

    // Wait for pipeline processing to complete
    await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout: 600000 });

    // Auto-redirect to visualization page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
    await takeScreenshot(page, TEST_PREFIX, 'ptm-wizard', '13-visualization');

    // === Step 6: Verify PTM-specific results page ===
    // PTM tabs should be visible in the nav bar
    await expect(page.locator('[data-testid="volcano-tab"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="qc-tab"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="site-abundance-tab"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="results-tab"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="bionet-tab"]')).toBeVisible({ timeout: 5000 });

    // Non-PTM tabs (GSEA, Compare, Peptide Abundance) should NOT be present
    await expect(page.locator('[data-testid="gsea-tab"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="compare-tab"]')).toHaveCount(0);

    // Volcano container should render on the default page
    await expect(page.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 15000 });

    console.log('PTM wizard flow completed successfully');
  });
});
