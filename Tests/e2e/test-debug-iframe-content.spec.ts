import { test, expect } from '@playwright/test';

test('debug iframe content and Plotly availability', async ({ page }) => {
  test.setTimeout(120000);

  // Navigate to results page first
  await page.goto('http://localhost:3000/analysis/visualization?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Create a QC iframe using page.evaluate
  const iframeInfo = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;';
      iframe.src = `${window.location.origin}/analysis/visualization/qc?session_id=373b1e4d-4dd7-47cf-b0e7-e11a00723b2b`;
      document.body.appendChild(iframe);

      iframe.onload = async () => {
        // Wait for React to render
        await new Promise(r => setTimeout(r, 10000));

        const doc = iframe.contentDocument;
        const win = iframe.contentWindow as any;

        const pcaPlot = doc?.querySelector('[data-testid="pca-plot"]');
        const pvaluePlot = doc?.querySelector('[data-testid="pvalue-plot"]');
        const hasPlotlyInWin = typeof win?.Plotly !== 'undefined';

        // Check if Plotly elements exist
        const pcaHasPlotly = pcaPlot?.querySelector('.js-plotly-plot') !== null;
        const pvalHasPlotly = pvaluePlot?.querySelector('.js-plotly-plot') !== null;

        // Try to capture
        let pcaImage: string | null = null;
        if (pcaHasPlotly && hasPlotlyInWin) {
          try {
            pcaImage = (await win.Plotly.toImage(pcaPlot.querySelector('.js-plotly-plot'), {
              format: 'png', width: 1200, height: 800, scale: 1
            })).slice(0, 60);
          } catch (e: any) {
            pcaImage = `ERROR: ${e.message}`;
          }
        }

        // Check body content
        const bodyText = doc?.body?.innerText?.slice(0, 200) || 'EMPTY BODY';

        resolve({
          hasContentDocument: !!doc,
          bodyText,
          hasPlotlyInWin,
          pcaPlotExists: !!pcaPlot,
          pvaluePlotExists: !!pvaluePlot,
          pcaHasPlotly,
          pvalHasPlotly,
          pcaImage,
        });
      };

      setTimeout(() => resolve({ error: 'timeout' }), 60000);
    });
  });

  console.log('Iframe info:', JSON.stringify(iframeInfo, null, 2));
  await page.screenshot({ path: 'Tests/screenshots/debug-iframe-iframe.png' });
});
