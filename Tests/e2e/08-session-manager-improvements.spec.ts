/**
 * E2E Test: Session Manager Improvements
 *
 * Tests the four session manager improvements:
 * 1. Session scanning / auto-polling
 * 2. Sticky sidebar
 * 3. Multi-select delete
 * 4. No description field in create dialog
 */

import { test, expect, Page } from '@playwright/test';
import { takeScreenshot, purgeLegacyScreenshots } from './helpers';

const createdSessions: string[] = [];

async function cleanupAllSessions(page: Page): Promise<void> {
  for (const sessionId of createdSessions) {
    try {
      await page.request.delete(`http://localhost:8000/api/sessions/${sessionId}`);
    } catch {
      // ignore
    }
  }
  createdSessions.length = 0;
}

test.beforeAll(() => {
  purgeLegacyScreenshots('08-session-manager-improvements');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page);
});

test.describe('Session Manager Improvements', () => {

  test('scan sessions button exists and triggers refresh', async ({ page }) => {
    // Create session via API to ensure name is set
    const response = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Scan Test Session', template: 'protein_pairwise_comparison' },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    createdSessions.push(session.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify refresh button exists
    const refreshBtn = page.locator('[data-testid="refresh-sessions-btn"]');
    await expect(refreshBtn).toBeVisible();

    // Click refresh and verify it works
    await refreshBtn.click();
    await page.waitForTimeout(1000);

    // Session should be visible in the list
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Scan Test Session');

    await takeScreenshot(page, '08-session-manager-improvements', 'scan-sessions', 'visible');
  });

  test('create dialog has no description field', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click new analysis button
    await page.locator('[data-testid="new-analysis-btn"]').click();

    // Verify dialog opens
    const dialog = page.locator('[data-testid="new-analysis-dialog"]');
    await expect(dialog).toBeVisible();

    // Verify session name input exists
    await expect(page.locator('[data-testid="session-name-input"]')).toBeVisible();

    // Verify NO description field exists
    const descriptionLabel = page.getByText('Description');
    await expect(descriptionLabel).not.toBeVisible();

    // Verify create button exists
    await expect(page.locator('[data-testid="create-analysis-btn"]')).toBeVisible();

    await takeScreenshot(page, '08-session-manager-improvements', 'create-dialog-no-description', 'verified');
  });

  test('session list displays with tabs', async ({ page }) => {
    // Create session via API
    const response = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Tab Test Session', template: 'protein_pairwise_comparison' },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    createdSessions.push(session.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify active and completed tabs exist (error tab removed)
    await expect(page.getByText('Active (')).toBeVisible();
    await expect(page.getByText('Completed (')).toBeVisible();

    // Verify select mode button exists
    await expect(page.locator('[data-testid="select-mode-btn"]')).toBeVisible();

    await takeScreenshot(page, '08-session-manager-improvements', 'tabs-display', 'visible');
  });

  test('multi-select delete works', async ({ page }) => {
    // Create two sessions via API
    const r1 = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Delete Me 1', template: 'protein_pairwise_comparison' },
    });
    const s1 = await r1.json();
    const r2 = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Delete Me 2', template: 'protein_pairwise_comparison' },
    });
    const s2 = await r2.json();
    createdSessions.push(s1.id, s2.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Enter select mode
    await page.locator('[data-testid="select-mode-btn"]').click();

    // Verify checkboxes appear
    const checkboxes = page.locator('[data-testid="session-checkbox"]');
    await expect(checkboxes.first()).toBeVisible();

    // Select one session
    await checkboxes.first().click();

    // Verify delete selected button appears
    await expect(page.locator('[data-testid="delete-selected-btn"]')).toBeVisible();

    // Count before delete
    const countBefore = await page.locator('[data-testid="session-item"]').count();

    // Click delete
    await page.locator('[data-testid="delete-selected-btn"]').click();

    // Wait a moment for deletion to process
    await page.waitForTimeout(2000);

    // Verify at least one session was removed
    const countAfter = await page.locator('[data-testid="session-item"]').count();
    expect(countAfter).toBeLessThan(countBefore);

    await takeScreenshot(page, '08-session-manager-improvements', 'multi-select-delete', 'deleted');
  });

  test('select all toggles all checkboxes', async ({ page }) => {
    // Create session via API
    const response = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Select All Test', template: 'protein_pairwise_comparison' },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    createdSessions.push(session.id);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Enter select mode
    await page.locator('[data-testid="select-mode-btn"]').click();

    // Click select all
    await page.locator('[data-testid="select-all-checkbox"]').click();

    // Verify all checkboxes are checked
    const checkboxes = page.locator('[data-testid="session-checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    await takeScreenshot(page, '08-session-manager-improvements', 'select-all', 'checked');
  });

  test('sessions persist after page refresh (polling on mount)', async ({ page }) => {
    // Create session via API
    const response = await page.request.post('http://localhost:8000/api/sessions', {
      data: { name: 'Poll Test Session', template: 'protein_pairwise_comparison' },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    createdSessions.push(session.id);

    // Navigate to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify session is visible
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Poll Test Session');

    // Refresh page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // brief wait for polling

    // Verify session still appears
    await expect(page.locator('[data-testid="session-list"]')).toContainText('Poll Test Session');

    await takeScreenshot(page, '08-session-manager-improvements', 'after-refresh', 'persisted');
  });

});
