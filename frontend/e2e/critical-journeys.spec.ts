import { expect, test, type Page } from '@playwright/test';

const session = {
  id: 'e2e-session',
  name: 'E2E analysis',
  template: 'multi_condition_comparison',
  state: 'created',
  pipeline: 'msstats',
  config: { file_type: 'tmt' },
  files: { proteomics: [] },
  created_at: '2026-07-16T12:00:00Z',
  updated_at: '2026-07-16T12:00:00Z',
  error_message: null,
};

async function mockApplicationApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/sessions' && request.method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === '/api/sessions' && request.method() === 'POST') {
      await route.fulfill({ status: 201, json: session });
      return;
    }
    if (path === '/api/sessions/e2e-session' && request.method() === 'GET') {
      await route.fulfill({ json: session });
      return;
    }
    if (path === '/api/sessions/e2e-session/config') {
      await route.fulfill({ json: session });
      return;
    }
    if (path === '/api/organisms') {
      await route.fulfill({
        json: { organisms: [{ id: 'human', name: 'human' }] },
      });
      return;
    }
    if (path === '/api/files/tree') {
      await route.fulfill({ json: { path: '', entries: [] } });
      return;
    }

    await route.fulfill({ status: 404, json: { detail: `Unmocked ${path}` } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApplicationApi(page);
});

test('home exposes released TMT/DIA workflows and documentation', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('welcome-title')).toContainText('ProteomicsViz');
  await expect(page.getByTestId('new-tmt-btn')).toContainText('TMT Analysis');
  await expect(page.getByTestId('new-dia-btn')).toContainText('DIA Analysis');

  await page.getByTestId('help-link').click();
  await expect(page).toHaveURL(/\/about$/);
});

test('creating a TMT analysis enters the upload workflow', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-tmt-btn').click();

  await expect(page).toHaveURL(
    /\/new\/upload\?session=e2e-session&type=tmt$/
  );
});
