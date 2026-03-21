# Playwright Best Practices Research

**Date:** 2026-03-18  
**Source:** Official Playwright Documentation, Community Best Practices, 2024-2025 Articles

---

## 1. Sequential Test Execution Configuration

### Default Behavior
- Playwright runs tests **in parallel by default** using multiple worker processes
- Tests in a single file run **sequentially** in the same worker process
- Workers are isolated processes that can run tests in parallel

### Configuration Options

#### playwright.config.ts
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Run all tests sequentially (workers = 1)
  workers: 1,
  
  // Or configure based on environment
  workers: process.env.CI ? 1 : undefined, // Sequential in CI, parallel locally
  
  // Run specific files/folders sequentially while others parallel
  // Use command line: npx playwright test tests/sequential-folder --workers=1
  
  // Configure test isolation
  fullyParallel: false, // Run tests in same file sequentially (default: true for parallel)
});
```

#### Running Specific Tests Sequentially
```bash
# Run specific folder sequentially
npx playwright test tests/onboarding --workers=1

# Run with single worker (sequential)
npx playwright test --workers=1

# Disable parallelism completely
npx playwright test --fully-parallel=false
```

#### Parallel Within a File
```typescript
import { test } from '@playwright/test';

// Configure parallel execution within a describe block
test.describe.configure({ mode: 'parallel' });

test('runs in parallel 1', async ({ page }) => { /* ... */ });
test('runs in parallel 2', async ({ page }) => { /* ... */ });
```

### Best Practices
- **Avoid test dependencies**: Never write tests that depend on other tests running first
- **Use hooks for setup**: Use `beforeEach`/`beforeAll` instead of relying on test order
- **State isolation**: Each test should create and clean up its own state
- **Sequential for stateful tests**: Use `--workers=1` only when tests modify shared state

---

## 2. Screenshot Capture and Verification

### Visual Regression Testing with `toHaveScreenshot()`

#### Basic Screenshot Comparison
```typescript
import { test, expect } from '@playwright/test';

test('example test', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page).toHaveScreenshot();
});
```

#### Element-Level Screenshots
```typescript
test('component screenshot', async ({ page }) => {
  await page.goto('https://example.com');
  const component = page.locator('.hero-section');
  await expect(component).toHaveScreenshot('hero.png');
});
```

#### Configuration Options
```typescript
// playwright.config.ts
export default defineConfig({
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,        // Allow 100 pixel differences
      threshold: 0.2,            // Per-pixel threshold (0-1)
      animations: 'disabled',    // Disable animations
      scale: 'css',              // Use CSS pixel density
      stylePath: './screenshot.css', // Custom CSS for screenshot
    },
  },
  // Snapshot directory configuration
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
});
```

#### Custom CSS for Screenshots (screenshot.css)
```css
/* Hide dynamic/volatile elements */
iframe,
.ad-banner,
.live-chat,
.cookie-banner {
  visibility: hidden !important;
}

/* Freeze animations */
*,
*::before,
*::after {
  animation-duration: 0s !important;
  transition-duration: 0s !important;
}
```

#### Advanced Screenshot Options
```typescript
test('advanced screenshot', async ({ page }) => {
  await page.goto('https://example.com');
  
  await expect(page).toHaveScreenshot({
    name: 'landing-page.png',
    fullPage: true,              // Capture full page
    clip: { x: 0, y: 0, width: 800, height: 600 }, // Specific region
    mask: [page.locator('.dynamic-date')], // Mask dynamic elements
    maskColor: '#FF0000',        // Red mask color
    omitBackground: true,        // Transparent background
  });
});
```

### Non-Image Snapshots
```typescript
test('text snapshot', async ({ page }) => {
  await page.goto('https://example.com');
  const text = await page.textContent('.hero__title');
  expect(text).toMatchSnapshot('hero-title.txt');
});

test('API response snapshot', async ({ request }) => {
  const response = await request.get('/api/users');
  expect(await response.json()).toMatchSnapshot('users.json');
});
```

### Updating Snapshots
```bash
# Update all snapshots
npx playwright test --update-snapshots

# Update specific test snapshots
npx playwright test example.spec.ts --update-snapshots

