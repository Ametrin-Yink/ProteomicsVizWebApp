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

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

/**
 * Purge legacy screenshots from previous test runs
 */
export function purgeLegacyScreenshots(testPrefix: string): void {
  if (fs.existsSync(SCREENSHOT_DIR)) {
    const files = fs.readdirSync(SCREENSHOT_DIR);
    const legacyFiles = files.filter(f => f.startsWith(testPrefix));
    for (const file of legacyFiles) {
      fs.unlinkSync(path.join(SCREENSHOT_DIR, file));
    }
  }
}

/**
 * Take screenshot with visual verification
 */
export async function takeScreenshot(
  page: Page,
  testPrefix: string,
  testName: string,
  step: string
): Promise<string> {
  const screenshotPath = path.join(SCREENSHOT_DIR, `${testPrefix}-${testName}-${step}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot was not created: ${screenshotPath}`);
  }
  const stats = fs.statSync(screenshotPath);
  if (stats.size < 1000) {
    throw new Error(`Screenshot appears empty: ${screenshotPath} (${stats.size} bytes)`);
  }
  return screenshotPath;
}

/**
 * Start a new analysis via the "+ New Analysis" button in the top nav.
 * Returns the session ID extracted from the URL.
 */
export async function startNewAnalysis(page: Page, name?: string): Promise<string> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const newAnalysisBtn = page.locator('[data-testid="new-analysis-btn"]').first();
  await expect(newAnalysisBtn).toBeVisible({ timeout: 10000 });
  await newAnalysisBtn.click();

  // Should navigate to the upload step of the wizard
  await expect(page).toHaveURL(/\/new\/upload\?session=[a-f0-9-]+/, { timeout: 15000 });

  const url = page.url();
  const match = url.match(/session=([a-f0-9-]+)/);
  const sessionId = match ? match[1] : '';
  if (!sessionId) throw new Error('Failed to extract session ID from URL');

  return sessionId;
}

/**
 * Upload proteomics CSV files one-by-one (human-like behavior).
 */
export async function uploadFiles(page: Page, files: string[]): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absolutePaths = files.map(f => {
    if (path.isAbsolute(f)) return f;
    return path.join(projectRoot, f.replace(/^\.\.\/\.\.\//, ''));
  });

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    await page.locator('[data-testid="proteomics-upload"]').setInputFiles(filePath, { force: true });
    const fileName = path.basename(filePath);
    // Expand the collapsible file list first (folded by default), then verify filename visible
    const toggleBtn = page.locator('[data-testid="uploaded-files-list"] > button');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(200);
    }
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText(fileName, { timeout: 30000 });
    await page.waitForTimeout(100);
  }
}

/**
 * Upload proteomics CSV files in bulk (all at once).
 */
export async function uploadFilesBulk(page: Page, files: string[]): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absolutePaths = files.map(f => {
    if (path.isAbsolute(f)) return f;
    return path.join(projectRoot, f.replace(/^\.\.\/\.\.\//, ''));
  });

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  }

  await page.locator('[data-testid="proteomics-upload"]').setInputFiles(absolutePaths);

  // Expand the collapsible file list first (folded by default)
  const toggleBtn = page.locator('[data-testid="uploaded-files-list"] > button');
  if (await toggleBtn.isVisible()) {
    await toggleBtn.click();
    await page.waitForTimeout(200);
  }

  for (const filePath of absolutePaths) {
    const fileName = path.basename(filePath);
    await expect(page.locator('[data-testid="uploaded-files-list"]')).toContainText(fileName, { timeout: 60000 });
  }
}

/**
 * Step 1: Configure experiment on the upload page.
 * Sets treatment, control, organism, and toggles.
 */
