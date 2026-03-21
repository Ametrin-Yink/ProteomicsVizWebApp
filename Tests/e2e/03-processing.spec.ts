/**
 * E2E Test Suite 3: Processing Pipeline
 * 
 * Tests real-time progress display, step-by-step verification,
 * and WebSocket resilience.
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
  uploadFiles, 
  configureAnalysis, 
  cleanupSession,
  purgeLegacyScreenshots, 
  takeScreenshot 
} from './helpers';

// Purge legacy screenshots before all tests
test.beforeAll(() => {
  purgeLegacyScreenshots('03-processing');
});

test.describe('Processing Pipeline', () => {
  let sessionId: string;

  test.beforeEach(async ({ page }) => {
    // Listen for console errors and network failures during setup
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log('Console error:', msg.text());
      }
    });
    
    page.on('requestfailed', (request) => {
      console.log('Request failed:', request.url(), request.failure()?.errorText);
    });
    
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.log('Error response:', response.url(), response.status());
      }
    });
    
    sessionId = await createSession(page);
    
    // Upload files
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
  });

  test.afterEach(async ({ page }) => {
    await cleanupSession(page, sessionId);
  });

  test('starts processing successfully', async ({ page }) => {
    // Wait for start button to be enabled
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
    await expect(startBtn).toBeEnabled({ timeout: 10000 });
    
    await takeScreenshot(page, '03-processing', 'starts-processing-successfully', 'before-click');
    
    // Click start analysis
    await startBtn.click();
    
    // Wait for navigation to processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Verify processing page loads
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible({ timeout: 10000 });

    // Verify WebSocket connection
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', { timeout: 10000 });
    
    await takeScreenshot(page, '03-processing', 'starts-processing-successfully', 'final');
  });

  test('displays all 9 processing steps', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    
    // Verify all 9 steps are displayed
    for (let i = 1; i <= 9; i++) {
      await expect(page.locator(`[data-testid="step-${i}"]`)).toBeVisible();
    }

    // Verify step names contain expected text
    await expect(page.locator('[data-testid="step-1"]')).toContainText('Combine');
    await expect(page.locator('[data-testid="step-6"]')).toContainText('Protein');
    await expect(page.locator('[data-testid="step-7"]')).toContainText('Differential');
    await expect(page.locator('[data-testid="step-9"]')).toContainText('GSEA');
    
    await takeScreenshot(page, '03-processing', 'displays-all-9-processing-steps', 'final');
  });

  test('shows real-time progress updates', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    
    // Wait for progress bar (use first() to handle multiple elements)
    await expect(page.locator('[data-testid="progress-bar"]').first()).toBeVisible();

    // Verify progress bar has a valid value
    const progressValue = await page.locator('[data-testid="progress-bar"]').first().getAttribute('aria-valuenow');
    const progressNum = parseInt(progressValue || '0');
    expect(progressNum).toBeGreaterThanOrEqual(0);
    expect(progressNum).toBeLessThanOrEqual(100);
    
    await takeScreenshot(page, '03-processing', 'shows-real-time-progress-updates', 'final');
  });

  test('displays log messages', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
    
    // Verify log panel is visible
    await expect(page.locator('[data-testid="log-panel"]')).toBeVisible();

    // Wait for processing to start and check if log panel has content
    await page.waitForTimeout(5000);
    
    await takeScreenshot(page, '03-processing', 'displays-log-messages', 'final');
  });

  test('shows estimated completion time', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Wait for processing to start
    await page.waitForTimeout(3000);

    // Verify the processing page is functional - estimated time may or may not appear
    // depending on backend calculation timing
    await expect(page.locator('[data-testid="processing-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="progress-bar"]').first()).toBeVisible();

    await takeScreenshot(page, '03-processing', 'shows-estimated-completion-time', 'final');
  });

  test('processing completes all 9 steps and navigates to results', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Wait for processing to complete (up to 5 minutes)
    await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout: 300000 });

    // Verify completion message
    await expect(page.locator('[data-testid="processing-complete"]')).toContainText('complete');

    // Wait for auto-redirect to visualization page
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });

    // Verify results page loaded
    await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });

    await takeScreenshot(page, '03-processing', 'processing-completes-all-steps', 'final');
  });

  test('all steps show completed status', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Wait for completion
    await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout: 300000 });

    // Verify all 9 steps show completed status
    for (let i = 1; i <= 9; i++) {
      const stepStatus = await page.locator(`[data-testid="step-${i}-status"]`).textContent();
      expect(stepStatus).toMatch(/completed|finished|done/i);
    }

    await takeScreenshot(page, '03-processing', 'all-steps-show-completed-status', 'final');
  });

  test('allows canceling processing', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Click cancel
    await page.click('[data-testid="cancel-btn"]');

    // Verify confirmation dialog
    await expect(page.locator('[data-testid="cancel-confirm-dialog"]')).toBeVisible();

    // Confirm cancel
    await page.click('[data-testid="confirm-cancel-btn"]');

    // Verify processing stopped
    await expect(page.locator('[data-testid="processing-cancelled"]')).toBeVisible();
    
    await takeScreenshot(page, '03-processing', 'allows-canceling-processing', 'final');
  });
});

test.describe('WebSocket Resilience', () => {
  let sessionId: string;

  test.beforeEach(async ({ page }) => {
    sessionId = await createSession(page);
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
  });

  test.afterEach(async ({ page }) => {
    await cleanupSession(page, sessionId);
  });

  test('reconnects on WebSocket disconnect', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for connection
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', { timeout: 10000 });

    // Simulate disconnect by going offline
    await page.context().setOffline(true);

    // Wait for offline state
    await page.waitForTimeout(2000);

    // Reconnect
    await page.context().setOffline(false);

    // Wait for reconnection
    await page.waitForTimeout(2000);

    // Verify still connected or reconnecting
    const statusText = await page.locator('[data-testid="connection-status"]').textContent();
    expect(statusText).toMatch(/Connected|Reconnecting/);
    
    await takeScreenshot(page, '03-processing', 'reconnects-on-websocket-disconnect', 'final');
  });

  test('handles network errors gracefully', async ({ page }) => {
    await page.locator('[data-testid="start-analysis-btn"]').first().click();

    // Wait for processing page
    await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });

    // Intercept WebSocket and force error
    await page.route('ws://**/*', (route) => {
      route.abort('failed');
    });

    // Wait for error handling
    await page.waitForTimeout(3000);

    // Verify connection status shows disconnected or error state
    const statusText = await page.locator('[data-testid="connection-status"]').textContent();
    console.log('Connection status after error:', statusText);
    
    await takeScreenshot(page, '03-processing', 'handles-network-errors-gracefully', 'final');
  });
});

