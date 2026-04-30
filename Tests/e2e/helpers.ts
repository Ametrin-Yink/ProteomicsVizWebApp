/**
 * Test utilities and helper functions for E2E tests
 *
 * CRITICAL TESTING RULES:
 * 1. ONE-BY-ONE EXECUTION: Tests must run sequentially, never in parallel
 * 2. PURGE LEGACY SCREENSHOTS: Clear old screenshots before each test run
 * 3. VISUAL VERIFICATION: Every test MUST take screenshots and verify UI visually
 * 4. STRICT ASSERTIONS: No .catch() to swallow errors - tests must FAIL when broken
 * 5. HUMAN-MIMICRY: All interactions must simulate real user behavior
 */

import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export const API_BASE_URL = process.env.API_URL || 'http://localhost:8000';
export const WEB_BASE_URL = process.env.WEB_URL || 'http://localhost:3000';

// Screenshot directory (relative to project root)
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

/**
 * Purge legacy screenshots from previous test runs
 * Call this in test.beforeAll() for each test suite
 */
export function purgeLegacyScreenshots(testPrefix: string): void {
  if (fs.existsSync(SCREENSHOT_DIR)) {
    const files = fs.readdirSync(SCREENSHOT_DIR);
    const legacyFiles = files.filter(f => f.startsWith(testPrefix));
    for (const file of legacyFiles) {
      fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
      console.log(`Purged legacy screenshot: ${file}`);
    }
  }
}

/**
 * Take screenshot with visual verification
 * CRITICAL: Screenshot must exist and have content
 */
