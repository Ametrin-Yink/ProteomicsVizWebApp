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
    await expect(page.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '07-queue', '03-session-a-complete', 'results');
  });

  // ===== STEP 4: Verify Session B auto-started =====
  await test.step('4. Verify Session B auto-started after Session A', async () => {
    // Open pageB and navigate to Session B's processing page
    const context = page.context();
    const pageB = await context.newPage();
    await pageB.goto(`/analysis/processing?session_id=${sessionIdB}`);
    await pageB.waitForLoadState('networkidle');

    // Verify Session B was processing or completed (not stuck in queued)
    const statusResp = await pageB.request.get(`/api/sessions/${sessionIdB}/status`);
    const statusJson = await statusResp.json();
    const sessionBState = statusJson.state;

    if (sessionBState === 'queued') {
      throw new Error(`Session B still in "queued" state - did not auto-start`);
    }

    // Session B may be "processing" or already "completed" (both mean it auto-started correctly)
    // Wait a moment for the page to render
    await pageB.waitForTimeout(2000);

    await takeScreenshot(pageB, '07-queue', '04-session-b-running', `state=${sessionBState}`);

    // Wait for Session B to complete (may already be done)
    await pageB.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });
    await expect(pageB.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 10000 });

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

    // Verify session is queued via API
    const beforeStatus = await pageB.request.get(`/api/sessions/${id}/status`);
    const beforeJson = await beforeStatus.json();
    expect(beforeJson.state).toBe('queued');

    // Cancel via API call
    const cancelResp = await pageB.request.post(`/api/sessions/${id}/cancel`);
    expect(cancelResp.ok()).toBe(true);

    // Verify session is cancelled via API
    const afterStatus = await pageB.request.get(`/api/sessions/${id}/status`);
    const afterJson = await afterStatus.json();
    expect(afterJson.state).toBe('cancelled');

    await takeScreenshot(pageB, '07-queue', '06-queued-cancelled', 'cancelled');
    await pageB.close();
  });

  // ===== STEP 3: Let Session A finish normally =====
  await test.step('3. Session A completes normally', async () => {
    await page.waitForURL(/\/analysis\/visualization/, { timeout: 300000 });
    await expect(page.locator('[data-testid="volcano-container"]')).toBeVisible({ timeout: 10000 });
  });

  console.log(`Cancel queued test passed!`);
});
