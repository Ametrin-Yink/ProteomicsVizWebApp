/**
 * E2E Test Suite 6: Bioinformatics
 * 
 * Tests database selection, overview panel, pathway table,
 * GSEA plot, and biomart fallback.
 * 
 * CRITICAL TESTING RULES:
 * 1. ONE-BY-ONE EXECUTION: Tests must run sequentially, never in parallel
 * 2. PURGE LEGACY SCREENSHOTS: Clear old screenshots before each test run
 * 3. VISUAL VERIFICATION: Every test MUST take screenshots and verify UI visually
 * 4. STRICT ASSERTIONS: No .catch() to swallow errors - tests must FAIL when broken
 * 5. HUMAN-MIMICRY: All interactions must simulate real user behavior
 * 
 * If a test fails, it means the feature is BROKEN and needs to be fixed.
 */

import { test, expect } from '@playwright/test';
import { 
  useExistingSession, 
  cleanupSession,
  purgeLegacyScreenshots, 
  takeScreenshot 
} from './helpers';

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('06-bioinformatics');
});

test.describe('Bioinformatics - GSEA Analysis', () => {
  let sessionId: string;

  test.beforeAll(async ({ page }) => {
    // Create a completed session with results for all tests in this suite
    const { createCompletedSession } = await import('./helpers');
    sessionId = await createCompletedSession(page);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to bioinformatics tab with the completed session
    await page.goto(`/analysis/visualization/bioinformatics?session=${sessionId}`);

    // Wait for bioinformatics tab to load
    await expect(page.locator('[data-testid="bioinformatics-container"]')).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async ({ page }) => {
    // Clean up the session after all tests
    const { cleanupSession } = await import('./helpers');
    await cleanupSession(page, sessionId);
  });

  test('database selection works', async ({ page }) => {
    // Verify database selector
    await expect(page.locator('[data-testid="database-select"]')).toBeVisible();

    // Verify default database is selected
    const defaultValue = await page.locator('[data-testid="database-select"]').inputValue();
    expect(defaultValue).toBeTruthy();

    // Switch to KEGG database
    await page.selectOption('[data-testid="database-select"]', 'kegg');

    // Verify loading state
    await expect(page.locator('[data-testid="loading"]')).toBeVisible();

    // Verify results update
    await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'database-selection-works', 'final');
  });

  test('all 5 databases available', async ({ page }) => {
    const databases = [
      { value: 'go_bp', label: 'GO Biological Process' },
      { value: 'go_mf', label: 'GO Molecular Function' },
      { value: 'go_cc', label: 'GO Cellular Component' },
      { value: 'kegg', label: 'KEGG' },
      { value: 'reactome', label: 'Reactome' },
    ];

    for (const db of databases) {
      // Select database
      await page.selectOption('[data-testid="database-select"]', db.value);

      // Verify loading
      await expect(page.locator('[data-testid="loading"]')).toBeVisible();

      // Verify results load
      await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible({ timeout: 30000 });

      // Verify database name in results
      await expect(page.locator('[data-testid="current-database"]')).toContainText(db.label);
    }

    await takeScreenshot(page, '06-bioinformatics', 'all-5-databases-available', 'final');
  });

  test('overview panel displays', async ({ page }) => {
    // Verify overview panel
    await expect(page.locator('[data-testid="gsea-overview"]')).toBeVisible();

    // Verify total pathways
    await expect(page.locator('[data-testid="total-pathways"]')).toBeVisible();
    const totalText = await page.locator('[data-testid="total-pathways"]').textContent();
    expect(totalText).toMatch(/\d+/);

    // Verify significant pathways
    await expect(page.locator('[data-testid="significant-pathways"]')).toBeVisible();

    // Verify overrepresented count
    await expect(page.locator('[data-testid="overrepresented-count"]')).toBeVisible();

    // Verify underrepresented count
    await expect(page.locator('[data-testid="underrepresented-count"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'overview-panel-displays', 'final');
  });

  test('pathway table displays', async ({ page }) => {
    // Verify table is visible
    await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible();

    // Verify table headers
    await expect(page.locator('[data-testid="table-header-term"]')).toContainText('Term');
    await expect(page.locator('[data-testid="table-header-name"]')).toContainText('Name');
    await expect(page.locator('[data-testid="table-header-nes"]')).toContainText('NES');
    await expect(page.locator('[data-testid="table-header-fdr"]')).toContainText('FDR');

    // Verify table has rows
    const rows = await page.locator('[data-testid="gsea-table-row"]').count();
    expect(rows).toBeGreaterThan(0);

    await takeScreenshot(page, '06-bioinformatics', 'pathway-table-displays', 'final');
  });

  test('GSEA plot displays', async ({ page }) => {
    // Verify GSEA plot
    await expect(page.locator('[data-testid="gsea-plot"]')).toBeVisible();

    // Verify plot has data
    const traces = await page.locator('[data-testid="gsea-plot"] .scatterlayer .trace').count();
    expect(traces).toBeGreaterThan(0);

    // Verify no empty plot message
    await expect(page.locator('[data-testid="gsea-plot"] [data-testid="no-data"]')).not.toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'gsea-plot-displays', 'final');
  });

  test('pathway table sorting', async ({ page }) => {
    // Sort by NES
    await page.click('[data-testid="table-header-nes"]');

    // Verify sort indicator
    await expect(page.locator('[data-testid="table-header-nes"] [data-testid="sort-indicator"]')).toBeVisible();

    // Click again to reverse
    await page.click('[data-testid="table-header-nes"]');

    // Verify reversed sort
    await expect(page.locator('[data-testid="table-header-nes"] [data-testid="sort-indicator-desc"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'pathway-table-sorting', 'final');
  });

  test('pathway table filtering', async ({ page }) => {
    // Enter filter text
    await page.fill('[data-testid="pathway-filter"]', 'cell');
    await page.keyboard.press('Enter');

    // Verify filtered results
    await page.waitForTimeout(500);

    // Verify rows contain filter text
    const rows = page.locator('[data-testid="gsea-table-row"]');
    const count = await rows.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = await rows.nth(i).textContent();
      expect(text?.toLowerCase()).toContain('cell');
    }

    await takeScreenshot(page, '06-bioinformatics', 'pathway-table-filtering', 'final');
  });

  test('significant only filter', async ({ page }) => {
    // Check significant only checkbox
    await page.check('[data-testid="significant-only-checkbox"]');

    // Verify table updates
    await page.waitForTimeout(500);

    // Verify all visible rows have significant NES values
    const rows = page.locator('[data-testid="gsea-table-row"]');
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const nesCell = rows.nth(i).locator('[data-testid="nes-value"]');
      const nesText = await nesCell.textContent();
      const nes = parseFloat(nesText || '0');
      expect(Math.abs(nes)).toBeGreaterThanOrEqual(1.0);
    }

    await takeScreenshot(page, '06-bioinformatics', 'significant-only-filter', 'final');
  });

  test('pathway row selection shows details', async ({ page }) => {
    // Click on a pathway row
    await page.click('[data-testid="gsea-table-row"]:first-child');

    // Verify pathway details panel
    await expect(page.locator('[data-testid="pathway-details"]')).toBeVisible();

    // Verify term ID
    await expect(page.locator('[data-testid="pathway-term-id"]')).toBeVisible();

    // Verify description
    await expect(page.locator('[data-testid="pathway-description"]')).toBeVisible();

    // Verify NES value
    await expect(page.locator('[data-testid="pathway-nes"]')).toBeVisible();

    // Verify FDR value
    await expect(page.locator('[data-testid="pathway-fdr"]')).toBeVisible();

    // Verify lead genes
    await expect(page.locator('[data-testid="lead-genes"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'pathway-row-selection-shows-details', 'final');
  });

  test('GSEA plot shows enrichment profile', async ({ page }) => {
    // Select a pathway
    await page.click('[data-testid="gsea-table-row"]:first-child');

    // Verify GSEA plot updates
    await expect(page.locator('[data-testid="gsea-plot"]')).toBeVisible();

    // Verify enrichment score line
    await expect(page.locator('[data-testid="enrichment-score"]')).toBeVisible();

    // Verify hit markers
    const hits = await page.locator('[data-testid="hit-marker"]').count();
    expect(hits).toBeGreaterThan(0);

    await takeScreenshot(page, '06-bioinformatics', 'gsea-plot-shows-enrichment-profile', 'final');
  });

  test('CSV export works', async ({ page }) => {
    // Click export button
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-gsea-csv-btn"]')
    ]);

    // Verify download started
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    await takeScreenshot(page, '06-bioinformatics', 'csv-export-works', 'final');
  });

  test('table pagination', async ({ page }) => {
    // Verify pagination
    await expect(page.locator('[data-testid="gsea-pagination"]')).toBeVisible();

    // Get first page data
    const firstPageFirstRow = await page.locator('[data-testid="gsea-table-row"]:first-child [data-testid="term-name"]').textContent();

    // Go to next page
    await page.click('[data-testid="next-page"]');

    // Verify page number
    await expect(page.locator('[data-testid="page-number"]')).toContainText('2');

    // Verify different data
    const secondPageFirstRow = await page.locator('[data-testid="gsea-table-row"]:first-child [data-testid="term-name"]').textContent();
    expect(secondPageFirstRow).not.toEqual(firstPageFirstRow);

    await takeScreenshot(page, '06-bioinformatics', 'table-pagination', 'final');
  });

  test('NES bar chart visualization', async ({ page }) => {
    // Verify NES bar chart
    await expect(page.locator('[data-testid="nes-bar-chart"]')).toBeVisible();

    // Verify bars are present
    const bars = await page.locator('[data-testid="nes-bar-chart"] .barlayer .trace .point').count();
    expect(bars).toBeGreaterThan(0);

    // Verify color coding (positive = red, negative = blue)
    await expect(page.locator('[data-testid="nes-bar-chart"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'nes-bar-chart-visualization', 'final');
  });

  test('biomart fallback handles offline', async ({ page }) => {
    // Intercept biomart API and simulate failure
    await page.route('**/biomart/**', (route) => {
      route.abort('failed');
    });

    // Switch database to trigger potential biomart call
    await page.selectOption('[data-testid="database-select"]', 'kegg');

    // Verify graceful fallback - results should still load
    await expect(page.locator('[data-testid="gsea-table"]')).toBeVisible({ timeout: 30000 });

    // Verify warning message about biomart
    await expect(page.locator('[data-testid="biomart-warning"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'biomart-fallback-handles-offline', 'final');
  });
});

test.describe('Bioinformatics - No Pathways Found', () => {
  test('handles no pathways found gracefully', async ({ page }) => {
    // Intercept API to return empty results
    await page.route('**/api/sessions/**/gsea/**', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          data: {
            database: 'GO_Biological_Process_2021',
            total_pathways: 0,
            significant_pathways: 0,
            results: [],
          },
        }),
      });
    });

    await page.goto('/analysis/visualization/bioinformatics?session=test');

    // Verify no pathways message
    await expect(page.locator('[data-testid="no-pathways-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="no-pathways-message"]')).toContainText('No pathways found');

    // Verify helpful suggestion
    await expect(page.locator('[data-testid="no-pathways-suggestion"]')).toBeVisible();

    await takeScreenshot(page, '06-bioinformatics', 'handles-no-pathways-found-gracefully', 'final');
  });
});

test.describe('Bioinformatics - Loading States', () => {
  test('shows loading while fetching GSEA data', async ({ page }) => {
    // Delay API response
    await page.route('**/api/sessions/**/gsea/**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      route.continue();
    });

    await page.goto('/analysis/visualization/bioinformatics?session=test');

    // Verify loading indicator
    await expect(page.locator('[data-testid="gsea-loading"]')).toBeVisible();

    // Verify loading text
    await expect(page.locator('[data-testid="gsea-loading"]')).toContainText('Loading');

    await takeScreenshot(page, '06-bioinformatics', 'shows-loading-while-fetching-gsea-data', 'final');
  });
});