# Update only failed snapshots
npx playwright test --update-snapshots --grep "failed-test"
```

### Best Practices
- **Consistent environment**: Run screenshots on same OS/browser version
- **Mask dynamic content**: Dates, times, random IDs should be masked
- **Disable animations**: Use CSS or config to freeze animations
- **Version control**: Commit snapshot files to git
- **Review changes**: Always review snapshot diffs in PRs

---

## 3. Visual Regression Testing

### Complete Visual Test Setup
```typescript
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    // Set consistent viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // Mock date/time for consistency
    await page.addInitScript(() => {
      Date.now = () => 1487076708000;
    });
  });

  test('homepage visual test', async ({ page }) => {
    await page.goto('https://example.com');
    
    // Wait for critical elements
    await page.waitForLoadState('networkidle');
    
    // Take screenshot with masking
    await expect(page).toHaveScreenshot('homepage.png', {
      mask: [
        page.locator('.current-time'),
        page.locator('.random-id'),
      ],
      fullPage: true,
    });
  });

  test('responsive breakpoints', async ({ page }) => {
    const breakpoints = [
      { name: 'mobile', width: 375, height: 667 },
      { name: 'tablet', width: 768, height: 1024 },
      { name: 'desktop', width: 1920, height: 1080 },
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto('https://example.com');
      await expect(page).toHaveScreenshot(`homepage-${bp.name}.png`);
    }
  });
});
```

### Handling Dynamic Content
```typescript
test('masked screenshot', async ({ page }) => {
  await page.goto('https://example.com');
  
  // Mask multiple dynamic elements
  await expect(page).toHaveScreenshot({
    mask: [
      page.locator('[data-testid="timestamp"]'),
      page.locator('[data-testid="user-avatar"]'),
      page.locator('.ad-banner'),
    ],
  });
});

// Alternative: Replace dynamic content before screenshot
test('stabilized screenshot', async ({ page }) => {
  await page.goto('https://example.com');
  
  // Replace dynamic dates with static text
  await page.evaluate(() => {
    document.querySelectorAll('.date').forEach(el => {
      el.textContent = 'Jan 1, 2024';
    });
  });
  
  await expect(page).toHaveScreenshot();
});
```

### Threshold Configuration
```typescript
// playwright.config.ts
export default defineConfig({
  expect: {
    toHaveScreenshot: {
      // Pixelmatch options
      threshold: 0.2,              // 0-1, per-pixel difference threshold
      maxDiffPixels: 100,          // Maximum differing pixels allowed
      maxDiffPixelRatio: 0.01,     // Maximum ratio of differing pixels
      
      // Anti-aliasing
      diffMask: true,              // Ignore anti-aliased pixels
      
      // Include/exclude areas
      clip: { x: 0, y: 0, width: 800, height: 600 },
    },
  },
});
```

---

## 4. Human-Like Interactions

### Realistic Typing

#### Built-in Delay Option
```typescript
// Basic human-like typing with fixed delay
await page.getByLabel('Username').type('john_doe', {
  delay: 100, // 100ms between keystrokes
});
```

#### Advanced Human Typing Function
```typescript
// Custom human-like typing with variable delays
async function humanType(locator: Locator, text: string) {
  for (const char of text) {
    // Random delay between 50-150ms
    const delay = Math.floor(Math.random() * 100) + 50;
    await locator.press(char, { delay });
  }
}

