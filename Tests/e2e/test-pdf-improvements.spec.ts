import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('verify PDF report improvements', async ({ page }) => {
  test.setTimeout(300000);

  let requestBody: any = null;
  await page.route('**/api/sessions/*/reports/generate', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.continue();
  });

  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible({ timeout: 15000 });

  // Snapshot the volcano plot BEFORE export to verify it doesn't change
  const beforeScreenshot = await page.locator('[data-testid="volcano-plot"]').screenshot();

  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await page.locator('[data-testid="export-pdf-btn"]').first().click();
  await expect(page.locator('[data-testid="download-pdf-btn"]')).toBeVisible({ timeout: 180000 });

  // Snapshot the volcano plot AFTER export to verify it wasn't mutated
  const afterScreenshot = await page.locator('[data-testid="volcano-plot"]').screenshot();

  // Check images captured
  const images = (requestBody?.images || {}) as Record<string, unknown>;
  console.log('Image keys:', Object.keys(images).sort().join(', '));

  // Save captured images for visual inspection
  const imgDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(imgDir, { recursive: true });
  for (const [key, val] of Object.entries(images)) {
    const arr = val as string[] | null;
    const dataUrl = arr?.[0] || '';
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    if (base64) {
      fs.writeFileSync(path.join(imgDir, `${key}.png`), Buffer.from(base64, 'base64'));
      console.log(`  ${key}: ${Buffer.from(base64, 'base64').length / 1024} KB -> saved`);
    }
  }

  // Verify volcano plot unchanged
  expect(Buffer.from(afterScreenshot)).toEqual(Buffer.from(beforeScreenshot));
  console.log('Volcano plot unchanged: PASS');

  await page.locator('[data-testid="download-pdf-btn"]').click();
  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, '..', 'downloads', download.suggestedFilename());
  await download.saveAs(downloadPath);

  const stats = fs.statSync(downloadPath);
  console.log(`PDF size: ${(stats.size / 1024).toFixed(1)} KB`);
  expect(stats.size).toBeGreaterThan(100000);
});
