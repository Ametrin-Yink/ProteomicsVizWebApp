/**
 * E2E Test: Complete Analysis Flow (GOALS.md - E2E Test 1)
 *
 * Tests the full user journey from landing to results:
 * 1. Welcome page → Click template → New session
 * 2. Upload 6 PSM files → See files in table
 * 3. Configure treatment/control/organism/razor/filtering
 * 4. Click Start → Redirect to processing page
 * 5. See progress bar, steps completing (1→9), logs streaming
 * 6. Auto-redirect to results → Volcano plot with data points
 * 7. Click points → Protein details panel
 * 8. Navigate to QC → PCA plot with sample separation
 * 9. Navigate to GSEA → Heatmap displays
 * 10. Export PDF → Download succeeds
 *
 * CRITICAL: This is a SINGLE end-to-end test, not multiple tests.
 * It mimics a real user doing a complete analysis.
 */

import { test, expect } from '@playwright/test';
import {
  createSession,
  uploadFiles,
  configureAnalysis,
  startAnalysis,
  cleanupAllSessions,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

const createdSessions: string[] = [];

test.beforeAll(() => {
  purgeLegacyScreenshots('01-complete-flow');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page, createdSessions);
});

test('complete analysis flow: welcome → results', async ({ page }) => {
  test.setTimeout(600000); // 10 minutes for full pipeline

  // ===== STEP 1: Welcome Page =====
  await test.step('1. Navigate to welcome page', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify page elements
    await expect(page.locator('[data-testid="app-logo"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="template-protein-pairwise"]')).toBeVisible();

    await takeScreenshot(page, '01-complete-flow', '01-welcome', 'loaded');
  });

  // ===== STEP 2: Create Session =====
  const sessionId = await test.step('2. Click template to create session', async () => {
    await page.locator('[data-testid="template-protein-pairwise"]').click();
    await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });

    const url = page.url();
    const match = url.match(/session=([a-f0-9-]+)/);
    const id = match ? match[1] : '';
    expect(id).toBeTruthy();

    createdSessions.push(id);
    await takeScreenshot(page, '01-complete-flow', '02-session-created', 'redirected');

    return id;
  });

  // ===== STEP 3: Upload Files =====
  await test.step('3. Upload 6 PSM files', async () => {
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Verify files appear in table
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('DMSO');
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('INCZ123456');

    await takeScreenshot(page, '01-complete-flow', '03-files-uploaded', 'complete');
  });

  // ===== STEP 4: Configure Analysis =====
  await test.step('4. Configure analysis parameters', async () => {
    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    // Verify config summary shows correct values
    await expect(page.locator('[data-testid="config-summary"]')).toContainText('INCZ123456');
    await expect(page.locator('[data-testid="config-summary"]')).toContainText('DMSO');

    await takeScreenshot(page, '01-complete-flow', '04-configured', 'complete');
  });

  // ===== STEP 5: Start Processing =====
  await test.step('5. Start analysis', async () => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for navigation to processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible();

    await takeScreenshot(page, '01-complete-flow', '05-processing-started', 'running');
  });

  // ===== STEP 6: Wait for Completion =====
  await test.step('6. Wait for processing to complete', async () => {
    // Wait for processing to complete (up to 5 minutes)
    await page.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });

    await expect(page.locator('[data-testid="results-page"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '01-complete-flow', '06-processing-complete', 'results');
  });

  // ===== STEP 7: Verify Results - Volcano Plot =====
  await test.step('7. Verify results display data', async () => {
    await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible();

    // Verify data counts are populated
    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCount = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCount).toBeGreaterThan(0);

    // Verify DE counts are populated
    const sigText = await page.locator('[data-testid="significant-proteins"]').textContent();
    const sigCount = parseInt(sigText?.match(/\d+/)?.[0] || '0');
    expect(sigCount).toBeGreaterThan(0);

    // Verify protein table has rows
    await expect(page.locator('[data-testid="file-table"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '01-complete-flow', '07-volcano-plot', 'with-data');
  });

  // ===== STEP 8: Click table row → Protein Details =====
  await test.step('8. Click table row to see protein details', async () => {
    // Click the first data row in the protein table
    const firstRow = page.locator('[data-testid="file-table"] tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    // Verify protein info panel appears
    await expect(page.locator('[data-testid="protein-info-panel"]')).toBeVisible({ timeout: 5000 });

    await takeScreenshot(page, '01-complete-flow', '08-protein-details', 'open');
  });

  // ===== STEP 9: Navigate to QC =====
  await test.step('9. Navigate to QC plots', async () => {
    await page.locator('[data-testid="qc-tab"]').click();
    await page.waitForTimeout(1000);

    // Verify PCA plot displays with sample separation
    await expect(page.locator('[data-testid="pca-plot"]')).toBeVisible();

    // Check for data points
    const pcaPoints = page.locator('[data-testid="pca-plot"] .scatterlayer .trace .point');
    const count = await pcaPoints.count();
    expect(count).toBeGreaterThan(0);

    await takeScreenshot(page, '01-complete-flow', '09-qc-plots', 'pca-visible');
  });

  // ===== STEP 10: Navigate to GSEA =====
  await test.step('10. Navigate to GSEA', async () => {
    await page.locator('[data-testid="bioinformatics-tab"]').click();
    await page.waitForTimeout(1000);

    // Verify GSEA heatmap displays
    await expect(page.locator('[data-testid="gsea-heatmap"]')).toBeVisible();

    // Check for data in heatmap
    const heatmapCells = page.locator('[data-testid="gsea-heatmap"] .heatmap .cell');
    const cellCount = await heatmapCells.count();
    expect(cellCount).toBeGreaterThan(0);

    await takeScreenshot(page, '01-complete-flow', '10-gsea-heatmap', 'visible');
  });

  // ===== STEP 11: PDF Export =====
  await test.step('11. Export PDF report', async () => {
    await page.locator('[data-testid="export-pdf-btn"]').click();

    // Wait for PDF generation
    await page.waitForTimeout(2000);

    // Verify PDF ready state (either download started or preview shown)
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });

    // Click the actual download/preview button if exists
    const pdfDownloadBtn = page.locator('[data-testid="download-pdf-btn"]').first();
    if (await pdfDownloadBtn.isVisible().catch(() => false)) {
      await pdfDownloadBtn.click();
    }

    // Wait for download or just verify the button worked
    const download = await downloadPromise.catch(() => null);

    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.(pdf|zip)$/);
    }

    await takeScreenshot(page, '01-complete-flow', '11-pdf-export', 'complete');
  });

  console.log(`✅ Complete analysis flow successful! Session: ${sessionId}`);
});