// Usage
await humanType(page.getByLabel('Username'), 'john_doe');
```

#### Realistic Typing with Mistakes
```typescript
async function realisticType(locator: Locator, text: string, typoChance = 0.05) {
  const chars = text.split('');
  let i = 0;
  
  while (i < chars.length) {
    const char = chars[i];
    
    // Occasionally make a typo
    if (Math.random() < typoChance && i > 0) {
      const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await locator.press(wrongChar, { delay: Math.random() * 100 + 50 });
      await locator.press('Backspace', { delay: Math.random() * 200 + 100 });
    }
    
    // Type the correct character
    const baseDelay = Math.random() * 100 + 50;
    // Slower for special characters
    const delay = /[A-Z0-9!@#$%^&*()]/.test(char) ? baseDelay * 1.5 : baseDelay;
    
    await locator.press(char, { delay });
    i++;
  }
}

// Usage
await realisticType(page.getByLabel('Password'), 'MyP@ssw0rd!');
```

### Realistic Clicking

#### Natural Click Patterns
```typescript
// Standard click with auto-waiting
await page.getByRole('button', { name: 'Submit' }).click();

// Click with custom position (not center)
await page.locator('.card').click({
  position: { x: 10, y: 10 }, // Click near top-left corner
});

// Right-click with delay
await page.locator('.context-menu-trigger').click({
  button: 'right',
  delay: 100, // Delay between mousedown and mouseup
});

// Double-click
await page.locator('.file').dblclick();

// Click with modifiers
await page.getByText('Link').click({
  modifiers: ['ControlOrMeta'], // Ctrl on Win/Linux, Cmd on Mac
});
```

#### Hover and Move Patterns
```typescript
// Natural hover with steps
await page.locator('.dropdown-trigger').hover({
  steps: 5, // Move mouse in 5 interpolated steps
});

// Drag with natural movement
const source = page.locator('#draggable');
const target = page.locator('#dropzone');
await source.dragTo(target, {
  steps: 10, // More steps = smoother movement
  timeout: 5000,
});

// Mouse movement simulation
await page.mouse.move(100, 100, { steps: 5 });
await page.mouse.down();
await page.mouse.move(200, 200, { steps: 10 });
await page.mouse.up();
```

### Navigation Patterns

#### Human-Like Navigation
```typescript
test('natural user flow', async ({ page }) => {
  // Start at homepage
  await page.goto('https://example.com');
  await page.waitForLoadState('networkidle');
  
  // Scroll naturally before clicking
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(200);
  
  // Click with realistic delay
  await page.getByRole('link', { name: 'Products' }).click();
  await page.waitForURL('**/products');
  
  // Pause as if reading
  await page.waitForTimeout(500);
  
  // Hover before clicking
  await page.getByRole('button', { name: 'Add to Cart' }).hover();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Add to Cart' }).click();
});
```

### Avoiding Bot Detection
```typescript
// playwright.config.ts - More human-like browser
export default defineConfig({
  use: {
    // Use headed mode when possible (harder to detect)
    headless: false,
    
    // Set realistic viewport
    viewport: { width: 1920, height: 1080 },
    
    // Set user agent
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    
    // Set locale and timezone
    locale: 'en-US',
    timezoneId: 'America/New_York',
    
    // Grant permissions gradually
    permissions: ['notifications'],
    
    // Context options
    contextOptions: {
      // Reduce automation flags
      bypassCSP: true,
    },
  },
});

// Add human-like delays between actions
async function humanDelay(min = 100, max = 500) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

// Usage in tests
await page.getByRole('button').click();
await humanDelay();
await page.getByRole('link').click();
```

---

## 5. Test Isolation and Cleanup

### Hook Hierarchy
```typescript
import { test, expect } from '@playwright/test';

// Runs once before all tests in the file
test.beforeAll(async ({ browser }) => {
  console.log('Global setup for test file');
});

// Runs before each test
test.beforeEach(async ({ page, context }) => {
  // Fresh page for each test
  await page.goto('https://example.com');
  
  // Set up auth state
  await context.addCookies([
    { name: 'session', value: 'test-session', domain: 'example.com', path: '/' }
  ]);
});

// Runs after each test
test.afterEach(async ({ page }, testInfo) => {
  // Take screenshot on failure
  if (testInfo.status !== testInfo.expectedStatus) {
    await page.screenshot({ 
      path: `test-results/${testInfo.title}-failure.png`,
      fullPage: true 
    });
  }
  
  // Clean up any created data
  await cleanupTestData(testInfo.title);
});

// Runs once after all tests
test.afterAll(async () => {
  console.log('Global cleanup for test file');
});

test('first test', async ({ page }) => { /* ... */ });
test('second test', async ({ page }) => { /* ... */ });
```

### Describe-Level Hooks
```typescript
test.describe('User Management', () => {
  // Only runs for tests in this describe block
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Sign In' }).click();
  });

  test('can create user', async ({ page }) => { /* ... */ });
  test('can delete user', async ({ page }) => { /* ... */ });
});

test.describe('Product Catalog', () => {
  // Different setup for different feature area
  test.beforeEach(async ({ page }) => {
    await page.goto('/products');
  });

  test('can view products', async ({ page }) => { /* ... */ });
});
```

### Isolation Strategies

#### Strategy 1: Fresh Context Per Test (Default)
```typescript
// Each test gets isolated context automatically
test('test 1', async ({ page, context }) => {
  // Context is fresh - no cookies, localStorage, etc.
});

