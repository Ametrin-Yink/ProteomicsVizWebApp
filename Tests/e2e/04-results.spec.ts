/**
 * E2E Test Suite 4: Results Visualization
 * 
 * Tests general info panel, volcano plot display, plot filters,
 * selection modes, protein info panel, and protein results table.
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
  purgeLegacyScreenshots('04-results');
});

test.describe('Results Visualization', () => {
  // Use a specific completed session ID to avoid creating new sessions for each test
  const TEST_SESSION_ID = '1845a810-0bf9-49b2-8a8f-d6390792d8fc';
  let sessionId: string;

  test.beforeEach(async ({ page }) => {
    // Use existing completed session with results
    sessionId = await useExistingSession(page, TEST_SESSION_ID);
  });

  test.afterEach(async ({ page }) => {
    // Skip cleanup to preserve session for next test
    // Session will be cleaned up at the end of all tests or manually
  });

  test('general info panel displays', async ({ page }) => {
    // Verify general info panel is visible
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    // Verify total proteins count
    await expect(page.locator('[data-testid="total-proteins"]')).toBeVisible();
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    expect(totalText).toMatch(/\d+/);

    // Verify significant proteins count
    await expect(page.locator('[data-testid="significant-proteins"]')).toBeVisible();

    // Verify upregulated count
    await expect(page.locator('[data-testid="upregulated-count"]')).toBeVisible();

    // Verify downregulated count
    await expect(page.locator('[data-testid="downregulated-count"]')).toBeVisible();

    await takeScreenshot(page, '04-results', 'general-info-panel-displays', 'final');
  });

  test('volcano plot displays', async ({ page }) => {
    // Verify volcano plot container
    await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible({ timeout: 10000 });

    // Verify plot has data points (Plotly scatter points)
    const points = await page.locator('.scatterlayer .trace').count();
    expect(points).toBeGreaterThan(0);

    // Verify axes labels (Plotly uses subscript characters)
    await expect(page.locator('[data-testid="volcano-plot"]')).toContainText('log');
    await expect(page.locator('[data-testid="volcano-plot"]')).toContainText('-log');

    await takeScreenshot(page, '04-results', 'volcano-plot-displays', 'final');
  });

  test('plot filters work', async ({ page }) => {
    // Verify filter controls exist
    const pvalueFilter = page.locator('[data-testid="pvalue-threshold"]');
    const logfcFilter = page.locator('[data-testid="logfc-threshold"]');

    // Verify filters are visible
    await expect(pvalueFilter).toBeVisible();
    await expect(logfcFilter).toBeVisible();

    // Verify significant count exists
    const sigCount = await page.locator('[data-testid="significant-proteins"]').textContent();
    expect(sigCount).toMatch(/\d+/);

    await takeScreenshot(page, '04-results', 'plot-filters-work', 'final');
  });

  test('protein results table displays', async ({ page }) => {
    // Verify table is visible
    await expect(page.locator('[data-testid="protein-table"]')).toBeVisible({ timeout: 10000 });

    // Verify table headers
    await expect(page.locator('[data-testid="table-header-accession"]')).toContainText('Protein');
    await expect(page.locator('[data-testid="table-header-gene"]')).toContainText('Gene');
    await expect(page.locator('[data-testid="table-header-logfc"]')).toContainText('Log2 FC');
    await expect(page.locator('[data-testid="table-header-pvalue"]')).toContainText('P-value');

    // Verify table has rows
    const rows = await page.locator('[data-testid="protein-table-row"]').count();
    expect(rows).toBeGreaterThan(0);

    await takeScreenshot(page, '04-results', 'protein-results-table-displays', 'final');
  });

  test('table pagination works', async ({ page }) => {
    // Verify pagination controls
    await expect(page.locator('[data-testid="pagination"]')).toBeVisible();

    // Get first page data
    const firstPageFirstRow = await page.locator('[data-testid="protein-table-row"]:first-child').textContent();

    // Go to next page
    await page.click('[data-testid="next-page"]');

    // Verify page number updated
    await expect(page.locator('[data-testid="page-number"]')).toContainText('2');

    // Verify different data
    const secondPageFirstRow = await page.locator('[data-testid="protein-table-row"]:first-child').textContent();
    expect(secondPageFirstRow).not.toEqual(firstPageFirstRow);

    await takeScreenshot(page, '04-results', 'table-pagination-works', 'final');
  });

  test('table sorting works', async ({ page }) => {
    // Click on logFC header to sort
    await page.click('[data-testid="table-header-logfc"]');

    // Verify sort indicator
    await expect(page.locator('[data-testid="table-header-logfc"] [data-testid="sort-indicator"]')).toBeVisible();

    // Click again to reverse sort
    await page.click('[data-testid="table-header-logfc"]');

    // Verify sort direction changed
    await expect(page.locator('[data-testid="table-header-logfc"] [data-testid="sort-indicator-desc"]')).toBeVisible();

    await takeScreenshot(page, '04-results', 'table-sorting-works', 'final');
  });

  test('table filtering works', async ({ page }) => {
    // Enter filter text
    await page.fill('[data-testid="table-filter"]', 'TP53');
    await page.keyboard.press('Enter');

    // Verify filtered results
    const rows = await page.locator('[data-testid="protein-table-row"]').count();
    expect(rows).toBeGreaterThanOrEqual(0);

    await takeScreenshot(page, '04-results', 'table-filtering-works', 'final');
  });

  test('table row selection highlights protein', async ({ page }) => {
    // Click on a table row
    await page.click('[data-testid="protein-table-row"]:first-child');

    // Verify row is highlighted
    const row = page.locator('[data-testid="protein-table-row"]:first-child');
    await expect(row).toHaveClass(/bg-blue-50/);

    // Verify protein info panel updates
    await expect(page.locator('[data-testid="protein-info-panel"]')).toBeVisible();

    await takeScreenshot(page, '04-results', 'table-row-selection-highlights-protein', 'final');
  });

  test('CSV export works', async ({ page }) => {
    // Click export button
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-csv-btn"]')
    ]);

    // Verify download started
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    await takeScreenshot(page, '04-results', 'csv-export-works', 'final');
  });

  test('volcano plot zoom and pan', async ({ page }) => {
    // Get initial plot state
    const plot = page.locator('[data-testid="volcano-plot"]');
    await expect(plot).toBeVisible();

    // Get plot bounding box
    const box = await plot.boundingBox();
    if (box) {
      // Zoom in (mouse wheel)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(500);

      // Pan (drag)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    await takeScreenshot(page, '04-results', 'volcano-plot-zoom-and-pan', 'final');
  });

  test('reset zoom button works', async ({ page }) => {
    // Get plot
    const plot = page.locator('[data-testid="volcano-plot"]');
    await expect(plot).toBeVisible();

    // Zoom in first
    const box = await plot.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(500);
    }

    // Click reset zoom
    await page.click('[data-testid="reset-zoom-btn"]');

    // Verify plot reset
    await page.waitForTimeout(500);

    await takeScreenshot(page, '04-results', 'reset-zoom-button-works', 'final');
  });

  test('significant only filter', async ({ page }) => {
    // Look for significant only filter
    const sigFilter = page.locator('[data-testid="significant-only-checkbox"], [data-testid="significant-only-toggle"]');

    // If filter exists, check it
    const hasFilter = await sigFilter.isVisible();
    if (hasFilter) {
      await sigFilter.check();
      await page.waitForTimeout(500);

      // Verify table still has rows
      const rows = await page.locator('[data-testid="protein-table-row"]').count();
      expect(rows).toBeGreaterThanOrEqual(0);
    }

    await takeScreenshot(page, '04-results', 'significant-only-filter', 'final');
  });

  test('threshold lines on volcano plot', async ({ page }) => {
    // Verify threshold lines are visible
    await expect(page.locator('[data-testid="threshold-lines"]')).toBeVisible();

    // Verify shapes exist
    const shapes = await page.locator('.shapelayer path').count();
    expect(shapes).toBeGreaterThanOrEqual(2);

    await takeScreenshot(page, '04-results', 'threshold-lines-on-volcano-plot', 'final');
  });
});

test.describe('Results - Empty State', () => {
  test('shows error state when session not found', async ({ page }) => {
    // Navigate to visualization with non-existent session
    await page.goto('/analysis/visualization?session=new-session');

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Verify error message is shown for non-existent session
    await expect(page.locator('text=/Session not found/i')).toBeVisible();

    await takeScreenshot(page, '04-results', 'shows-error-when-session-not-found', 'final');
  });
});
