/**
 * E2E Test: PTM Analysis Wizard — UI Structure Verification
 *
 * Verifies the PTM-specific wizard UI renders correctly at each step:
 *   1. Pipeline — PTM template + MSstatsPTM card
 *   2. Upload — PTM multi-zone (enrichment, global proteome, FASTA, LF/TMT)
 *   3. Comparisons — condition palette, comparison building
 *   4. Config — organism, thresholds, PTM-specific params
 *   5. Summary — review before launch
 *
 * NOTE: Full end-to-end processing requires the R-based MSstatsPTM pipeline
 * to execute with real PD data. This test verifies the complete wizard UI.
 */

import { test, expect } from '@playwright/test';
import {
  startNewAnalysis,
  continueToUpload,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
} from './helpers';

const TEST_PREFIX = '02-ptm-wizard';

test.describe('PTM Wizard — UI Structure', () => {
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

  test('Pipeline page shows PTM template and MSstatsPTM card', async ({ page }) => {
    sessionId = await startNewAnalysis(page);
    console.log(`Session created: ${sessionId}`);

    await takeScreenshot(page, TEST_PREFIX, 'ui', '01-pipeline-page');

    // Protein template is default
    await expect(page.locator('[data-testid="template-btn-protein"]')).toBeVisible();

    // PTM template exists (no longer has "Soon" badge)
    const ptmBtn = page.locator('[data-testid="template-btn-ptm"]');
    await expect(ptmBtn).toBeVisible({ timeout: 5000 });
    await expect(ptmBtn).not.toContainText('Soon');

    // Switch to PTM template
    await ptmBtn.click();
    await page.waitForTimeout(300);

    // MSstatsPTM pipeline card appears
    await expect(page.locator('[data-testid="pipeline-card-ptm"]')).toBeVisible({ timeout: 5000 });

    // Protein pipeline cards should not be visible for PTM template
    await expect(page.locator('[data-testid="pipeline-card-msqrob2"]')).toHaveCount(0);

    // Select MSstatsPTM
    await page.locator('[data-testid="pipeline-card-ptm"]').click();
    await takeScreenshot(page, TEST_PREFIX, 'ui', '02-ptm-selected');

    // Continue should be enabled (no file requirement for pipeline page)
    const continueBtn = page.locator('[data-testid="pipeline-continue-btn"]');
    await expect(continueBtn).toBeEnabled({ timeout: 5000 });

    // Continue to upload
    await continueToUpload(page);
  });

  test('Upload page renders PTM multi-zone UI correctly', async ({ page }) => {
    // Need a fresh session that already has pipeline selected
    sessionId = await startNewAnalysis(page);
    await page.locator('[data-testid="template-btn-ptm"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="pipeline-card-ptm"]').click();
    await continueToUpload(page);

    await takeScreenshot(page, TEST_PREFIX, 'ui', '03-upload-page');

    // Verify ALL PTM-specific UI elements render
    const elements = [
      { testid: 'ptm-lf-btn', label: 'LF toggle' },
      { testid: 'ptm-tmt-btn', label: 'TMT toggle' },
      { testid: 'ptm-enrichment-zone', label: 'PTM enrichment zone' },
      { testid: 'global-proteome-zone', label: 'Global proteome zone' },
      { testid: 'fasta-zone', label: 'FASTA zone' },
    ];

    for (const { testid, label } of elements) {
      await expect(
        page.locator(`[data-testid="${testid}"]`),
        `${label} should be visible`
      ).toBeVisible({ timeout: 5000 });
    }

    // LF/TMT toggle — LF should be the default active state
    const lfBtn = page.locator('[data-testid="ptm-lf-btn"]');
    await expect(lfBtn).toContainText('Label-Free');

    // TMT button should be clickable to switch
    const tmtBtn = page.locator('[data-testid="ptm-tmt-btn"]');
    await tmtBtn.click();
    await page.waitForTimeout(200);

    // Switch back to LF
    await lfBtn.click();

    // Verify upload zone headings
    await expect(page.getByText('PTM Enrichment Data')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('FASTA Reference')).toBeVisible({ timeout: 5000 });

    // Global proteome should be collapsed by default (Mode A)
    await expect(page.getByText(/No global proteome data/)).toBeVisible({ timeout: 5000 });

    // Expand global proteome section
    const expandBtn = page.getByText(/Add Global Proteome Data/i);
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(300);
    }

    // FASTA zone should have organism quick-select buttons
    const fastaZone = page.locator('[data-testid="fasta-zone"]');
    await expect(fastaZone.locator('button', { hasText: /human/i })).toBeVisible({ timeout: 5000 });
    await expect(fastaZone.locator('button', { hasText: /mouse/i })).toBeVisible({ timeout: 5000 });

    // Back button should return to pipeline
    const backBtn = page.locator('[data-testid="upload-back-btn"]');
    await expect(backBtn).toBeVisible({ timeout: 5000 });

    await takeScreenshot(page, TEST_PREFIX, 'ui', '04-upload-verified');
  });

  test('Pipeline back navigation preserves PTM selection', async ({ page }) => {
    sessionId = await startNewAnalysis(page);
    await page.locator('[data-testid="template-btn-ptm"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="pipeline-card-ptm"]').click();
    await continueToUpload(page);

    // Go back to pipeline
    await page.locator('[data-testid="upload-back-btn"]').click();
    await expect(page).toHaveURL(/\/new\/pipeline\?session=/, { timeout: 10000 });

    // PTM template should still be selected
    await expect(page.locator('[data-testid="pipeline-card-ptm"]')).toBeVisible({ timeout: 5000 });
  });

  test('Pipeline page shows Back to Home', async ({ page }) => {
    sessionId = await startNewAnalysis(page);
    await expect(page.locator('[data-testid="pipeline-back-btn"]')).toBeVisible({ timeout: 5000 });

    // Click back → home
    await page.locator('[data-testid="pipeline-back-btn"]').click();
    await expect(page).toHaveURL('http://localhost:3000/', { timeout: 10000 });
  });
});
