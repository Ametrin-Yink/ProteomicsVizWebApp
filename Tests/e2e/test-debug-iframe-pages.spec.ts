import { test, expect } from '@playwright/test';

test('debug iframe QC page loading', async ({ page }) => {
  test.setTimeout(120000);

  // 1. Test loading QC page in main browser first
  console.log('Loading QC page directly...');
  await page.goto('http://localhost:3000/analysis/visualization/qc?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  // Check for PCA plot
  const pcaPlot = page.locator('[data-testid="pca-plot"]');
  const pcaVisible = await pcaPlot.isVisible().catch(() => false);
  console.log('PCA plot visible:', pcaVisible);

  if (pcaVisible) {
    // Check if Plotly rendered it
    const hasPlotlyEl = await pcaPlot.locator('.js-plotly-plot').first().isVisible().catch(() => false);
    console.log('PCA has .js-plotly-plot:', hasPlotlyEl);
  }

  // Check for p-value plot
  const pvalPlot = page.locator('[data-testid="pvalue-plot"]');
  const pvalVisible = await pvalPlot.isVisible().catch(() => false);
  console.log('P-value plot visible:', pvalVisible);

  // Take screenshot
  await page.screenshot({ path: 'Tests/screenshots/debug-qc-page.png' });

  // 2. Now test the Results page (main visualization)
  console.log('\nLoading Results page...');
  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Check for volcano plot
  const volcanoPlot = page.locator('[data-testid="volcano-plot"]');
  const volcanoVisible = await volcanoPlot.isVisible().catch(() => false);
  console.log('Volcano plot visible:', volcanoVisible);

  if (volcanoVisible) {
    const hasPlotlyEl = await volcanoPlot.locator('.js-plotly-plot').first().isVisible().catch(() => false);
    console.log('Volcano has .js-plotly-plot:', hasPlotlyEl);
  }

  // Check if Plotly is available
  const hasPlotly = await page.evaluate(() => typeof (window as any).Plotly !== 'undefined');
  console.log('Plotly available:', hasPlotly);

  await page.screenshot({ path: 'Tests/screenshots/debug-results-page.png' });
});
