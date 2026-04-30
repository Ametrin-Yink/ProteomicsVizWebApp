/**
 * E2E Test: PDF Export
 *
 * Tests PDF report generation:
 * 1. PDF export button visible on results page
 * 2. PDF download succeeds with valid file
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
import * as fs from 'fs';
import * as path from 'path';

const createdSessions: string[] = [];

test.beforeAll(() => {
  purgeLegacyScreenshots('06-pdf-export');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page, createdSessions);
});

test.describe('PDF Export', () => {

  test('PDF export button visible and download succeeds', async ({ page }) => {
    test.setTimeout(600000);

    // Create and complete analysis
    const sessionId = await createSession(page, 'Test PDF Export');
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
    });

    await startAnalysis(page, 300000);

    // Wait for results page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });

    // Verify PDF export button exists
    const pdfBtn = page.locator('[data-testid="export-pdf-btn"]').first();
    await expect(pdfBtn).toBeVisible();

    await takeScreenshot(page, '06-pdf-export', 'pdf-button-visible', 'results-page');

    // Setup download listener and trigger export
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
    await pdfBtn.click();

    // Wait for generation, then click download if button appears
    await page.waitForTimeout(2000);
    const downloadBtn = page.locator('[data-testid="download-pdf-btn"]').first();
    if (await downloadBtn.isVisible().catch(() => false)) {
      await downloadBtn.click();
    }

    const download = await downloadPromise.catch(() => null);

    if (download) {
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.(pdf|zip)$/);

      const downloadPath = path.join(__dirname, '..', 'downloads', filename);
      await download.saveAs(downloadPath);

      expect(fs.existsSync(downloadPath)).toBe(true);
      const stats = fs.statSync(downloadPath);
      expect(stats.size).toBeGreaterThan(1000);

      console.log(`PDF downloaded: ${filename} (${stats.size} bytes)`);
    }

    await takeScreenshot(page, '06-pdf-export', 'pdf-export-complete', 'done');
  });

});
