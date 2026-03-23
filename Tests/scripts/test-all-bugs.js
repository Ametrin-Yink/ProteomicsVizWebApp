/**
 * Comprehensive bug verification test
 * Tests all reported bugs in the ProteomicsViz web app
 */

const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Starting comprehensive bug verification tests...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Browser console error:', msg.text());
    }
  });

  try {
    // Test 1: Check Results page - Protein Info with multiple UniProt IDs
    console.log('=== Test 1: Results Page - Multiple UniProt IDs Gene Names ===');
    await page.goto('http://localhost:3000/analysis/visualization?session_id=9d7d958f-98f5-4129-b770-dc8a77c3c526');
    await page.waitForLoadState('networkidle');
    await sleep(3000);

    // Take screenshot of results page
    await page.screenshot({ path: 'test-results/01-results-page.png', fullPage: true });

    // Click on a protein with multiple UniProt IDs (if volcano plot is clickable)
    try {
      const plotPoint = await page.locator('.scatterlayer .trace .point').first();
      if (await plotPoint.isVisible().catch(() => false)) {
        await plotPoint.click();
        await sleep(1000);
        await page.screenshot({ path: 'test-results/02-protein-selected.png', fullPage: true });

        // Check protein info panel
        const proteinInfo = await page.locator('[data-testid="protein-info-panel"]').textContent();
        console.log('Protein info panel content:', proteinInfo?.substring(0, 500));

        // Check if multiple gene names are displayed
        const geneNames = await page.locator('[data-testid="gene-name"]').textContent();
        console.log('Gene names displayed:', geneNames);
      }
    } catch (e) {
      console.log('Could not interact with volcano plot:', e.message);
    }

    // Test 2: Check QC Plots page
    console.log('\n=== Test 2: QC Plots Page ===');
    await page.goto('http://localhost:3000/analysis/visualization/qc?session_id=9d7d958f-98f5-4129-b770-dc8a77c3c526');
    await page.waitForLoadState('networkidle');
    await sleep(3000);
    await page.screenshot({ path: 'test-results/03-qc-plots.png', fullPage: true });

    // Check QC Summary Statistics
    const qcSummary = await page.locator('[data-testid="qc-summary-panel"]').textContent().catch(() => 'Not found');
    console.log('QC Summary:', qcSummary?.substring(0, 300));

    // Test 3: Check Bioinformatics page
    console.log('\n=== Test 3: Bioinformatics Page ===');
    await page.goto('http://localhost:3000/analysis/visualization/bioinformatics?session_id=9d7d958f-98f5-4129-b770-dc8a77c3c526');
    await page.waitForLoadState('networkidle');
    await sleep(3000);
    await page.screenshot({ path: 'test-results/04-bioinformatics.png', fullPage: true });

    // Check for errors
    const errorText = await page.locator('text=/error/i').textContent().catch(() => null);
    if (errorText) {
      console.log('Error found on bioinformatics page:', errorText);
    } else {
      console.log('No errors found on bioinformatics page');
    }

    // Test 4: Check Session Manager visibility
    console.log('\n=== Test 4: Session Manager Visibility ===');
    const sessionPanel = await page.locator('[data-testid="session-panel"]').isVisible().catch(() => false);
    console.log('Session manager visible on bioinformatics page:', sessionPanel);

    await page.goto('http://localhost:3000/analysis/visualization?session_id=9d7d958f-98f5-4129-b770-dc8a77c3c526');
    await page.waitForLoadState('networkidle');
    const sessionPanel2 = await page.locator('[data-testid="session-panel"]').isVisible().catch(() => false);
    console.log('Session manager visible on results page:', sessionPanel2);

    await page.goto('http://localhost:3000/analysis/visualization/qc?session_id=9d7d958f-98f5-4129-b770-dc8a77c3c526');
    await page.waitForLoadState('networkidle');
    const sessionPanel3 = await page.locator('[data-testid="session-panel"]').isVisible().catch(() => false);
    console.log('Session manager visible on QC page:', sessionPanel3);

    console.log('\n=== All tests completed ===');
    console.log('Screenshots saved in test-results/ directory');

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

runTests();
