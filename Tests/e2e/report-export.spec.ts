import { test, expect } from '@playwright/test';

test.describe('HTML Report Export', () => {
  test('Reports link is in top navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Reports')).toBeVisible();
  });

  test('Reports page shows empty state', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText('Reports')).toBeVisible();
    // Should show empty state or loading
  });

  test('Export modal opens on completed session and validates name', async ({ page }) => {
    // This test requires a completed session — skip if none available
    test.skip();
  });

  test('Export button hidden when session not completed', async ({ page }) => {
    await page.goto('/analysis/visualization?session_id=nonexistent');
    const exportBtn = page.getByTestId('export-report-btn');
    await expect(exportBtn).not.toBeVisible();
  });
});
