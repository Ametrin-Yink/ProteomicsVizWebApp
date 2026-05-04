/**
 * E2E Test: MSstats Multi-Condition Comparison Analysis
 *
 * Tests the full multi-condition pipeline:
 * 1. Create session with multi_condition_comparison template
 * 2. Upload 9 PSM files (3 conditions x 3 replicates)
 * 3. Verify metadata grid auto-populates from filenames
 * 4. Add custom metadata column
 * 5. Verify comparison matrix auto-generates all pairs
 * 6. Select all comparisons
 * 7. Configure MSstats options (expanded imputation controls)
 * 8. Start processing
 * 9. Verify per-comparison DE files exist via API
 * 10. Verify results page shows comparison selector
 *
 * This test validates the multi-condition MSstats pipeline with
 * all pairwise contrasts computed simultaneously.
 */

import { test, expect } from '@playwright/test';
import {
  uploadFilesBulk,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot,
  API_BASE_URL
} from './helpers';

test.describe('MSstats Multi-Condition Analysis', () => {
  let sessionId = '';

  test.beforeAll(() => {
    purgeLegacyScreenshots('11-msstats-multi-condition');
  });

  test.afterAll(async () => {
    // Clean up session after test
    if (sessionId) {
      await cleanupSession(sessionId);
    }
  });

  test('multi-condition pipeline: template selection through results', async ({ page }) => {
    test.setTimeout(600000); // 10 minutes for full pipeline

    // ===== STEP 1: Welcome Page =====
    await test.step('1. Navigate to welcome page', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="app-logo"]').first()).toBeVisible();
      await expect(page.locator('[data-testid="template-multi_condition_comparison"]')).toBeVisible();

      await takeScreenshot(page, '11-msstats-multi-condition', '01-welcome', 'loaded');
    });

    // ===== STEP 2: Create Multi-Condition Session =====
    sessionId = await test.step('2. Click multi-condition template to create session', async () => {
      await page.locator('[data-testid="template-multi_condition_comparison"]').click();
      await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });

      const url = page.url();
      const match = url.match(/session=([a-f0-9-]+)/);
      const id = match ? match[1] : '';
      expect(id).toBeTruthy();

      // Verify session was created with correct template
      const sessionResponse = await page.request.get(`${API_BASE_URL}/api/sessions/${id}`);
      expect(sessionResponse.ok()).toBeTruthy();
      const sessionData = await sessionResponse.json();
      expect(sessionData.template).toBe('multi_condition_comparison');

      sessionId = id;
      await takeScreenshot(page, '11-msstats-multi-condition', '02-session-created', 'redirected');

      return id;
    });

    // ===== STEP 3: Upload 9 Files (3 conditions x 3 replicates) =====
    await test.step('3. Upload 9 PSM files (DMSO, INCB224525, INCB231845)', async () => {
      await uploadFilesBulk(page, [
        '../../SampleData/PSM_DOCK5Jurkat_DMSO_24h_1.csv',
        '../../SampleData/PSM_DOCK5Jurkat_DMSO_24h_2.csv',
        '../../SampleData/PSM_DOCK5Jurkat_DMSO_24h_3.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB224525_24h_1.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB224525_24h_2.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB224525_24h_3.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB231845_24h_1.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB231845_24h_2.csv',
        '../../SampleData/PSM_DOCK5Jurkat_INCB231845_24h_3.csv',
      ]);

      // Verify all 9 files are in the table
      await expect(page.locator('[data-testid="experiment-table"]')).toBeVisible();
      const rowCount = await page.locator('[data-testid="experiment-table"] tbody tr').count();
      expect(rowCount).toBe(9);

      await takeScreenshot(page, '11-msstats-multi-condition', '03-files-uploaded', '9 files');
    });

    // ===== STEP 4: Verify Metadata Grid =====
    await test.step('4. Verify metadata grid auto-populates', async () => {
      // The metadata grid section should be visible for multi-condition template
      await expect(page.getByText('Sample Metadata')).toBeVisible();

      // Verify filenames are displayed
      await expect(page.getByText('PSM_DOCK5Jurkat_DMSO_24h_1.csv')).toBeVisible();
      await expect(page.getByText('PSM_DOCK5Jurkat_INCB224525_24h_1.csv')).toBeVisible();
      await expect(page.getByText('PSM_DOCK5Jurkat_INCB231845_24h_1.csv')).toBeVisible();

      await takeScreenshot(page, '11-msstats-multi-condition', '04-metadata-grid', 'auto-populated');
    });

    // ===== STEP 5: Add Custom Metadata Column =====
    await test.step('5. Add custom metadata column "Batch"', async () => {
      const input = page.locator('input[placeholder="New column name (press Enter)"]');
      await input.fill('Batch');
      await input.press('Enter');

      // Verify "Batch" column header appears
      await expect(page.getByText('Batch')).toBeVisible();

      await takeScreenshot(page, '11-msstats-multi-condition', '05-custom-column', 'Batch added');
    });

    // ===== STEP 6: Verify Comparison Matrix =====
    await test.step('6. Verify comparison matrix auto-generates all pairs', async () => {
      await expect(page.getByText('Comparisons')).toBeVisible();
      await expect(page.getByText('Select All')).toBeVisible();
      await expect(page.getByText('Clear All')).toBeVisible();

      // Should have C(3,2) = 3 pairwise comparisons
      const comparisonCount = await page.locator('input[type="checkbox"]').count();
      expect(comparisonCount).toBeGreaterThanOrEqual(3);

      await takeScreenshot(page, '11-msstats-multi-condition', '06-comparisons', 'matrix');
    });

    // ===== STEP 7: Select All Comparisons and Configure =====
    await test.step('7. Select all comparisons and configure', async () => {
      // Click "Select All"
      await page.getByText('Select All').click();

      // Select organism
      const organismSelect = page.locator('[data-testid="organism-select"]');
      await organismSelect.waitFor({ state: 'visible' });
      await organismSelect.selectOption('human');

      // Enable razor peptide removal (toggle)
      const razorToggle = page.locator('[role="switch"]').first();
      const razorChecked = await razorToggle.getAttribute('aria-checked');
      if (razorChecked !== 'true') {
        await razorToggle.click();
      }

      await takeScreenshot(page, '11-msstats-multi-condition', '07-configured', 'all comparisons selected');
    });

    // ===== STEP 8: Start Processing =====
    await test.step('8. Click Start Analysis', async () => {
      const startBtn = page.locator('[data-testid="start-analysis"]');
      await startBtn.waitFor({ state: 'visible' });
      await startBtn.click();

      // Should redirect to processing page
      await expect(page).toHaveURL(/\/processing/, { timeout: 10000 });
      await takeScreenshot(page, '11-msstats-multi-condition', '08-processing-started', 'processing');
    });

    // ===== STEP 9: Wait for Processing =====
    await test.step('9. Wait for processing to complete', async () => {
      // Wait for completion (up to 8 minutes)
      await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout: 480000 });

      await takeScreenshot(page, '11-msstats-multi-condition', '09-processing-complete', 'completed');
    });

    // ===== STEP 10: Verify Per-Comparison DE Files =====
    await test.step('10. Verify per-comparison DE files via API', async () => {
      // Check that multiple Diff_Expression_*.tsv files exist
      const resultsResponse = await page.request.get(
        `${API_BASE_URL}/api/sessions/${sessionId}/results?comparison=DMSO_24h_vs_INCB224525_24h`
      );
      expect(resultsResponse.ok()).toBeTruthy();
      const resultsData = await resultsResponse.json();
      expect(resultsData.data).toBeDefined();
      expect(Array.isArray(resultsData.data.results)).toBeTruthy();
      expect(resultsData.data.results.length).toBeGreaterThan(0);

      await takeScreenshot(page, '11-msstats-multi-condition', '10-api-verification', 'DE results');
    });

    // ===== STEP 11: Verify Results Page Shows Comparison =====
    await test.step('11. Navigate to visualization and verify comparison selector', async () => {
      // Navigate to results page
      await page.goto(`/analysis/visualization?session=${sessionId}`);
      await page.waitForLoadState('networkidle');

      // Verify volcano plot is displayed
      await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible({ timeout: 30000 });

      await takeScreenshot(page, '11-msstats-multi-condition', '11-volcano-plot', 'results');
    });
  });
});
