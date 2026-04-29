/**
 * E2E Test: Queue & Concurrency (Queue System)
 *
 * Tests the processing queue with max 1 concurrent session:
 * 1. Session A starts processing normally
 * 2. Session B starts while A is processing -> shows "Queued"
 * 3. Session A completes -> Session B auto-transitions to "Running"
 * 4. Session B completes normally
 */

import { test, expect, Page } from '@playwright/test';
import {
  createSession,
  uploadFiles,
  configureAnalysis,
  cleanupSession,
  takeScreenshot
} from './helpers';

const sessionA: string[] = [];
const sessionB: string[] = [];

async function cleanupAllSessions(page: Page): Promise<void> {
  for (const id of [...sessionA, ...sessionB]) {
    try {
      await cleanupSession(page, id);
    } catch (e) {
      console.log(`Failed to cleanup session ${id}: ${e}`);
    }
  }
  sessionA.length = 0;
  sessionB.length = 0;
}

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page);
});

test('concurrent sessions: first runs, second queues, then auto-starts', async ({ page }) => {
  test.setTimeout(900000); // 15 minutes for two sequential pipeline runs

  // ===== STEP 1: Create Session A and start processing =====
  const sessionIdA = await test.step('1. Start Session A processing', async () => {
    const id = await createSession(page);
    sessionA.push(id);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    // Start processing - should start immediately (not queued)
    await page.locator('[data-testid="start-analysis-btn"]').first().click();
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Verify NOT queued (should be running immediately)
    await expect(page.locator('[data-testid="processing-queued"]')).not.toBeVisible({ timeout: 5000 });

    await takeScreenshot(page, '07-queue', '01-session-a-started', 'running');
    return id;
  });

  // ===== STEP 2: Create Session B in a new tab, start processing =====
  const sessionIdB = await test.step('2. Start Session B (should be queued)', async () => {
    const context = page.context();
    const pageB = await context.newPage();

    const id = await createSession(pageB);
    sessionB.push(id);

    await uploadFiles(pageB, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(pageB, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
      removeRazor: true,
      strictFiltering: true,
    });

    // Start processing in Session B
    await pageB.locator('[data-testid="start-analysis-btn"]').first().click();

    // Should navigate to processing page
    await expect(pageB).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Should show queued state
    await expect(pageB.locator('[data-testid="processing-queued"]')).toBeVisible({ timeout: 15000 });

    // Verify queue position is shown
    await expect(pageB.locator('[data-testid="processing-queued"]')).toContainText('#1');

    await takeScreenshot(pageB, '07-queue', '02-session-b-queued', 'queued');

    await pageB.close();
    return id;
  });

  // ===== STEP 3: Wait for Session A to complete =====
  await test.step('3. Wait for Session A to complete', async () => {
    await page.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });
    await expect(page.locator('[data-testid="results-page"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '07-queue', '03-session-a-complete', 'results');
  });

  // ===== STEP 4: Verify Session B auto-started =====
  await test.step('4. Verify Session B auto-started after Session A', async () => {
    const context = page.context();
    const pageB = await context.newPage();
    await pageB.goto(`/analysis/processing?session=${sessionIdB}`);
    await pageB.waitForLoadState('networkidle');

    // Session B should now be running (no longer queued)
    await pageB.waitForTimeout(5000); // Wait for WebSocket to connect and state to update

    // Should NOT show queued anymore
    const isQueued = await pageB.locator('[data-testid="processing-queued"]').isVisible().catch(() => false);
    expect(isQueued).toBe(false);

    // Should show processing activity
    const hasProgress = await pageB.locator('[data-testid="processing-page"]').isVisible().catch(() => false);
    expect(hasProgress).toBe(true);

    await takeScreenshot(pageB, '07-queue', '04-session-b-running', 'auto-started');

    // Wait for Session B to complete
    await pageB.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });
    await expect(pageB.locator('[data-testid="results-page"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(pageB, '07-queue', '05-session-b-complete', 'results');
    await pageB.close();
  });

  console.log(`Queue test passed! Session A: ${sessionIdA}, Session B: ${sessionIdB}`);
});

test('cancel queued session removes from queue', async ({ page }) => {
  test.setTimeout(600000); // 10 minutes

  // ===== STEP 1: Start Session A (running) =====
  const sessionIdA = await test.step('1. Start Session A', async () => {
    const id = await createSession(page);
    sessionA.push(id);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
    });

    await page.locator('[data-testid="start-analysis-btn"]').first().click();
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    return id;
  });

  // ===== STEP 2: Start Session B (queued), then cancel =====
  await test.step('2. Start Session B, then cancel from queue', async () => {
    const context = page.context();
    const pageB = await context.newPage();

    const id = await createSession(pageB);
    sessionB.push(id);

    await uploadFiles(pageB, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    await configureAnalysis(pageB, {
      treatment: 'INCZ123456',
      control: 'DMSO',
      organism: 'human',
    });

    await pageB.locator('[data-testid="start-analysis-btn"]').first().click();
    await expect(pageB).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    await expect(pageB.locator('[data-testid="processing-queued"]')).toBeVisible({ timeout: 15000 });

    // Cancel from queue
    const cancelBtn = pageB.locator('[data-testid="cancel-processing-btn"]').first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      const confirmBtn = pageB.locator('[data-testid="confirm-cancel-btn"]');
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
    }

    // Should show cancelled state
    await expect(pageB.locator('[data-testid="processing-cancelled"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(pageB, '07-queue', '06-queued-cancelled', 'cancelled');
    await pageB.close();
  });

  // ===== STEP 3: Let Session A finish normally =====
  await test.step('3. Session A completes normally', async () => {
    await page.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });
    await expect(page.locator('[data-testid="results-page"]')).toBeVisible({ timeout: 10000 });
  });

  console.log(`Cancel queued test passed!`);
});
