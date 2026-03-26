/**
 * E2E Test: Session Persistence (GOALS.md - E2E Test 2)
 *
 * Tests session lifecycle and persistence:
 * 1. Create session → See it in welcome page list
 * 2. Click session → Back to analysis with data intact
 * 3. Refresh page → Session restored from URL
 * 4. Close browser, reopen → Session still accessible
 * 5. Session manager: rename, delete sessions
 */

import { test, expect, Page } from '@playwright/test';
import {
  createSession,
  uploadFiles,
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
  purgeLegacyScreenshots('02-session-persistence');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page);
});

test.describe('Session Persistence', () => {

  test('session appears in welcome page list', async ({ page }) => {
    // Create a session first
    const sessionId = await createSession(page, 'Test Session Persistence');
    createdSessions.push(sessionId);

    // Upload files to make it a "real" session
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    // Navigate back to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify session appears in list
    const sessionList = page.locator('[data-testid="session-list"]');
    await expect(sessionList).toBeVisible();
    await expect(sessionList).toContainText('Test Session Persistence');

    await takeScreenshot(page, '02-session-persistence', 'session-in-list', 'visible');
  });

  test('clicking session restores analysis page with data', async ({ page }) => {
    // Create and configure a session
    const sessionId = await createSession(page, 'Test Session Restore');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'DMSO',
      control: 'DMSO',
      organism: 'human',
    });

    // Navigate back to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click on the session
    await page.locator('[data-testid="session-item"]').filter({ hasText: 'Test Session Restore' }).click();

    // Wait for navigation
    await expect(page).toHaveURL(/\/analysis\?session=/, { timeout: 10000 });

    // Verify data is restored
    await expect(page.locator('[data-testid="file-table"]')).toContainText('DMSO');

    // Verify config is restored
    await expect(page.locator('[data-testid="config-summary"]')).toContainText('DMSO');

    await takeScreenshot(page, '02-session-persistence', 'session-restored', 'data-intact');
  });

  test('session persists after page reload', async ({ page }) => {
    const sessionId = await createSession(page, 'Test Reload Persistence');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    await configureAnalysis(page, {
      treatment: 'DMSO',
      control: 'DMSO',
      organism: 'human',
    });

    // Take state before reload
    const beforeUrl = page.url();

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify same URL
    expect(page.url()).toBe(beforeUrl);

    // Verify data still present
    await expect(page.locator('[data-testid="file-table"]')).toContainText('DMSO');

    await takeScreenshot(page, '02-session-persistence', 'after-reload', 'persisted');
  });

  test('session survives browser restart', async ({ page, context }) => {
    const sessionId = await createSession(page, 'Test Browser Survival');
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    const sessionUrl = page.url();

    // Close browser
    await context.close();

    // Reopen new context
    const newContext = await page.context().browser()?.newContext();
    if (!newContext) throw new Error('Failed to create new context');

    const newPage = await newContext.newPage();

    // Navigate to same session URL
    await newPage.goto(sessionUrl);
    await newPage.waitForLoadState('networkidle');

    // Verify session restored
    await expect(newPage.locator('[data-testid="file-table"]')).toContainText('DMSO');

    await takeScreenshot(newPage, '02-session-persistence', 'after-browser-restart', 'survived');

    await newContext.close();
  });

});

test.describe('Session Manager', () => {

  test('session list displays correctly', async ({ page }) => {
    // Create a session
    const sessionId = await createSession(page, 'Test Session Manager');
    createdSessions.push(sessionId);

    // Navigate to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify session list structure
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="session-list"]')).toBeVisible();

    // Verify session item has expected structure
    const sessionItem = page.locator('[data-testid="session-item"]').first();
    await expect(sessionItem.locator('[data-testid="session-name"]')).toBeVisible();
    await expect(sessionItem.locator('[data-testid="session-status"]')).toBeVisible();

    await takeScreenshot(page, '02-session-persistence', 'session-manager-list', 'displayed');
  });

  test('can rename session', async ({ page }) => {
    const sessionId = await createSession(page, 'Original Name');
    createdSessions.push(sessionId);

    // Navigate to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find the session and click rename
    const sessionItem = page.locator('[data-testid="session-item"]').filter({ hasText: 'Original Name' });
    await sessionItem.locator('[data-testid="session-rename-btn"]').click();

    // Enter new name
    await page.locator('[data-testid="session-rename-input"]').fill('Renamed Session');
    await page.locator('[data-testid="session-rename-save"]').click();

    // Verify rename succeeded
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Renamed Session');

    await takeScreenshot(page, '02-session-persistence', 'session-renamed', 'success');
  });

  test('can delete session from list', async ({ page }) => {
    const sessionId = await createSession(page, 'Session To Delete');
    createdSessions.push(sessionId);

    // Navigate to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and delete the session
    const sessionItem = page.locator('[data-testid="session-item"]').filter({ hasText: 'Session To Delete' });
    await sessionItem.locator('[data-testid="session-delete-btn"]').click();

    // Confirm deletion if dialog appears
    const confirmBtn = page.locator('[data-testid="confirm-delete-btn"]').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }

    // Wait for session to disappear
    await page.waitForTimeout(1000);

    // Verify session removed
    const deletedSession = page.locator('[data-testid="session-item"]').filter({ hasText: 'Session To Delete' });
    expect(await deletedSession.count()).toBe(0);

    await takeScreenshot(page, '02-session-persistence', 'session-deleted', 'removed');
  });

  test('deleted session shows 404 on access', async ({ page }) => {
    const sessionId = await createSession(page, 'Session To Delete 404');
    createdSessions.push(sessionId);

    // Delete via API
    await page.request.delete(`http://localhost:8000/api/sessions/${sessionId}`);

    // Try to access deleted session
    await page.goto(`/analysis?session=${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Should show error or redirect
    const errorVisible = await page.locator('[data-testid="error-message"], [data-testid="toast-error"]').isVisible().catch(() => false);
    const redirectedToHome = page.url().includes('/welcome') || page.url() === 'http://localhost:3000/';

    expect(errorVisible || redirectedToHome).toBe(true);

    await takeScreenshot(page, '02-session-persistence', 'deleted-session-404', 'error-shown');
  });

});
