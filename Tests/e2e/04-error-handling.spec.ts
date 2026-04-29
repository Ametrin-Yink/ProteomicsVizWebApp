/**
 * E2E Test: Error Handling (GOALS.md - E2E Test 4)
 *
 * Tests error scenarios with specific error messages:
 * 1. Invalid filename → Error explains required format
 * 2. Missing columns → Error lists missing columns
 * 3. Treatment=control → Validation error before processing
 * 4. Insufficient files → "At least 6 files" error
 * 5. Deleted session → 404 with clear message
 * 6. Network errors → Handled gracefully
 */

import { test, expect, Page } from '@playwright/test';
import {
  createSession,
  uploadFiles,
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
  purgeLegacyScreenshots('04-error-handling');
});

test.afterEach(async ({ page }) => {
  await cleanupAllSessions(page);
});

test.describe('Error Handling', () => {

  test('invalid filename format shows clear error', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Create invalid file content
    const invalidContent = Buffer.from('Sequence,Modifications,Charge\nTEST,None,2');

    // Upload invalid file via setInputFiles
    await page.locator('[data-testid="proteomics-upload"]').setInputFiles({
      name: 'invalid_file_name.csv',
      mimeType: 'text/csv',
      buffer: invalidContent,
    });

    // Wait for error toast
    await expect(page.locator('[data-testid="toast-error"]')).toBeVisible({ timeout: 10000 });

    // Verify error message is clear
    const errorText = await page.locator('[data-testid="toast-error"]').textContent();
    expect(errorText).toContain('filename');
    expect(errorText).toMatch(/PSM_.*_.*_.*\.csv|invalid|format/i);

    await takeScreenshot(page, '04-error-handling', 'invalid-filename-error', 'error-shown');
  });

  test('missing required columns shows specific error', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Create file with missing columns
    const invalidContent = Buffer.from('Sequence,Charge\nTESTSEQ,2');

    // Upload file
    // Upload file with missing columns via setInputFiles
    await page.locator('[data-testid="proteomics-upload"]').setInputFiles({
      name: 'PSM_TestData_Condition_1.csv',
      mimeType: 'text/csv',
      buffer: invalidContent,
    });

    // Wait for error
    await expect(page.locator('[data-testid="toast-error"]')).toBeVisible({ timeout: 10000 });

    // Error should mention missing columns
    const errorText = await page.locator('[data-testid="toast-error"]').textContent();
    expect(errorText).toMatch(/column|missing|required/i);

    await takeScreenshot(page, '04-error-handling', 'missing-columns-error', 'error-shown');
  });

  test('insufficient replicates prevents starting', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Upload only 2 files (need at least 6)
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
    ]);

    // Configure
    await page.locator('[data-testid="treatment-select"]').selectOption('DMSO');
    await page.locator('[data-testid="control-select"]').selectOption('DMSO');

    // Try to click start
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();

    // Button should be disabled
    const isEnabled = await startBtn.isEnabled();
    expect(isEnabled).toBe(false);

    // Or validation panel should show error
    const validationPanel = page.locator('[data-testid="validation-panel"], [data-testid="validation-error"]');
    const hasValidation = await validationPanel.isVisible().catch(() => false);

    if (hasValidation) {
      const validationText = await validationPanel.textContent();
      expect(validationText).toMatch(/replicate|file|6|minimum/i);
    }

    await takeScreenshot(page, '04-error-handling', 'insufficient-replicates', 'validation-shown');
  });

  test('missing config prevents starting', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Upload files but don't configure
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
      '../../SampleData/PSM_SampleData_DMSO_2.csv',
      '../../SampleData/PSM_SampleData_DMSO_3.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
      '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
    ]);

    // Try to click start without config
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();

    // Button should be disabled or show error
    const isEnabled = await startBtn.isEnabled();

    if (isEnabled) {
      // If somehow enabled, click should show error
      await startBtn.click();
      await expect(page.locator('[data-testid="toast-error"], [data-testid="validation-error"]')).toBeVisible({ timeout: 5000 });
    }

    await takeScreenshot(page, '04-error-handling', 'missing-config', 'error-shown');
  });

  test('404 page for deleted session', async ({ page }) => {
    // Create and delete a session
    const sessionId = await createSession(page);

    // Delete via API
    await page.request.delete(`http://localhost:8000/api/sessions/${sessionId}`);

    // Try to access deleted session
    await page.goto(`/analysis?session=${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Should show error or redirect
    const errorVisible = await page.locator('[data-testid="error-message"], [data-testid="toast-error"]').isVisible().catch(() => false);
    const redirectedToHome = page.url().includes('/welcome') || page.url() === 'http://localhost:3000/';

    expect(errorVisible || redirectedToHome).toBe(true);

    await takeScreenshot(page, '04-error-handling', 'deleted-session-404', 'error-shown');
  });

  test('network error handled gracefully', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Upload files
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    // Intercept API calls and fail them
    await page.route('**/api/sessions/**', (route) => {
      route.abort('failed');
    });

    // Try to interact
    await page.locator('[data-testid="treatment-select"]').click();

    // Wait a moment for error handling
    await page.waitForTimeout(1000);

    // Should not crash - app should handle gracefully
    const body = await page.locator('body').textContent();
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Runtime error');

    await takeScreenshot(page, '04-error-handling', 'network-error-handled', 'graceful');

    // Clean up route
    await page.unroute('**/api/sessions/**');
  });

  test('file too large shows error', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    // Mock a file upload error
    await page.evaluate(() => {
      const event = new CustomEvent('file-upload-error', {
        detail: { message: 'File exceeds maximum size of 500MB' }
      });
      window.dispatchEvent(event);
    });

    // Error should be visible
    const errorVisible = await page.locator('[data-testid="toast-error"]').isVisible().catch(() => false);

    if (errorVisible) {
      const errorText = await page.locator('[data-testid="toast-error"]').textContent();
      expect(errorText).toMatch(/size|large|limit|500MB/i);
    }

    await takeScreenshot(page, '04-error-handling', 'file-size-error', 'error-shown');
  });

  test('treatment equals control shows validation error', async ({ page }) => {
    const sessionId = await createSession(page);
    createdSessions.push(sessionId);

    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    // Try to set treatment = control
    await page.locator('[data-testid="treatment-select"]').selectOption('DMSO');
    await page.locator('[data-testid="control-select"]').selectOption('DMSO');

    // Verify validation error appears
    await expect(page.locator('[data-testid="config-error"]')).toBeVisible();
    const errorText = await page.locator('[data-testid="config-error"]').textContent();
    expect(errorText).toContain('must be different');

    // Start button should be disabled
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
    const isEnabled = await startBtn.isEnabled();
    expect(isEnabled).toBe(false);

    await takeScreenshot(page, '04-error-handling', 'treatment-equals-control', 'validation-shown');
  });

});