export async function configureExperiment(
  page: Page,
  config: {
    treatment: string;
    control: string;
    organism: string;
    removeRazor?: boolean;
    strictFiltering?: boolean;
  }
): Promise<void> {
  // Wait for condition selects to be visible
  await expect(page.locator('[data-testid="treatment-select"]')).toBeVisible({ timeout: 10000 });

  await page.locator('[data-testid="treatment-select"]').selectOption(config.treatment);
  await page.locator('[data-testid="control-select"]').selectOption(config.control);

  // Organism - select first available matching option
  const organismSelect = page.locator('[data-testid="organism-select"]');
  await organismSelect.waitFor({ state: 'visible' });
  const options = await organismSelect.locator('option').allTextContents();
  const validOptions = options.filter(opt => opt && opt !== 'Select organism...');
  if (validOptions.length > 0) {
    const match = validOptions.find(opt =>
      opt.toLowerCase().includes(config.organism.toLowerCase())
    ) || validOptions[0];
    await organismSelect.selectOption(match);
  }

  // Toggles - click label if checkbox state doesn't match desired
  if (config.removeRazor) {
    const cb = page.locator('[data-testid="remove-razor-checkbox"]');
    if (!(await cb.isChecked())) await cb.click({ force: true });
  }
  if (config.strictFiltering) {
    const cb = page.locator('[data-testid="strict-filtering-checkbox"]');
    if (!(await cb.isChecked())) await cb.click({ force: true });
  }
}

/**
 * Click Continue on the upload page to proceed to pipeline selection.
 */
export async function continueToPipeline(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="upload-continue-btn"]');
  await expect(btn).toBeEnabled({ timeout: 10000 });
  await btn.click();
  await expect(page).toHaveURL(/\/new\/pipeline\?session=/, { timeout: 10000 });
}

/**
 * Step 2: Select a pipeline (msqrob2 or msstats).
 */
export async function selectPipeline(page: Page, pipeline: 'msqrob2' | 'msstats'): Promise<void> {
  await expect(page.locator(`[data-testid="pipeline-card-${pipeline}"]`)).toBeVisible({ timeout: 10000 });
  await page.locator(`[data-testid="pipeline-card-${pipeline}"]`).click();
}

/**
 * Click Continue on the pipeline page to proceed to config.
 */
export async function continueToConfig(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="pipeline-continue-btn"]');
  await expect(btn).toBeEnabled({ timeout: 10000 });
  await btn.click();
  await expect(page).toHaveURL(/\/new\/config\?session=/, { timeout: 10000 });
}

/**
 * Click Start Analysis and verify navigation to the processing page.
 * Optionally waits for pipeline completion.
 */
export async function startAnalysis(page: Page, opts?: { waitForCompletion?: boolean; timeout?: number }): Promise<void> {
  const waitForCompletion = opts?.waitForCompletion ?? true;
  const timeout = opts?.timeout ?? 600000;

  const startBtn = page.locator('[data-testid="start-analysis-btn"]');
  await expect(startBtn).toBeEnabled({ timeout: 10000 });
  await startBtn.click();

  // Navigate to processing page
  await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
  await expect(page.locator('[data-testid="processing-page"]')).toBeVisible({ timeout: 15000 });

  if (waitForCompletion) {
    // Wait for completion
    await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout });
    // Auto-redirect to visualization
    await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
  }
}

/**
 * Clean up and delete multiple sessions via API.
 */
export async function cleanupAllSessions(page: Page, sessionIds: string[]): Promise<void> {
  if (process.env.PRESERVE_TEST_SESSIONS === 'true') return;

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
 * Clean up and delete a single session via API.
 */
export async function cleanupSession(page: Page, sessionId: string): Promise<void> {
  if (process.env.PRESERVE_TEST_SESSIONS === 'true') return;

  try {
    const response = await page.request.delete(`${API_BASE_URL}/api/sessions/${sessionId}`);
    if (!response.ok()) {
      console.log(`Failed to delete session ${sessionId}: ${response.status()}`);
    }
  } catch (e) {
    console.log(`Cleanup failed for session ${sessionId}:`, e);
  }
}

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
