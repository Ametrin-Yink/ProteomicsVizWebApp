import fs from 'fs';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

const localPython = path.resolve(__dirname, '../../backend/.venv/Scripts/python.exe');
const python = process.env.E2E_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
const backendUrl = 'http://127.0.0.1:8766';
const frontendUrl = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: frontendUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `"${python}" Tests/support/run_e2e_backend.py`,
      cwd: path.resolve(__dirname, '../..'),
      url: `${backendUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        BACKEND_URL: backendUrl,
        NEXT_PUBLIC_API_URL: '',
        NEXT_DIST_DIR: '.next-e2e',
      },
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
