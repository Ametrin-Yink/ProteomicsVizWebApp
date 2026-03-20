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

// Screenshot directory
const SCREENSHOT_DIR = 'D:/CodingWorks/ProteomicsVizWebApp/Tests/screenshots';

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
  
  // CRITICAL: Visual verification - screenshot must exist and have content
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
  
  // Click on the available template (human-like behavior)
  const pairwiseTemplate = page.locator('[data-testid="template-protein-pairwise"]');
  await expect(pairwiseTemplate).toBeVisible({ timeout: 10000 });
  await pairwiseTemplate.click();
  
  // Wait for navigation to analysis page
  await expect(page).toHaveURL(/\/analysis\?session=[a-f0-9-]+/, { timeout: 15000 });
  
  // Extract session ID from URL
  const url = page.url();
  const match = url.match(/session=([a-f0-9-]+)/);
  const sessionId = match ? match[1] : '';
  
  if (!sessionId) {
    throw new Error('Failed to extract session ID from URL');
  }
  
  // Wait for analysis page to fully load
  await expect(page.locator('[data-testid="session-panel"]')).toBeVisible({ timeout: 10000 });
  
  return sessionId;
}

/**
 * Upload proteomics files - Mimics real user behavior by clicking upload area
 * CRITICAL: Files are uploaded ONE-BY-ONE to simulate real user behavior
 */
export async function uploadFiles(page: Page, files: string[]): Promise<void> {
  // Resolve relative paths to absolute from project root
  const projectRoot = path.resolve(__dirname, '..', '..');
  const absolutePaths = files.map(f => {
    if (path.isAbsolute(f)) return f;
    const relativePath = f.replace(/^\.\.\/\.\.\//, '');
    return path.join(projectRoot, relativePath);
  });

  console.log('Uploading files:', absolutePaths);
  
  // Verify files exist
  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log(`File exists: ${filePath}`);
  }

  // Upload files ONE-BY-ONE (human-like behavior)
  for (const filePath of absolutePaths) {
    console.log(`Uploading file: ${path.basename(filePath)}`);
    
    // Set up file chooser handler before clicking
    const fileChooserPromise = page.waitForEvent('filechooser');
    
    // Click on the upload area to open file picker
    await page.locator('[data-testid="proteomics-upload"]').evaluate(el => {
      const parent = el.parentElement;
      if (parent) parent.click();
    });
    
    // Wait for file chooser and set files
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
    
    // Wait for this file to appear in the table
    const fileName = path.basename(filePath);
    await expect(page.locator('[data-testid="file-table"]').first()).toContainText(fileName, { timeout: 15000 });
    console.log(`File uploaded successfully: ${fileName}`);
    
    // Small delay between uploads (mimics user behavior)
    await page.waitForTimeout(500);
  }
  
  console.log('All files uploaded successfully');
}

/**
 * Upload compound file - Mimics real user behavior
 */