export async function takeScreenshot(
  page: Page,
  testPrefix: string,
  testName: string,
  step: string
): Promise<string> {
  const screenshotPath = path.join(SCREENSHOT_DIR, `${testPrefix}-${testName}-${step}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved: ${screenshotPath}`);

  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot was not created: ${screenshotPath}`);
  }
  const stats = fs.statSync(screenshotPath);
  if (stats.size < 1000) {
    throw new Error(`Screenshot appears to be empty or corrupted: ${screenshotPath} (${stats.size} bytes)`);
  }

  return screenshotPath;
}

/**
 * Create a new analysis session by clicking the template
 * Uses human-like interaction: click template card
 */
export async function createSession(page: Page, name?: string): Promise<string> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
  await expect(pairwiseTemplate).toBeVisible({ timeout: 10000 });
  await pairwiseTemplate.click();

  await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });

  const url = page.url();
  const match = url.match(/session=([a-f0-9-]+)/);
  const sessionId = match ? match[1] : '';

  if (!sessionId) {
    throw new Error('Failed to extract session ID from URL');
  }

  await expect(page.locator('[data-testid="session-panel"]')).toBeVisible({ timeout: 10000 });

  return sessionId;
}

/**
 * Upload proteomics files ONE-BY-ONE (human-like behavior)
 */
export async function uploadFiles(page: Page, files: string[]): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absolutePaths = files.map(f => {
    if (path.isAbsolute(f)) return f;
    const relativePath = f.replace(/^\.\.\/\.\.\//, '');
    return path.join(projectRoot, relativePath);
  });

  console.log('Uploading files:', absolutePaths);

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    await page.locator('[data-testid="proteomics-upload"]').setInputFiles(filePath);

    const fileName = path.basename(filePath);
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText(fileName, { timeout: 30000 });

    await page.waitForTimeout(500);
  }

  console.log('All files uploaded successfully');
}

/**
 * Upload proteomics files in bulk (all at once)
 */
export async function uploadFilesBulk(page: Page, files: string[]): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absolutePaths = files.map(f => {
    if (path.isAbsolute(f)) return f;
    const relativePath = f.replace(/^\.\.\/\.\.\//, '');
    return path.join(projectRoot, relativePath);
  });

  console.log('Uploading files (bulk):', absolutePaths.map(p => path.basename(p)));

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
  }

  await page.locator('[data-testid="proteomics-upload"]').setInputFiles(absolutePaths);

  for (const filePath of absolutePaths) {
    const fileName = path.basename(filePath);
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText(fileName, { timeout: 60000 });
  }

  console.log('All files uploaded successfully (bulk)');
}

/**
 * Configure analysis parameters
 */
export async function configureAnalysis(
  page: Page,
  config: {
    treatment: string;
    control: string;
    organism: string;
    removeRazor?: boolean;
    strictFiltering?: boolean;
  }
): Promise<void> {
  await expect(page.locator('[data-testid="config-form"]')).toBeVisible({ timeout: 10000 });

  const treatmentSelect = page.locator('[data-testid="treatment-select"]');
  await treatmentSelect.waitFor({ state: 'visible' });
  await treatmentSelect.selectOption(config.treatment);

  const controlSelect = page.locator('[data-testid="control-select"]');
  await controlSelect.waitFor({ state: 'visible' });
  await controlSelect.selectOption(config.control);

  const organismSelect = page.locator('[data-testid="organism-select"]');
  await organismSelect.waitFor({ state: 'visible' });

  const options = await organismSelect.locator('option').allTextContents();
  const validOptions = options.filter(opt => opt && opt !== 'Select organism...');

  if (validOptions.length > 0) {
    const optionToSelect = validOptions.find(opt =>
      opt.toLowerCase().includes(config.organism.toLowerCase())
    ) || validOptions[0];
    await organismSelect.selectOption(optionToSelect);
  }

  if (config.removeRazor !== undefined || config.strictFiltering !== undefined) {
    await page.click('[data-testid="advanced-options-toggle"]');

    if (config.removeRazor !== undefined) {
      const toggle = page.locator('[data-testid="remove-razor-checkbox"]');
      const isChecked = (await toggle.getAttribute('aria-checked')) === 'true';
      if (config.removeRazor !== isChecked) {
        await toggle.click();
      }
    }

    if (config.strictFiltering !== undefined) {
      const toggle = page.locator('[data-testid="strict-filtering-checkbox"]');
      const isChecked = (await toggle.getAttribute('aria-checked')) === 'true';
      if (config.strictFiltering !== isChecked) {
        await toggle.click();
      }
    }
  }
}

/**
 * Start analysis and wait for processing to complete
 */
export async function startAnalysis(page: Page, timeout: number = 300000): Promise<void> {
  const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
  await expect(startBtn).toBeEnabled({ timeout: 10000 });
  await startBtn.click();

  await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
  await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout });
  await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
}

/**
 * Clean up and delete multiple sessions
 * Set PRESERVE_TEST_SESSIONS=true to preserve sessions for debugging
 */
export async function cleanupAllSessions(page: Page, sessionIds: string[]): Promise<void> {
  const preserveSessions = process.env.PRESERVE_TEST_SESSIONS === 'true';

  if (preserveSessions) {
    console.log('[DEBUG] Preserving sessions for investigation');
    return;
  }

  for (const id of sessionIds) {
    try {
      await page.request.delete(`${API_BASE_URL}/api/sessions/${id}`);
    } catch {
      // Ignore cleanup failures
    }
  }
  sessionIds.length = 0;
}

/**
 * Clean up and delete a single session
 * Set PRESERVE_TEST_SESSIONS=true to preserve sessions for debugging
 */
export async function cleanupSession(page: Page, sessionId: string): Promise<void> {
  const preserveSessions = process.env.PRESERVE_TEST_SESSIONS === 'true';

  if (preserveSessions) {
    console.log(`[DEBUG] Preserving session ${sessionId} for investigation`);
    return;
  }

  try {
    const response = await page.request.delete(`${API_BASE_URL}/api/sessions/${sessionId}`);
    if (!response.ok()) {
      console.log(`Failed to delete session ${sessionId}: ${response.status()}`);
    } else {
      console.log(`Session ${sessionId} deleted successfully`);
    }
  } catch (e) {
    console.log(`Cleanup failed for session ${sessionId}:`, e);
  }
}

/**
 * Export types for TypeScript
 */
export interface TestConfig {
  treatment: string;
  control: string;
  organism: string;
  removeRazor?: boolean;
  strictFiltering?: boolean;
}

export interface SessionData {
  id: string;
  name: string;
  state: string;
}
