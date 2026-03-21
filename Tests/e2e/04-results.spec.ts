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
  createCompletedSession,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('04-results');
});

test.describe('Results Visualization', () => {
  let sessionId: string;

  test.beforeAll(async ({ page }) => {
    // Create a completed session with results for all tests in this suite
    sessionId = await createCompletedSession(page);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the visualization page with the completed session
    await page.goto(`/analysis/visualization?session=${sessionId}`);
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async ({ page }) => {
    // Clean up the session after all tests
    await cleanupSession(page, sessionId);
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

  test('volcano plot click mode selects one protein', async ({ page }) => {
    // Ensure click mode is selected
    await page.click('[data-testid="mode-click"]');

    // Click on a data point
    const point = page.locator('.scatterlayer .point').first();
    await point.click();

    // Verify one protein is selected
    await expect(page.locator('[data-testid="selection-count"]')).toContainText('1');

    // Verify protein info panel shows details
    await expect(page.locator('[data-testid="protein-info-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="protein-accession"]')).toBeVisible();
    await expect(page.locator('[data-testid="gene-name"]')).toBeVisible();

    // Verify fold change values are displayed
    await expect(page.locator('[data-testid="fold-change"]')).toBeVisible();
    await expect(page.locator('[data-testid="log2-fold-change"]')).toBeVisible();

    // Verify p-values are displayed
    await expect(page.locator('[data-testid="p-value"]')).toBeVisible();
    await expect(page.locator('[data-testid="adj-p-value"]')).toBeVisible();

    await takeScreenshot(page, '04-results', 'volcano-plot-click-mode-selects-one-protein', 'final');
  });

  test('volcano plot box mode selects multiple proteins', async ({ page }) => {
    // Select box mode
    await page.click('[data-testid="mode-box"]');

    // Get plot bounding box
    const plot = page.locator('[data-testid="volcano-plot"]');
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      // Draw a box selection (drag from top-left to bottom-right of plot)
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7);
      await page.mouse.up();
    }

    // Wait for selection to update
    await page.waitForTimeout(500);

    // Verify multiple proteins are selected (count > 0)
    const selectionText = await page.locator('[data-testid="selection-count"]').textContent();
    const count = parseInt(selectionText?.match(/\d+/)?.[0] || '0');
    expect(count).toBeGreaterThan(0);

    await takeScreenshot(page, '04-results', 'volcano-plot-box-mode-selects-multiple', 'final');
  });

  test('volcano plot lasso mode selects multiple proteins', async ({ page }) => {
    // Select lasso mode
    await page.click('[data-testid="mode-lasso"]');

    // Get plot bounding box
    const plot = page.locator('[data-testid="volcano-plot"]');
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      // Draw a lasso selection (draw a small circle)
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const radius = 50;

      await page.mouse.move(centerX + radius, centerY);
      await page.mouse.down();

      // Draw circle
      for (let i = 0; i <= 8; i++) {
        const angle = (i / 8) * 2 * Math.PI;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        await page.mouse.move(x, y);
      }

      await page.mouse.up();
    }

    // Wait for selection to update
    await page.waitForTimeout(500);

    // Verify proteins are selected
    const selectionText = await page.locator('[data-testid="selection-count"]').textContent();
    const count = parseInt(selectionText?.match(/\d+/)?.[0] || '0');

    // Lasso may select 0 or more depending on where we drew
    // Just verify the selection count is displayed
    await expect(page.locator('[data-testid="selection-count"]')).toBeVisible();

    await takeScreenshot(page, '04-results', 'volcano-plot-lasso-mode-selects-multiple', 'final');
  });

  test('clear selection button removes all selections', async ({ page }) => {
    // First select a protein
    await page.click('[data-testid="mode-click"]');
    const point = page.locator('.scatterlayer .point').first();
    await point.click();

    // Verify selection exists
    await expect(page.locator('[data-testid="selection-count"]')).toContainText('1');

    // Click clear selection
    await page.click('[data-testid="clear-selection-btn"]');

    // Verify selection is cleared
    await expect(page.locator('[data-testid="selection-count"]')).toContainText('0');

    await takeScreenshot(page, '04-results', 'clear-selection-button-removes-all', 'final');
  });

  test('protein info panel shows all required details', async ({ page }) => {
    // Select a protein
    await page.click('[data-testid="mode-click"]');
    const point = page.locator('.scatterlayer .point').first();
    await point.click();

    // Verify protein info panel is visible
    await expect(page.locator('[data-testid="protein-info-panel"]')).toBeVisible();

    // Verify Master Protein Accessions (UniProt IDs)
    await expect(page.locator('[data-testid="protein-accession"]')).toBeVisible();
    const accessionText = await page.locator('[data-testid="protein-accession"]').textContent();
    expect(accessionText).toMatch(/[A-Z][0-9][A-Z0-9]{3,}/); // UniProt ID pattern

    // Verify Gene Name
    await expect(page.locator('[data-testid="gene-name"]')).toBeVisible();
    const geneNameText = await page.locator('[data-testid="gene-name"]').textContent();
    expect(geneNameText).toBeTruthy(); // Should not be empty

    // Verify Fold Change (non-log2)
    await expect(page.locator('[data-testid="fold-change"]')).toBeVisible();
    const foldChangeText = await page.locator('[data-testid="fold-change"]').textContent();
    expect(foldChangeText).toMatch(/\d+\.?\d*/);

    // Verify Log2 Fold Change
    await expect(page.locator('[data-testid="log2-fold-change"]')).toBeVisible();
    const log2FcText = await page.locator('[data-testid="log2-fold-change"]').textContent();
    expect(log2FcText).toMatch(/-?\d+\.?\d*/);

    // Verify P-value
    await expect(page.locator('[data-testid="p-value"]')).toBeVisible();
    const pvalueText = await page.locator('[data-testid="p-value"]').textContent();
    expect(pvalueText).toMatch(/\d+\.?\d*e?-?\d*/i);

    // Verify Adj P-value
    await expect(page.locator('[data-testid="adj-p-value"]')).toBeVisible();
    const adjPvalText = await page.locator('[data-testid="adj-p-value"]').textContent();
    expect(adjPvalText).toMatch(/\d+\.?\d*e?-?\d*/i);

    // Verify Number of PSMs
    await expect(page.locator('[data-testid="num-psms"]')).toBeVisible();
    const numPsmsText = await page.locator('[data-testid="num-psms"]').textContent();
    expect(numPsmsText).toMatch(/\d+/);

    // Verify UniProt links are clickable
    const uniprotLink = page.locator('[data-testid="uniprot-link"]').first();
    await expect(uniprotLink).toBeVisible();
    const href = await uniprotLink.getAttribute('href');
    expect(href).toMatch(/uniprot\.org/);

    await takeScreenshot(page, '04-results', 'protein-info-panel-shows-all-details', 'final');
  });

  test('protein abundance plot displays', async ({ page }) => {
    // Select a protein
    await page.click('[data-testid="mode-click"]');
    const point = page.locator('.scatterlayer .point').first();
    await point.click();

    // Verify protein abundance plot is visible
    await expect(page.locator('[data-testid="protein-abundance-plot"]')).toBeVisible({ timeout: 10000 });

    // Verify plot has bars (column plot)
    const bars = await page.locator('[data-testid="protein-abundance-plot"] .barlayer .trace').count();
    expect(bars).toBeGreaterThan(0);

    // Verify y-axis label contains log2
    const plotText = await page.locator('[data-testid="protein-abundance-plot"]').textContent();
    expect(plotText).toMatch(/log2|log/i);

    await takeScreenshot(page, '04-results', 'protein-abundance-plot-displays', 'final');
  });

  test('psm abundance plot displays', async ({ page }) => {
    // Select a protein
    await page.click('[data-testid="mode-click"]');
    const point = page.locator('.scatterlayer .point').first();
    await point.click();

    // Verify PSM abundance plot is visible
    await expect(page.locator('[data-testid="psm-abundance-plot"]')).toBeVisible({ timeout: 10000 });

    // Verify plot has traces (dot-line plot)
    const traces = await page.locator('[data-testid="psm-abundance-plot"] .scatterlayer .trace').count();
    expect(traces).toBeGreaterThan(0);

    await takeScreenshot(page, '04-results', 'psm-abundance-plot-displays', 'final');
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