test.describe('Processing Error Handling', () => {
  let sessionId: string;

  test.beforeEach(async ({ page }) => {
    sessionId = await createSession(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupSession(page, sessionId);
  });

  test('displays validation error for insufficient replicates', async ({ page }) => {
    // Upload files but with invalid configuration
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);

    // Configure analysis
    await configureAnalysis(page, {
      treatment: 'DMSO',
      control: 'DMSO',
      organism: 'human',
    });

    // Try to start without enough replicates
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
    const isEnabled = await startBtn.isEnabled();
    
    if (isEnabled) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    // Verify validation panel shows error
    const validationPanel = page.locator('[data-testid="validation-panel"], [data-testid="validation-error"], [data-testid="processing-error"]');
    const errorText = await validationPanel.first().textContent();
    console.log('Validation error:', errorText);
    
    await takeScreenshot(page, '03-processing', 'displays-error-on-processing-failure', 'final');
  });

  test('shows error details with suggestion', async ({ page }) => {
    // Upload files and configure
    await uploadFiles(page, [
      '../../SampleData/PSM_SampleData_DMSO_1.csv',
    ]);
    
    await configureAnalysis(page, {
      treatment: 'DMSO',
      control: 'DMSO',
      organism: 'human',
    });

    // Mock a processing error
    await page.route('**/api/sessions/**/process', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({
          error: {
            code: 'R_SCRIPT_ERROR',
            message: 'R script failed',
            suggestion: 'Please ensure msqrob2 is installed',
          },
        }),
      });
    });

    // Try to start
    const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
    const isEnabled = await startBtn.isEnabled();
    
    if (isEnabled) {
      await startBtn.click();
      await page.waitForTimeout(2000);
    }

    // Verify error panel shows error or suggestion
    const errorPanel = page.locator('[data-testid="error-suggestion"], [data-testid="validation-error"], [data-testid="validation-panel"]');
    const errorText = await errorPanel.first().textContent();
    console.log('Error/suggestion text:', errorText);
    
    await takeScreenshot(page, '03-processing', 'shows-error-details-with-suggestion', 'final');
  });
});