test('test 2', async ({ page, context }) => {
  // Completely isolated from test 1
});
```

#### Strategy 2: Reuse Authentication State
```typescript
// auth.setup.ts
import { test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('user');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  
  // Save auth state
  await page.context().storageState({ path: authFile });
});

// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: '**/*.setup.ts' },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

#### Strategy 3: Database Isolation
```typescript
// utils/test-helpers.ts
export async function createIsolatedTestUser() {
  const uniqueId = Date.now() + Math.random().toString(36).substring(7);
  const user = await db.users.create({
    email: `test-${uniqueId}@example.com`,
    name: `Test User ${uniqueId}`,
  });
  
  return {
    user,
    cleanup: async () => {
      await db.users.delete({ where: { id: user.id } });
    },
  };
}

// In test
test('user can update profile', async ({ page }) => {
  const { user, cleanup } = await createIsolatedTestUser();
  
  try {
    await page.goto(`/users/${user.id}/profile`);
    // ... test code
  } finally {
    await cleanup();
  }
});
```

### Cleanup Patterns
```typescript
// Pattern 1: Automatic cleanup with try/finally
test('creates resource', async ({ page }) => {
  const resources: string[] = [];
  
  try {
    await page.goto('/resources');
    await page.getByRole('button', { name: 'Create' }).click();
    
    const resourceId = await page.locator('[data-resource-id]').getAttribute('data-resource-id');
    resources.push(resourceId);
    
    // Test assertions...
  } finally {
    // Cleanup all created resources
    for (const id of resources) {
      await api.deleteResource(id);
    }
  }
});

// Pattern 2: Using testInfo for cleanup
test('another test', async ({ page }, testInfo) => {
  testInfo.attach('cleanup-required', { body: 'true' });
  
  // Test code...
});

test.afterEach(async ({}, testInfo) => {
  const needsCleanup = testInfo.attachments.find(a => a.name === 'cleanup-required');
  if (needsCleanup) {
    await performCleanup(testInfo.title);
  }
});
```

---

## 6. Handling Async Operations and Waits

### Auto-Waiting (Playwright's Superpower)
```typescript
// Playwright automatically waits for elements to be ready
await page.getByRole('button').click(); // Waits for button to be visible & enabled

// Locators auto-wait for matching elements
const locator = page.getByText('Loading...');
await expect(locator).not.toBeVisible(); // Waits for element to disappear
```

### Wait Strategies

#### Preferred: Web-First Assertions
```typescript
// ✅ GOOD: Auto-waiting assertions
await expect(page.getByText('Success')).toBeVisible();
await expect(page.getByRole('button')).toBeEnabled();
await expect(page).toHaveURL(/\/dashboard/);
await expect(page.getByTestId('list')).toHaveCount(5);

// ❌ BAD: Manual polling
while (!(await page.getByText('Success').isVisible())) {
  await page.waitForTimeout(100);
}
```

#### Explicit Waits (When Needed)
```typescript
// Wait for navigation
await page.goto('https://example.com');
await page.waitForURL('**/dashboard');

// Wait for load states
await page.waitForLoadState('networkidle'); // No network activity for 500ms
await page.waitForLoadState('domcontentloaded');
await page.waitForLoadState('load');

// Wait for element state
await page.getByRole('button').waitFor({ state: 'visible' });
await page.getByRole('button').waitFor({ state: 'hidden' });
await page.getByRole('button').waitFor({ state: 'attached' });
await page.getByRole('button').waitFor({ state: 'detached' });

// Wait with timeout
await page.getByText('Loading').waitFor({ 
  state: 'hidden',
  timeout: 10000 
});
```

#### Wait For Functions
```typescript
// Wait for custom JavaScript condition
await page.waitForFunction(() => {
  return document.querySelector('.items').childElementCount >= 5;
});

// Wait with arguments
await page.waitForFunction(
  (expectedCount) => document.querySelectorAll('.item').length >= expectedCount,
  10 // argument passed to function
);

// Wait for specific selector
await page.waitForSelector('.modal[aria-hidden="false"]');
```

### Handling Dynamic Content
```typescript
// Wait for API response
await Promise.all([
  page.waitForResponse('**/api/users'),
  page.getByRole('button', { name: 'Load Users' }).click(),
]);

// Wait for multiple responses
await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/data') && resp.status() === 200),
  page.waitForResponse(resp => resp.url().includes('/api/config')),
  page.reload(),
]);

// Wait for request to be made
await page.waitForRequest('**/api/track');
```

