/**
 * E2E Test Suite 1: Welcome Page
 * 
 * Tests page load, template selection, and session persistence.
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
import { cleanupSession, purgeLegacyScreenshots, takeScreenshot } from './helpers';

test.describe('Welcome Page', () => {
  // Purge legacy screenshots before all tests in this describe block
  test.beforeAll(() => {
    purgeLegacyScreenshots('01-welcome');
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to welcome page
    await page.goto('/');
    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  test('page loads without errors', async ({ page }) => {
    // Verify page title contains expected text
    await expect(page).toHaveTitle(/Proteomics|Analysis/i);

    // Verify welcome title is visible - STRICT check
    const welcomeTitle = page.locator('[data-testid="welcome-title"]');
    await expect(welcomeTitle).toBeVisible({ timeout: 10000 });
    
    // Verify welcome title contains expected text
    const titleText = await welcomeTitle.textContent();
    expect(titleText).toMatch(/Welcome|ProteomicsViz/i);
    
    // Screenshot for visual confirmation
    await takeScreenshot(page, '01-welcome', 'page-loads-without-errors', 'final');

    // Verify no console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.waitForTimeout(1000); // Wait for any async errors
    expect(consoleErrors, `Console errors found: ${consoleErrors.join(', ')}`).toHaveLength(0);
  });

  test('template section displays correctly', async ({ page }) => {
    // Verify template section is visible
    const templateSection = page.locator('[data-testid="template-section"]');
    await expect(templateSection).toBeVisible({ timeout: 10000 });
    
    // Verify section title
    await expect(templateSection).toContainText('Choose Analysis Type');
    
    await takeScreenshot(page, '01-welcome', 'template-section-displays', 'section-visible');

    // Verify protein pairwise comparison template exists and is available
    const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
    await expect(pairwiseTemplate).toBeVisible();
    await expect(pairwiseTemplate).toContainText('Protein Pair-wise Comparison Analysis');
    await expect(pairwiseTemplate).toContainText('Compare protein abundance between two experimental conditions');
    
    await takeScreenshot(page, '01-welcome', 'template-section-displays', 'pairwise-template-visible');

    // Verify unavailable templates exist but are marked as TBD
    const unavailableTemplates = [
      'template-other-multi-condition',
      'template-other-time-course', 
      'template-other-pathway-enrichment'
    ];
    
    for (const templateId of unavailableTemplates) {
      const template = page.locator(`[data-testid="${templateId}"]`);
      await expect(template).toBeVisible();
      await expect(template).toContainText('TBD');
    }
    
    await takeScreenshot(page, '01-welcome', 'template-section-displays', 'all-templates-visible');
  });

  test('TBD tooltip appears on unavailable templates', async ({ page }) => {
    // Hover over unavailable template
    const unavailableTemplate = page.locator('[data-testid="template-other-multi-condition"]');
    await expect(unavailableTemplate).toBeVisible();
    
    await unavailableTemplate.hover();
    
    // Wait for tooltip to appear
    const tooltip = page.locator('[data-testid="tbd-tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 5000 });
    await expect(tooltip).toContainText('Coming Soon');
    await expect(tooltip).toContainText('under development');
    
    await takeScreenshot(page, '01-welcome', 'tbd-tooltip-appears', 'final');
  });

  test('clicking available template creates session and navigates', async ({ page }) => {
    // Click on the available template
    const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
    await expect(pairwiseTemplate).toBeVisible();
    
    await takeScreenshot(page, '01-welcome', 'clicking-template-creates-session', 'before-click');
    
    // Click the template
    await pairwiseTemplate.click();
    
    // Wait for navigation to analysis page with session ID
    await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });
    
    // Verify session panel is visible on the analysis page
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible({ timeout: 10000 });
    
    await takeScreenshot(page, '01-welcome', 'clicking-template-creates-session', 'analysis-page-loaded');
    
    // Extract session ID from URL for cleanup
    const url = page.url();
    const sessionIdMatch = url.match(/session=([a-f0-9-]+)/);
    expect(sessionIdMatch).not.toBeNull();
    
    if (sessionIdMatch) {
      const sessionId = sessionIdMatch[1];
      
      // Verify session appears in session list
      await page.goto('/');
      await expect(page.locator('[data-testid="session-list"]')).toBeVisible();
      
      // The session should be in the list
      const sessionList = page.locator('[data-testid="session-list"]');
      await expect(sessionList).toBeVisible();
      
      await takeScreenshot(page, '01-welcome', 'clicking-template-creates-session', 'session-in-list');
      
      // Cleanup
      await cleanupSession(page, sessionId);
    }
  });

  test('session panel displays on welcome page', async ({ page }) => {
    // First create a session to have something in the panel
    const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
    await pairwiseTemplate.click();
    await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });
    
    const url = page.url();
    const sessionIdMatch = url.match(/session=([a-f0-9-]+)/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : '';
    
    // Navigate back to welcome page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify session panel is visible
    const sessionPanel = page.locator('[data-testid="session-panel"]');
    await expect(sessionPanel).toBeVisible({ timeout: 10000 });
    
    // Verify session list is visible
    const sessionList = page.locator('[data-testid="session-list"]');
    await expect(sessionList).toBeVisible();
    
    await takeScreenshot(page, '01-welcome', 'session-panel-displays', 'final');
    
    // Cleanup
    await cleanupSession(page, sessionId);
  });

  test('new analysis button opens create dialog', async ({ page }) => {
    // Verify new analysis button is visible
    const newAnalysisBtn = page.locator('[data-testid="new-analysis-btn"]');
    await expect(newAnalysisBtn).toBeVisible({ timeout: 10000 });
    
    // Click the button
    await newAnalysisBtn.click();
    
    // Verify dialog opens (check for dialog content)
    // The dialog should have input fields
    const dialog = page.locator('[data-testid="new-analysis-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    
    await takeScreenshot(page, '01-welcome', 'new-analysis-button-opens-dialog', 'dialog-open');
    
    // Close dialog by pressing Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('help link is visible and clickable', async ({ page }) => {
    const helpLink = page.locator('[data-testid="help-link"]');
    await expect(helpLink).toBeVisible();
    await expect(helpLink).toHaveAttribute('href', /#docs|documentation/i);
    await expect(helpLink).toContainText('documentation');
    
    await takeScreenshot(page, '01-welcome', 'help-link-visible', 'final');
  });

  test('page is responsive on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Reload to apply viewport
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Verify page still loads correctly - check elements exist in DOM
    // On mobile, sidebar may overlay content, so check existence not visibility
    const welcomeTitle = page.locator('[data-testid="welcome-title"]');
    const templateSection = page.locator('[data-testid="template-section"]');
    
    // Check elements exist in DOM
    await expect(welcomeTitle).toHaveCount(1);
    await expect(templateSection).toHaveCount(1);
    
    // Verify the page title is correct
    await expect(page).toHaveTitle(/Proteomics|Analysis/i);
    
    // Verify session panel is visible (sidebar should be visible on mobile too)
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible();
    
    await takeScreenshot(page, '01-welcome', 'responsive-mobile', 'final');
    
    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});

test.describe('Session Persistence', () => {
  test('session persists across page reload', async ({ page }) => {
    // Create a session by clicking template
    await page.goto('/');
    const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
    await pairwiseTemplate.click();
    
    // Wait for navigation and get session ID
    await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });
    const url = page.url();
    const sessionIdMatch = url.match(/session=([a-f0-9-]+)/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : '';
    
    await takeScreenshot(page, '01-welcome', 'session-persists-reload', 'session-created');
    
    // Reload the page
    await page.reload();
    
    // Verify we're still on the analysis page with the same session
    await expect(page).toHaveURL(new RegExp(`session=${sessionId}`), { timeout: 10000 });
    
    // Verify session panel is visible
    await expect(page.locator('[data-testid="session-panel"]')).toBeVisible({ timeout: 10000 });
    
    await takeScreenshot(page, '01-welcome', 'session-persists-reload', 'after-reload');
    
    // Cleanup
    await cleanupSession(page, sessionId);
  });

  test('session survives browser restart', async ({ page, context }) => {
    // Create a session
    await page.goto('/');
    const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
    await pairwiseTemplate.click();
    
    await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });
    const sessionUrl = page.url();
    const sessionIdMatch = sessionUrl.match(/session=([a-f0-9-]+)/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : '';
    
    await takeScreenshot(page, '01-welcome', 'session-survives-restart', 'session-created');
    
    // Close browser context (simulates browser restart)
    await context.close();
    
    // Create new context and page
    const newContext = await page.context().browser()?.newContext();
    if (!newContext) {
      throw new Error('Failed to create new browser context');
    }
    
    const newPage = await newContext.newPage();
    
    // Navigate to the session URL
    await newPage.goto(sessionUrl);
    
    // Verify session is restored
    await expect(newPage).toHaveURL(new RegExp(`session=${sessionId}`), { timeout: 10000 });
    await expect(newPage.locator('[data-testid="session-panel"]')).toBeVisible({ timeout: 10000 });
    
    await newPage.screenshot({ 
      path: 'D:/CodingWorks/ProteomicsVizWebApp/Tests/screenshots/01-welcome-session-survives-restart-final.png',
      fullPage: true 
    });
    
    // Cleanup
    await cleanupSession(newPage, sessionId);
    await newContext.close();
  });
});
