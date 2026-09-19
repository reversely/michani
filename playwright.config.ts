import { defineConfig } from '@playwright/test';

// End-to-end suites S1, S3, and S5. They expect the local Supabase stack to be running
// (`supabase start`) and start the Vite dev server themselves.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: 'docs/progress/playwright-report' },
    ],
  ],
  use: {
    baseURL: 'http://localhost:3000/cadam/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/cadam/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
