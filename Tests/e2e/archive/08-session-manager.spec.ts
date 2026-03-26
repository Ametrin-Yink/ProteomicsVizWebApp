/**
 * E2E Test Suite 8: Session Manager
 *
 * Tests session list, resume session, and delete session.
 * NOTE: Only tests features specified in requirements.
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
  createSession,
  cleanupSession,
  purgeLegacyScreenshots,
  takeScreenshot
} from './helpers';

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('08-session-manager');
});

test.describe('Session Manager', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('session list displays', async ({ page }) => {
    // Create a few sessions
    const session1 = await createSession(page, 'Test Session 1');
    const session2 = await createSession(page, 'Test Session 2');

    // Go back to home
    await page.goto('/');

    // Verify session list
    await expect(page.locator('[data-testid="session-list"]')).toBeVisible();

    // Verify sessions are listed
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(2);

    // Verify session names
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Test Session 1');
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Test Session 2');

    // Cleanup
    await cleanupSession(page, session1);
    await cleanupSession(page, session2);

    await takeScreenshot(page, '08-session-manager', 'session-list-displays', 'final');
  });

  test('session shows correct status', async ({ page }) => {
    // Create new session
    const sessionId = await createSession(page, 'New Session');

    // Go back to home
    await page.goto('/');

    // Verify session shows "Created" status
    await expect(page.locator('[data-testid="session-status"]')).toContainText('Created');

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'session-shows-correct-status', 'final');
  });

  test('resume session from list', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Resume Test');

    // Go back to home
    await page.goto('/');

    // Click resume on session
    await page.click(`[data-testid="resume-session-${sessionId}"]`);

    // Verify navigation to analysis page
    await expect(page).toHaveURL(new RegExp(`/analysis\\?session=${sessionId}`));

    // Verify session data loaded
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible();

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'resume-session-from-list', 'final');
  });

  test('delete session from list', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Delete Test');

    // Go back to home
    await page.goto('/');

    // Click delete
    await page.click(`[data-testid="delete-session-${sessionId}"]`);

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="delete-confirm-dialog"]')).toBeVisible();

    // Confirm deletion
    await page.click('[data-testid="confirm-delete-btn"]]');

    // Verify session removed from list
    await expect(page.locator('[data-testid="session-list"]')).not.toContainText('Delete Test');

    await takeScreenshot(page, '08-session-manager', 'delete-session-from-list', 'final');
  });

  test('cancel session deletion', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Cancel Delete Test');

    // Go back to home
    await page.goto('/');

    // Click delete
    await page.click(`[data-testid="delete-session-${sessionId}"]`);

    // Cancel deletion
    await page.click('[data-testid="cancel-delete-btn"]');

    // Verify dialog closed
    await expect(page.locator('[data-testid="delete-confirm-dialog"]')).not.toBeVisible();

    // Verify session still in list
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Cancel Delete Test');

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'cancel-session-deletion', 'final');
  });

  test('empty session list message', async ({ page }) => {
    // Clear all sessions (if possible)
    // This test assumes a clean state

    // Verify empty message
    const sessionCount = await page.locator('[data-testid="session-item"]').count();

    if (sessionCount === 0) {
      await expect(page.locator('[data-testid="no-sessions-message"]')).toBeVisible();
      await expect(page.locator('[data-testid="no-sessions-message"]')).toContainText('No sessions');
    }

    await takeScreenshot(page, '08-session-manager', 'empty-session-list-message', 'final');
  });

  test('session timestamps displayed', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Timestamp Test');

    // Go back to home
    await page.goto('/');

    // Verify creation date is displayed
    await expect(page.locator('[data-testid="session-created-date"]')).toBeVisible();
    const dateText = await page.locator('[data-testid="session-created-date"]').textContent();
    expect(dateText).toMatch(/\d{4}|Today|Yesterday/);

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'session-timestamps-displayed', 'final');
  });
});
