import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test('debug PDF iframe capture', async ({ page }) => {
  test.setTimeout(300000);

  // Capture browser console output
  page.on('console', msg => {
    console.log(`BROWSER: ${msg.type()}: ${msg.text()}`);
  });

  // Intercept the PDF generation request to log the payload
  let requestBody: any = null;
  await page.route('**/api/sessions/*/reports/generate', async (route) => {
    const request = route.request();
    requestBody = request.postDataJSON();
    await route.continue();
  });

  // Navigate to existing session's visualization page
  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');

  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Verify volcano plot is visible
  const volcanoContainer = page.locator('[data-testid="volcano-plot"]');
  await expect(volcanoContainer).toBeVisible({ timeout: 15000 });

  // Check if Plotly is available
  const hasPlotly = await page.evaluate(() => typeof (window as any).Plotly !== 'undefined');
  console.log('Plotly available on main page:', hasPlotly);

  // Check if the volcano plot has the .js-plotly-plot element
  const hasPlotlyPlot = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="volcano-plot"] .js-plotly-plot');
    return el !== null;
  });
  console.log('Volcano plot has .js-plotly-plot:', hasPlotlyPlot);

  console.log('Clicking Export PDF...');

  // Setup download listener
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });

  // Click Export PDF
  const pdfBtn = page.locator('[data-testid="export-pdf-btn"]').first();
  await expect(pdfBtn).toBeVisible();
  await pdfBtn.click();

  // Wait for generation to complete
  console.log('Waiting for PDF generation...');
  await expect(page.locator('[data-testid="download-pdf-btn"]')).toBeVisible({ timeout: 180000 });

  console.log('Request body captured:');
  console.log('  Keys:', Object.keys(requestBody || {}));
  const images = (requestBody?.images || {}) as Record<string, unknown>;
  console.log('  Image keys:', Object.keys(images));
  for (const [key, value] of Object.entries(images)) {
    const arr = value as string[] | null;
    const size = arr?.length || 0;
    const firstLen = arr?.[0]?.length || 0;
    console.log(`  ${key}: ${size} images, first length: ${firstLen}`);
  }

  // Click download
  const downloadBtn = page.locator('[data-testid="download-pdf-btn"]');
  await downloadBtn.click();

  const download = await downloadPromise;
  const downloadPath = path.join(__dirname, '..', 'downloads', download.suggestedFilename());
  await download.saveAs(downloadPath);

  const stats = fs.statSync(downloadPath);
  console.log(`File size: ${stats.size} bytes`);

  // Take screenshot
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'debug-pdf-capture.png') });
});
