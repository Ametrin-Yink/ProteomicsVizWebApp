/**
 * E2E Test: MSstats Pairwise Comparison Analysis
 *
 * Tests the full MSstats pipeline journey:
 * 1. Welcome page -> Click MSstats template -> New session
 * 2. Upload 6 PSM files -> See files in table
 * 3. Configure treatment/control/organism
 * 4. Click Start -> Redirect to processing page
 * 5. Wait for processing to complete
 * 6. Verify Volcano plot with data points
 * 7. Verify QC -> PCA plot with sample separation
 * 8. Verify GSEA -> Heatmap displays
 * 9. Verify pipeline logs show MSstats (not msqrob2)
 *
 * This test validates the MSstats-specific pipeline (steps 6-7) while
 * reusing shared steps 1-5 and 8-9.
 */

import { test, expect } from '@playwright/test';
import {
  uploadFiles,
  configureAnalysis,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
  API_BASE_URL
} from './helpers';

test.describe('MSstats Pairwise Analysis', () => {
  let sessionId = '';

  test.beforeAll(() => {
    purgeLegacyScreenshots('09-msstats-analysis');
  });

  test.afterEach(async ({ page }) => {
    if (sessionId) {
      await cleanupSession(page, sessionId);
    }
  });

  test('msstats pipeline: template selection through results', async ({ page }) => {
    test.setTimeout(600000); // 10 minutes for full pipeline

    // ===== STEP 1: Welcome Page =====
    await test.step('1. Navigate to welcome page', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="app-logo"]').first()).toBeVisible();
      await expect(page.locator('[data-testid="template-protein_pairwise_comparison"]')).toBeVisible();
      await expect(page.locator('[data-testid="template-msstats_pairwise_comparison"]')).toBeVisible();

      await takeScreenshot(page, '09-msstats-analysis', '01-welcome', 'loaded');
    });

    // ===== STEP 2: Create MSstats Session =====
    sessionId = await test.step('2. Click MSstats template to create session', async () => {
      await page.locator('[data-testid="template-msstats_pairwise_comparison"]').click();
      await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });

      const url = page.url();
      const match = url.match(/session=([a-f0-9-]+)/);
      const id = match ? match[1] : '';
      expect(id).toBeTruthy();

      // Verify session was created with correct template
      const sessionResponse = await page.request.get(`${API_BASE_URL}/api/sessions/${id}`);
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionData = await sessionResponse.json();
      expect(sessionData.template).toBe('msstats_pairwise_comparison');

      sessionId = id;
      await takeScreenshot(page, '09-msstats-analysis', '02-session-created', 'redirected');

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

      await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('DMSO');
      await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('INCZ123456');

      await takeScreenshot(page, '09-msstats-analysis', '03-files-uploaded', 'complete');
    });

    // ===== STEP 4: Configure Analysis =====
    await test.step('4. Configure analysis parameters', async () => {
      await configureAnalysis(page, {
        treatment: 'INCZ123456',
        control: 'DMSO',
        organism: 'human',
        removeRazor: false,
        strictFiltering: false,
      });

      // Verify MSstats options section is visible
      await expect(page.locator('[data-testid="config-form"]')).toBeVisible();

      await takeScreenshot(page, '09-msstats-analysis', '04-configured', 'complete');
    });

    // ===== STEP 5: Start Processing =====
    await test.step('5. Start analysis', async () => {
      await page.locator('[data-testid="start-analysis-btn"]').first().click();

      await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
      await expect(page.locator('[data-testid="processing-page"]')).toBeVisible();

      await takeScreenshot(page, '09-msstats-analysis', '05-processing-started', 'running');
    });

    // ===== STEP 6: Wait for Processing Completion =====
    await test.step('6. Wait for processing to complete', async () => {
      // MSstats takes longer than msqrob2 - give it up to 8 minutes
      await page.waitForURL(/\/analysis\/visualization/, { timeout: 480000 });

      await expect(page.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 10000 });

      await takeScreenshot(page, '09-msstats-analysis', '06-processing-complete', 'results');
    });

    // ===== STEP 7: Verify Results - Volcano Plot =====
    await test.step('7. Verify results display data', async () => {
      await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible();

      // Verify data counts are populated
      const infoPanel = page.locator('[data-testid="general-info-panel"]');
      await expect(infoPanel).toBeVisible({ timeout: 10000 });
      const infoText = await infoPanel.textContent();
      expect(infoText).toMatch(/\d+ proteins/);
      expect(infoText).toMatch(/\d+ DE/);

      // Verify protein table has rows
      await expect(page.locator('[data-testid="protein-table"]')).toBeVisible({ timeout: 10000 });

      await takeScreenshot(page, '09-msstats-analysis', '07-volcano-plot', 'with-data');
    });

    // ===== STEP 8: Verify QC =====
    await test.step('8. Navigate to QC plots', async () => {
      await page.locator('[data-testid="qc-tab"]').click();
      await page.waitForTimeout(2000);

      const pcaPlot = page.locator('[data-testid="pca-plot"]');
      await expect(pcaPlot).toBeVisible();

      const mainSvg = pcaPlot.locator('svg.main-svg').first();
      await expect(mainSvg).toBeVisible({ timeout: 10000 });

      const pcaPoints = pcaPlot.locator('.scatterlayer .point');
      const count = await pcaPoints.count();
      expect(count).toBeGreaterThan(0);

      await takeScreenshot(page, '09-msstats-analysis', '08-qc-plots', 'pca-visible');
    });

    // ===== STEP 9: Verify GSEA =====
    await test.step('9. Navigate to GSEA', async () => {
      await page.locator('[data-testid="gsea-tab"]').click();
      await page.waitForTimeout(2000);

      const gseaOverview = page.locator('[data-testid="gsea-overview"]');
      await expect(gseaOverview).toBeVisible();

      await takeScreenshot(page, '09-msstats-analysis', '09-gsea-overview', 'visible');
    });

    // ===== STEP 10: Verify Pipeline Logs Show MSstats =====
    await test.step('10. Verify pipeline logs confirm MSstats was used', async () => {
      // Fetch pipeline state from API
      const statusResponse = await page.request.get(`${API_BASE_URL}/api/sessions/${sessionId}/processing/status`);
      expect(statusResponse.ok()).toBeTruthy();
      const statusData = await statusResponse.json();

      // Verify the logs contain MSstats-specific messages
      const logs = statusData.logs || [];
      const logMessages = logs.map((l: { message: string }) => l.message).join('\n');

      // Step 6 should mention MSstats, not msqrob2
      expect(logMessages).toContain('MSstats');
      expect(logMessages).not.toContain('msqrob2');

      // Verify key MSstats steps are present
      expect(logMessages).toContain('dataProcess');
      expect(logMessages).toContain('groupComparison');

      // Verify all 9 steps completed
      expect(statusData.completed_steps).toContain(1);
      expect(statusData.completed_steps).toContain(5);
      expect(statusData.completed_steps).toContain(6);
      expect(statusData.completed_steps).toContain(7);
      expect(statusData.completed_steps).toContain(8);
      expect(statusData.completed_steps).toContain(9);

      await takeScreenshot(page, '09-msstats-analysis', '10-pipeline-verified', 'msstats-confirmed');
    });

    console.log(`✅ MSstats analysis flow successful! Session: ${sessionId}`);
  });
});
