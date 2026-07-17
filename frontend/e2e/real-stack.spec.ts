import { expect, test } from '@playwright/test';

const backendUrl = 'http://127.0.0.1:8766';

test('TMT creation is persisted by the real backend', async ({ page, request }) => {
  let sessionId: string | null = null;

  try {
    await page.goto('/');
    await page.getByTestId('new-tmt-btn').click();
    await expect(page).toHaveURL(
      /\/new\/upload\?session=[0-9a-f-]{36}&type=tmt$/
    );

    sessionId = new URL(page.url()).searchParams.get('session');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    await expect.poll(async () => {
      const response = await request.get(
        `${backendUrl}/api/sessions/${sessionId}`
      );
      if (!response.ok()) return null;
      const session = await response.json() as {
        state: string;
        template: string;
        config: { file_type?: string } | null;
      };
      return {
        state: session.state,
        template: session.template,
        fileType: session.config?.file_type,
      };
    }).toEqual({
      state: 'configuring',
      template: 'multi_condition_comparison',
      fileType: 'tmt',
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Upload & Experiment Setup' })).toBeVisible();
    await expect(page.getByText('MSstats Pipeline')).toBeVisible();
  } finally {
    if (sessionId) {
      await request.delete(`${backendUrl}/api/sessions/${sessionId}`);
    }
  }
});
