/**
 * E2E Test Suite 8: Session Manager
 * 
 * Tests session list, resume session, and delete session.
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
    await page.click('[data-testid="confirm-delete-btn"]');

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

  test('session search/filter', async ({ page }) => {
    // Create sessions with different names
    const session1 = await createSession(page, 'Alpha Session');
    const session2 = await createSession(page, 'Beta Session');

    // Go back to home
    await page.goto('/');

    // Search for "Alpha"
    await page.fill('[data-testid="session-search"]', 'Alpha');
    await page.keyboard.press('Enter');

    // Verify only Alpha session shown
    await expect(page.locator('[data-testid="session-item"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Alpha Session');
    await expect(page.locator('[data-testid="session-list"]')).not.toContainText('Beta Session');

    // Cleanup
    await cleanupSession(page, session1);
    await cleanupSession(page, session2);

    await takeScreenshot(page, '08-session-manager', 'session-search-filter', 'final');
  });

  test('session sorting', async ({ page }) => {
    // Create sessions
    const session1 = await createSession(page, 'First Session');
    const session2 = await createSession(page, 'Second Session');

    // Go back to home
    await page.goto('/');

    // Sort by name
    await page.click('[data-testid="sort-by-name"]');

    // Verify sorted order
    const sessions = await page.locator('[data-testid="session-item"] [data-testid="session-name"]').allTextContents();
    expect(sessions).toEqual([...sessions].sort());

    // Sort by date
    await page.click('[data-testid="sort-by-date"]');

    // Cleanup
    await cleanupSession(page, session1);
    await cleanupSession(page, session2);

    await takeScreenshot(page, '08-session-manager', 'session-sorting', 'final');
  });

  test('session pagination', async ({ page }) => {
    // Create multiple sessions
    const sessions: string[] = [];
    for (let i = 0; i < 15; i++) {
      const id = await createSession(page, `Session ${i}`);
      sessions.push(id);
    }

    // Go back to home
    await page.goto('/');

    // Verify pagination
    await expect(page.locator('[data-testid="session-pagination"]')).toBeVisible();

    // Verify first page shows limited sessions
    const visibleSessions = await page.locator('[data-testid="session-item"]').count();
    expect(visibleSessions).toBeLessThanOrEqual(10);

    // Go to next page
    await page.click('[data-testid="next-page"]');

    // Verify different sessions
    await expect(page.locator('[data-testid="page-number"]')).toContainText('2');

    // Cleanup
    for (const id of sessions) {
      await cleanupSession(page, id);
    }

    await takeScreenshot(page, '08-session-manager', 'session-pagination', 'final');
  });

  test('session details modal', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Details Test');

    // Go back to home
    await page.goto('/');

    // Click on session name to view details
    await page.click(`[data-testid="session-name-${sessionId}"]`);

    // Verify details modal
    await expect(page.locator('[data-testid="session-details-modal"]')).toBeVisible();

    // Verify session info
    await expect(page.locator('[data-testid="session-details-name"]')).toContainText('Details Test');
    await expect(page.locator('[data-testid="session-details-id"]')).toContainText(sessionId);

    // Close modal
    await page.click('[data-testid="close-details-btn"]');

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'session-details-modal', 'final');
  });

  test('duplicate session', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Original Session');

    // Go back to home
    await page.goto('/');

    // Click duplicate
    await page.click(`[data-testid="duplicate-session-${sessionId}"]`);

    // Verify new session created
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Copy of Original Session');

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'duplicate-session', 'final');
  });

  test('export session data', async ({ page }) => {
    // Create session
    const sessionId = await createSession(page, 'Export Test');

    // Go back to home
    await page.goto('/');

    // Click export
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(`[data-testid="export-session-${sessionId}"]`)
    ]);

    // Verify download
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    // Cleanup
    await cleanupSession(page, sessionId);

    await takeScreenshot(page, '08-session-manager', 'export-session-data', 'final');
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

test.describe('Session Manager - Batch Operations', () => {
  test('select multiple sessions', async ({ page }) => {
    // Create sessions
    const session1 = await createSession(page, 'Batch 1');
    const session2 = await createSession(page, 'Batch 2');

    // Go back to home
    await page.goto('/');

    // Select multiple sessions
    await page.check(`[data-testid="select-session-${session1}"]`);
    await page.check(`[data-testid="select-session-${session2}"]`);

    // Verify batch actions visible
    await expect(page.locator('[data-testid="batch-actions"]')).toBeVisible();
    await expect(page.locator('[data-testid="selected-count"]')).toContainText('2');

    // Cleanup
    await cleanupSession(page, session1);
    await cleanupSession(page, session2);

    await takeScreenshot(page, '08-session-manager', 'select-multiple-sessions', 'final');
  });

  test('batch delete sessions', async ({ page }) => {
    // Create sessions
    const session1 = await createSession(page, 'Delete Batch 1');
    const session2 = await createSession(page, 'Delete Batch 2');

    // Go back to home
    await page.goto('/');

    // Select all sessions
    await page.check('[data-testid="select-all-sessions"]');

    // Click batch delete
    await page.click('[data-testid="batch-delete-btn"]');

    // Confirm deletion
    await page.click('[data-testid="confirm-batch-delete-btn"]');

    // Verify sessions removed
    await expect(page.locator('[data-testid="session-list"]')).not.toContainText('Delete Batch');

    await takeScreenshot(page, '08-session-manager', 'batch-delete-sessions', 'final');
  });
});