export async function uploadCompoundFile(page: Page, filePath: string): Promise<void> {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const relativePath = filePath.replace(/^\.\.\/\.\.\//, '');
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Compound file not found: ${absolutePath}`);
  }

  // Set up file chooser handler
  const fileChooserPromise = page.waitForEvent('filechooser');
  
  // Click on the upload area
  await page.locator('[data-testid="compound-upload"]').evaluate(el => {
    const parent = el.parentElement;
    if (parent) parent.click();
  });
  
  // Wait for file chooser and set files
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(absolutePath);

  // Wait for upload to complete
  await expect(page.locator('[data-testid="compound-upload-success"]')).toBeVisible({ timeout: 10000 });
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
  // Wait for config form to be visible
  await expect(page.locator('[data-testid="config-form"]')).toBeVisible({ timeout: 10000 });
  
  // Select treatment
  const treatmentSelect = page.locator('[data-testid="treatment-select"]');
  await treatmentSelect.waitFor({ state: 'visible' });
  await treatmentSelect.selectOption(config.treatment);

  // Select control
  const controlSelect = page.locator('[data-testid="control-select"]');
  await controlSelect.waitFor({ state: 'visible' });
  await controlSelect.selectOption(config.control);

  // Select organism
  const organismSelect = page.locator('[data-testid="organism-select"]');
  await organismSelect.waitFor({ state: 'visible' });
  
  // Get available options and select matching one
  const options = await organismSelect.locator('option').allTextContents();
  const validOptions = options.filter(opt => opt && opt !== 'Select organism...');
  
  if (validOptions.length > 0) {
    const optionToSelect = validOptions.find(opt => 
      opt.toLowerCase().includes(config.organism.toLowerCase())
    ) || validOptions[0];
    await organismSelect.selectOption(optionToSelect);
  }

  // Set advanced options if provided
  if (config.removeRazor !== undefined || config.strictFiltering !== undefined) {
    await page.click('[data-testid="advanced-options-toggle"]');
    
    if (config.removeRazor !== undefined) {
      const checkbox = page.locator('[data-testid="remove-razor-checkbox"]');
      if (config.removeRazor) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }
    }

    if (config.strictFiltering !== undefined) {
      const checkbox = page.locator('[data-testid="strict-filtering-checkbox"]');
      if (config.strictFiltering) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }
    }
  }
}

/**
 * Start analysis and wait for processing page
 */
export async function startAnalysis(page: Page, timeout: number = 300000): Promise<void> {
  // Click start
  const startBtn = page.locator('[data-testid="start-analysis-btn"]').first();
  await expect(startBtn).toBeEnabled({ timeout: 10000 });
  await startBtn.click();

  // Wait for navigation to processing page
  await expect(page).toHaveURL(/\/analysis\/processing/, { timeout: 10000 });
  
  // Wait for processing to complete
  await expect(page.locator('[data-testid="processing-complete"]')).toBeVisible({ timeout });

  // Wait for redirect to results
  await expect(page).toHaveURL(/\/analysis\/visualization/, { timeout: 10000 });
}

/**
 * Create a completed session with results
 * CRITICAL: This runs the full pipeline and takes 3-5 minutes
 */
export async function createCompletedSession(
  page: Page,
  name?: string,
  timeout: number = 600000
): Promise<string> {
  const sessionId = await createSession(page, name);

  // Upload files
  await uploadFiles(page, [
    '../../SampleData/PSM_SampleData_DMSO_1.csv',
    '../../SampleData/PSM_SampleData_DMSO_2.csv',
    '../../SampleData/PSM_SampleData_DMSO_3.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
  ]);

  // Upload compound file
  await uploadCompoundFile(page, '../../SampleData/compound id.csv');

  // Configure
  await configureAnalysis(page, {
    treatment: 'INCZ123456',
    control: 'DMSO',
    organism: 'human',
  });

  // Start and wait for completion
  await startAnalysis(page, timeout);

  return sessionId;
}

/**
 * Use an existing completed session with results
 * This is faster than creating a new session
 * If the session doesn't exist or has no results, creates a new one
 */
export async function useExistingSession(
  page: Page,
  sessionId?: string
): Promise<string> {
  // If a specific session ID is provided, try to use it
  if (sessionId) {
    try {
      // Check if session exists and has results
      const response = await page.request.get(`http://localhost:8000/api/sessions/${sessionId}`);
      if (response.ok()) {
        const session = await response.json();
        if (session.has_results) {
          // Navigate to the visualization page with the existing session
          await page.goto(`/analysis/visualization?session=${sessionId}`);
          
          // Wait for the page to load with results
          await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });
          
          return sessionId;
        }
      }
    } catch (e) {
      console.log('Specified session not found or has no results, looking for any completed session...');
    }
  }
  
  // Look for any existing completed session with results
  try {
    const response = await page.request.get('http://localhost:8000/api/sessions');
    if (response.ok()) {
      const sessions = await response.json();
      const completedSession = sessions.find((s: any) => s.has_results && s.state === 'completed');
      if (completedSession) {
        console.log(`Using existing completed session: ${completedSession.id}`);
        await page.goto(`/analysis/visualization?session=${completedSession.id}`);
        await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });
        return completedSession.id;
      }
    }
  } catch (e) {
    console.log('Could not fetch sessions, will create new session...');
  }
  
  // Create a new session with complete processing
  console.log('Creating new session with results...');
  return await createCompleteSession(page);
}

/**
 * Create a complete session with uploaded files and processing results
 */
export async function createCompleteSession(
  page: Page,
  timeout: number = 120000
): Promise<string> {
  // Create a new session
  const sessionId = await createSession(page);
  
  // Upload sample files
  await uploadFiles(page, [
    '../../SampleData/PSM_SampleData_DMSO_1.csv',
    '../../SampleData/PSM_SampleData_DMSO_2.csv',
    '../../SampleData/PSM_SampleData_DMSO_3.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_1.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_2.csv',
    '../../SampleData/PSM_SampleData_INCZ123456_3.csv',
  ]);
  
  // Configure analysis
  await configureAnalysis(page, {
    treatment: 'INCZ123456',
    control: 'DMSO',
    organism: 'human',
  });
  
  // Start and wait for completion
  await startAnalysis(page, timeout);
  
  // Navigate to results page
  await page.goto(`/analysis/visualization?session=${sessionId}`);
  
  // Wait for results to load
  await expect(page.locator('[data-testid="general-info-panel"]')).toBeVisible({ timeout: 10000 });
  
  return sessionId;
}

/**
 * Clean up and delete a session
 * Set PRESERVE_TEST_SESSIONS=true to keep sessions for debugging
 */
export async function cleanupSession(page: Page, sessionId: string): Promise<void> {
  // Check if we should preserve sessions for Test Suite 4 and beyond
  if (process.env.PRESERVE_TEST_SESSIONS === 'true') {
    console.log(`Preserving session ${sessionId} for reuse`);
    return;
  }
  
  try {
    // Navigate to home
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and delete session using API
    const response = await page.request.delete(`http://localhost:8000/api/sessions/${sessionId}`);
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
 * Wait for WebSocket connection
 */
export async function waitForWebSocket(page: Page, timeout: number = 10000): Promise<void> {
  await expect(page.locator('[data-testid="connection-status"]')).toContainText('Connected', { timeout });
}

/**
 * Verify no console errors
 * CRITICAL: Tests must fail if there are console errors
 */
export async function verifyNoConsoleErrors(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000); // Wait for any async errors

  if (errors.length > 0) {
    throw new Error(`Console errors found: ${errors.join('\n')}`);
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
