import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('full frontend PDF export with iframe capture', async ({ page }) => {
  test.setTimeout(300000);

  // Navigate to existing session's visualization page
  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');

  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Verify volcano plot is visible (it should be rendered)
  const volcanoContainer = page.locator('[data-testid="volcano-plot"]');
  await expect(volcanoContainer).toBeVisible({ timeout: 15000 });

  console.log('Volcano plot visible, clicking Export PDF...');

  // Setup download listener
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });

  // Click Export PDF
  const pdfBtn = page.locator('[data-testid="export-pdf-btn"]').first();
  await expect(pdfBtn).toBeVisible();
  await pdfBtn.click();

  // Wait for generation to complete and download button to appear
  console.log('Waiting for PDF generation to complete...');
  await expect(page.locator('[data-testid="download-pdf-btn"]')).toBeVisible({ timeout: 180000 });

  console.log('PDF ready, clicking download...');

  // Click download
  const downloadBtn = page.locator('[data-testid="download-pdf-btn"]');
  await downloadBtn.click();

  // Wait for download
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  console.log(`Downloaded: ${filename}`);

  // Save to known location
  const downloadPath = path.join(__dirname, '..', 'downloads', filename);
  await download.saveAs(downloadPath);

  const stats = fs.statSync(downloadPath);
  expect(stats.size).toBeGreaterThan(10000); // At least 10KB
  console.log(`File size: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KB)`);

  // Take screenshot of the page state
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'full-pdf-export.png') });

  console.log('Full PDF export test passed!');
});
