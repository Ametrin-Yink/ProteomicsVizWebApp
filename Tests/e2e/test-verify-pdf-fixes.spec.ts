import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('verify PDF report fixes', async ({ page }) => {
  test.setTimeout(300000);

  // Intercept PDF generation request
  let requestBody: any = null;
  await page.route('**/api/sessions/*/reports/generate', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.continue();
  });

  // Navigate to session
  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Verify volcano plot
  await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible({ timeout: 15000 });

  // Click Export PDF
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await page.locator('[data-testid="export-pdf-btn"]').first().click();
  await expect(page.locator('[data-testid="download-pdf-btn"]')).toBeVisible({ timeout: 180000 });

  // Check image capture
  const images = (requestBody?.images || {}) as Record<string, unknown>;
  console.log('Captured image keys:', Object.keys(images).sort());
  for (const [key, val] of Object.entries(images)) {
    const arr = val as string[] | null;
    console.log(`  ${key}: ${arr?.length || 0} images (${(arr?.[0]?.length || 0)} chars)`);
  }

  // Download
  await page.locator('[data-testid="download-pdf-btn"]').click();
  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, '..', 'downloads', download.suggestedFilename());
  await download.saveAs(downloadPath);

  const stats = fs.statSync(downloadPath);
  console.log(`PDF size: ${(stats.size / 1024).toFixed(1)} KB`);
  expect(stats.size).toBeGreaterThan(100000); // At least 100KB with images
});
