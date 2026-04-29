/**
 * E2E Test: Real-world data analysis flow
 *
 * Tests the full pipeline with real-world DOCK5 Jurkat data:
 * - 7 TMTpro 16-plex PSM files (2 conditions for pairwise comparison)
 * - INCB224525_4h (3 reps) vs DMSO_24h (4 reps)
 *
 * Note: The app supports pairwise comparison (2 conditions max).
 * Full 16-file dataset has 5 conditions; separate sessions needed for other comparisons.
 *
 * Files location: SampleData/RealData/processed/PSM_DOCK5_*.csv
 */

import { test, expect, Page } from '@playwright/test';
import {
  createSession,
  uploadFilesBulk,
  configureAnalysis,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

const createdSessions: string[] = [];

async function cleanupAllSessions(page: Page): Promise<void> {
  for (const sessionId of createdSessions) {
    try {
      await cleanupSession(page, sessionId);
    } catch (e) {
      console.log(`Failed to cleanup session ${sessionId}: ${e}`);
    }
  }
  createdSessions.length = 0;
}

test.beforeAll(() => {
  purgeLegacyScreenshots('02-real-data-flow');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page);
});

test('real-world data: DOCK5 Jurkat analysis', async ({ page }) => {
  test.setTimeout(600000); // 10 minutes for full pipeline

  // ===== STEP 1: Welcome Page =====
  await test.step('1. Navigate to welcome page', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="app-logo"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="template-protein-pairwise"]')).toBeVisible();

    await takeScreenshot(page, '02-real-data-flow', '01-welcome', 'loaded');
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
    await takeScreenshot(page, '02-real-data-flow', '02-session-created', 'redirected');

    return id;
  });

  // ===== STEP 3: Upload PSM Files (2 conditions: INCB224525_4h vs DMSO_24h) =====
  await test.step('3. Upload 7 real-world PSM files (2 conditions)', async () => {
    await uploadFilesBulk(page, [
      // INCB224525_4h - 3 replicates
      '../../SampleData/RealData/processed/PSM_DOCK5_INCB224525_4h_1.csv',
      '../../SampleData/RealData/processed/PSM_DOCK5_INCB224525_4h_2.csv',
      '../../SampleData/RealData/processed/PSM_DOCK5_INCB224525_4h_3.csv',
      // DMSO_24h - 4 replicates
      '../../SampleData/RealData/processed/PSM_DOCK5_DMSO_24h_1.csv',
      '../../SampleData/RealData/processed/PSM_DOCK5_DMSO_24h_2.csv',
      '../../SampleData/RealData/processed/PSM_DOCK5_DMSO_24h_3.csv',
      '../../SampleData/RealData/processed/PSM_DOCK5_DMSO_24h_4.csv',
    ]);

    // Verify files appear in table
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('INCB224525_4h');
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText('DMSO_24h');

    await takeScreenshot(page, '02-real-data-flow', '03-files-uploaded', 'complete');
  });

  // ===== STEP 4: Configure Analysis =====
  await test.step('4. Configure analysis parameters', async () => {
    await configureAnalysis(page, {
      treatment: 'INCB224525_4h',
      control: 'DMSO_24h',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    // Verify config summary
    await expect(page.locator('[data-testid="config-summary"]')).toContainText('INCB224525_4h');
    await expect(page.locator('[data-testid="config-summary"]')).toContainText('DMSO_24h');

    await takeScreenshot(page, '02-real-data-flow', '04-configured', 'complete');
  });

  // ===== STEP 5: Start Processing =====
  await test.step('5. Start analysis', async () => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible();

    await takeScreenshot(page, '02-real-data-flow', '05-processing-started', 'running');
  });

  // ===== STEP 6: Wait for Completion =====
  await test.step('6. Wait for processing to complete', async () => {
    await page.waitForURL(/\/analysis\/visualization/, { timeout: 480000 }); // 8 min for real data

    await expect(page.locator('[data-testid="results-page"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '02-real-data-flow', '06-processing-complete', 'results');
  });

  // ===== STEP 7: Verify Results =====
  await test.step('7. Verify results display', async () => {
    await expect(page.locator('[data-testid="volcano-plot"]')).toBeVisible();

    const totalText = await page.locator('[data-testid="total-proteins"]').textContent();
    const totalCount = parseInt(totalText?.match(/\d+/)?.[0] || '0');
    expect(totalCount).toBeGreaterThan(0);

    console.log(`Total proteins in results: ${totalCount}`);

    await takeScreenshot(page, '02-real-data-flow', '07-results', 'with-data');
  });

  console.log(`✅ Real-world data analysis successful! Session: ${sessionId}`);
});
