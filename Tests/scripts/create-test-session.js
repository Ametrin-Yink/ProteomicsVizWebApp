/**
 * Script to create a completed session with results for testing
 * This session will persist and can be used by Test Suite 4
 */

const { chromium } = require('@playwright/test');

async function createTestSession() {
  console.log('Creating test session with results...');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Create session
    await page.goto('http://localhost:3000');
    await page.click('[data-testid="template-protein-pairwise"]');
    await page.waitForURL(/\/analysis\?session=/, { timeout: 10000 });

    const url = page.url();
    const sessionId = url.match(/session=([^&]+)/)?.[1];
    console.log(`Session created: ${sessionId}`);

    // Upload files
    const files = [
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_DMSO_1.csv',
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_DMSO_2.csv',
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_DMSO_3.csv',
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_INCZ123456_1.csv',
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_INCZ123456_2.csv',
      'D:\\CodingWorks\\ProteomicsVizWebApp\\SampleData\\PSM_SampleData_INCZ123456_3.csv',
    ];

    for (const file of files) {
      const input = await page.locator('input[type="file"]').first();
      await input.setInputFiles(file);
      await page.waitForTimeout(2000);
    }

    console.log('Files uploaded');

    // Configure analysis
    await page.selectOption('[data-testid="treatment-select"]', 'INCZ123456');
    await page.selectOption('[data-testid="control-select"]', 'DMSO');
    await page.selectOption('[data-testid="organism-select"]', 'human');

    console.log('Analysis configured');

    // Start analysis
    await page.click('[data-testid="start-analysis-btn"]');

    // Wait for completion (up to 5 minutes)
    await page.waitForSelector('[data-testid="processing-complete"]', {
      timeout: 300000,
    });

    console.log('Analysis completed!');
    console.log(`Session ID: ${sessionId}`);
    console.log(`Results URL: http://localhost:3000/analysis/visualization?session=${sessionId}`);

    return sessionId;
  } catch (error) {
    console.error('Failed to create test session:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

createTestSession().catch(console.error);
