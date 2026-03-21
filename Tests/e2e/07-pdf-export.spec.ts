/**
 * E2E Test Suite 7: PDF Export
 * 
 * Tests PDF generation and content verification.
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
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('07-pdf-export');
});

test.describe('PDF Export', () => {
  let sessionId: string;

  test.beforeAll(async ({ page }) => {
    // Create a completed session with results for all tests in this suite
    const { createCompletedSession } = await import('./helpers');
    sessionId = await createCompletedSession(page);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to the visualization page with the completed session
    await page.goto(`/analysis/visualization?session=${sessionId}`);
  });

  test.afterAll(async ({ page }) => {
    // Clean up the session after all tests
    const { cleanupSession } = await import('./helpers');
    await cleanupSession(page, sessionId);
  });

  test('PDF export button is visible', async ({ page }) => {
    // Verify export button
    await expect(page.locator('[data-testid="export-pdf-btn"]')).toBeVisible();

    // Verify button text
    await expect(page.locator('[data-testid="export-pdf-btn"]')).toContainText('PDF');

    await takeScreenshot(page, '07-pdf-export', 'pdf-export-button-is-visible', 'final');
  });

  test('generates PDF successfully', async ({ page }) => {
    // Click export button
    await page.click('[data-testid="export-pdf-btn"]');

    // Verify generation started
    await expect(page.locator('[data-testid="pdf-generating"]')).toBeVisible();

    // Wait for generation to complete
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    await takeScreenshot(page, '07-pdf-export', 'generates-pdf-successfully', 'final');
  });

  test('PDF download works', async ({ page }) => {
    // Generate PDF
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    // Download PDF
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-pdf-btn"]')
    ]);

    // Verify download
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    // Save and verify file
    const path = await download.path();
    expect(path).toBeTruthy();

    await takeScreenshot(page, '07-pdf-export', 'pdf-download-works', 'final');
  });

  test('PDF contains correct filename', async ({ page }) => {
    // Generate and download PDF
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-pdf-btn"]')
    ]);

    // Verify filename contains session info
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/proteomics|analysis|report/i);
    expect(filename).toMatch(/\.pdf$/);

    await takeScreenshot(page, '07-pdf-export', 'pdf-contains-correct-filename', 'final');
  });

  test('PDF generation progress indicator', async ({ page }) => {
    // Click export
    await page.click('[data-testid="export-pdf-btn"]');

    // Verify progress indicator
    await expect(page.locator('[data-testid="pdf-progress"]')).toBeVisible();

    // Verify progress percentage
    const progressText = await page.locator('[data-testid="pdf-progress"]').textContent();
    expect(progressText).toMatch(/\d+%/);

    await takeScreenshot(page, '07-pdf-export', 'pdf-generation-progress-indicator', 'final');
  });

  test('cancel PDF generation', async ({ page }) => {
    // Start generation
    await page.click('[data-testid="export-pdf-btn"]');

    // Wait for generation to start
    await expect(page.locator('[data-testid="pdf-generating"]')).toBeVisible();

    // Cancel generation
    await page.click('[data-testid="cancel-pdf-btn"]');

    // Verify cancelled
    await expect(page.locator('[data-testid="pdf-cancelled"]')).toBeVisible();

    await takeScreenshot(page, '07-pdf-export', 'cancel-pdf-generation', 'final');
  });

  test('PDF preview modal', async ({ page }) => {
    // Generate PDF
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    // Open preview
    await page.click('[data-testid="preview-pdf-btn"]');

    // Verify modal opens
    await expect(page.locator('[data-testid="pdf-preview-modal"]')).toBeVisible();

    // Verify PDF viewer
    await expect(page.locator('[data-testid="pdf-viewer"]')).toBeVisible();

    // Close modal
    await page.click('[data-testid="close-preview-btn"]');

    // Verify modal closed
    await expect(page.locator('[data-testid="pdf-preview-modal"]')).not.toBeVisible();

    await takeScreenshot(page, '07-pdf-export', 'pdf-preview-modal', 'final');
  });

  test('PDF export from different tabs', async ({ page }) => {
    // Export from Results tab
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    // Go to QC tab
    await page.click('[data-testid="qc-tab"]');
    await expect(page.locator('[data-testid="export-pdf-btn"]')).toBeVisible();

    // Go to Bioinformatics tab
    await page.click('[data-testid="bioinformatics-tab"]');
    await expect(page.locator('[data-testid="export-pdf-btn"]')).toBeVisible();

    await takeScreenshot(page, '07-pdf-export', 'pdf-export-from-different-tabs', 'final');
  });

  test('PDF generation error handling', async ({ page }) => {
    // Intercept PDF generation and force error
    await page.route('**/api/sessions/**/reports', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'PDF generation failed' }),
      });
    });

    // Try to generate PDF
    await page.click('[data-testid="export-pdf-btn"]');

    // Verify error message
    await expect(page.locator('[data-testid="pdf-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="pdf-error"]')).toContainText('failed');

    await takeScreenshot(page, '07-pdf-export', 'pdf-generation-error-handling', 'final');
  });

  test('retry PDF generation after error', async ({ page }) => {
    // Force error first
    let shouldFail = true;
    await page.route('**/api/sessions/**/reports', (route) => {
      if (shouldFail) {
        shouldFail = false;
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'PDF generation failed' }),
        });
      } else {
        route.continue();
      }
    });

    // Try to generate PDF
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-error"]')).toBeVisible();

    // Retry
    await page.click('[data-testid="retry-pdf-btn"]');

    // Should succeed now
    await expect(page.locator('[data-testid="pdf-generating"]')).toBeVisible();

    await takeScreenshot(page, '07-pdf-export', 'retry-pdf-generation-after-error', 'final');
  });
});

test.describe('PDF Content Verification', () => {
  test('PDF includes all sections', async ({ page }) => {
    // Create a completed session for this test
    const { createCompletedSession, cleanupSession } = await import('./helpers');
    const sessionId = await createCompletedSession(page);
    await page.goto(`/analysis/visualization?session=${sessionId}`);

    // Generate PDF
    await page.click('[data-testid="export-pdf-btn"]');
    await expect(page.locator('[data-testid="pdf-ready"]')).toBeVisible({ timeout: 60000 });

    // Download PDF
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-pdf-btn"]')
    ]);

    const downloadPath = await download.path();
    if (downloadPath) {
      // TODO: Verify PDF content includes:
      // - Title page
      // - Summary statistics
      // - Volcano plot
      // - QC plots
      // - GSEA results (if available)
    }

    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '07-pdf-export', 'pdf-includes-all-sections', 'final');
  });
});