### Race Conditions and Parallel Operations
```typescript
// Race between multiple conditions
await Promise.race([
  page.waitForSelector('.success-message'),
  page.waitForSelector('.error-message'),
]);

// Sequential async operations
const items = page.locator('.item');
const count = await items.count();

for (let i = 0; i < count; i++) {
  await items.nth(i).click();
  await page.waitForLoadState('networkidle');
}

// Parallel operations (when independent)
const [result1, result2] = await Promise.all([
  page.locator('.section-1').textContent(),
  page.locator('.section-2').textContent(),
]);
```

### Avoiding Flakiness
```typescript
// ❌ BAD: Hard waits
await page.waitForTimeout(2000); // Never do this!

// ✅ GOOD: Wait for specific condition
await page.getByText('Loaded').waitFor();

// ✅ GOOD: Wait for network idle after action
await page.getByRole('button').click();
await page.waitForLoadState('networkidle');

// ✅ GOOD: Retry-able assertions
await expect.poll(async () => {
  const response = await page.request.get('/api/status');
  return response.status();
}, {
  message: 'API to return 200',
  intervals: [1000, 2000, 5000],
  timeout: 30000,
}).toBe(200);
```

### Timeout Configuration
```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 30000,           // Test timeout (30 seconds)
  expect: {
    timeout: 5000,          // Assertion timeout (5 seconds)
  },
  use: {
    actionTimeout: 10000,   // Action timeout (10 seconds)
    navigationTimeout: 30000, // Navigation timeout
  },
});

// Per-action timeout override
await page.getByRole('button').click({ timeout: 20000 });

// Per-assertion timeout override
await expect(page.getByText('Success')).toBeVisible({ timeout: 15000 });
```

### Async/Await Patterns
```typescript
// Sequential execution (default)
test('sequential', async ({ page }) => {
  await page.goto('/page1');
  await page.getByRole('button').click();
  await page.goto('/page2');
});

// Parallel execution (when safe)
test('parallel data fetching', async ({ page }) => {
  await page.goto('/dashboard');
  
  const [userData, orderData, statsData] = await Promise.all([
    page.locator('.user-data').textContent(),
    page.locator('.order-data').textContent(),
    page.locator('.stats-data').textContent(),
  ]);
});

// Conditional waiting
test('conditional', async ({ page }) => {
  await page.goto('/conditional-page');
  
  // Check if element exists before waiting
  const modal = page.locator('.modal');
  if (await modal.isVisible().catch(() => false)) {
    await modal.getByRole('button', { name: 'Close' }).click();
  }
  
  // Continue with test...
});
```

---

## Summary Checklist

### Sequential Execution
- [ ] Use `--workers=1` for stateful test suites
- [ ] Avoid test dependencies; use hooks instead
- [ ] Configure `fullyParallel` based on test isolation needs

### Screenshots & Visual Testing
- [ ] Use `toHaveScreenshot()` for visual regression
- [ ] Mask dynamic content (dates, IDs, ads)
- [ ] Disable animations with CSS
- [ ] Set appropriate `maxDiffPixels` threshold
- [ ] Commit snapshots to version control

### Human-Like Interactions
- [ ] Add delays between keystrokes (`{ delay: 100 }`)
- [ ] Use realistic viewport sizes
- [ ] Add small pauses between actions
- [ ] Hover before clicking when appropriate
- [ ] Use `steps` parameter for smooth mouse movements

### Test Isolation
- [ ] Use `beforeEach` for per-test setup
- [ ] Clean up in `afterEach` (even on failure)
- [ ] Create isolated test data with unique identifiers
- [ ] Use storage state for authentication reuse
- [ ] Never share state between tests

### Async Operations
- [ ] Prefer web-first assertions over manual waits
- [ ] Never use `waitForTimeout()` (hard waits)
- [ ] Use `waitForLoadState('networkidle')` after actions
- [ ] Handle race conditions with `Promise.race()`
- [ ] Set appropriate timeouts in config

---

## Additional Resources

- [Official Playwright Documentation](https://playwright.dev/docs/intro)
- [Best Practices Guide](https://playwright.dev/docs/best-practices)
- [Visual Comparisons](https://playwright.dev/docs/test-snapshots)
- [Locators Guide](https://playwright.dev/docs/locators)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
