import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-connected',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: './e2e-connected/global-setup.ts',
  globalTeardown: './e2e-connected/global-teardown.ts',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:43131', ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev:connected', url: 'http://127.0.0.1:43131', reuseExistingServer: false, timeout: 120_000 },
})
