import { defineConfig, devices } from '@playwright/test'

const connectedPort = Number(process.env.E2E_CONNECTED_PORT ?? 43131)
const connectedBaseUrl = `http://127.0.0.1:${connectedPort}`

export default defineConfig({
  testDir: './e2e-connected',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: './e2e-connected/global-setup.ts',
  globalTeardown: './e2e-connected/global-teardown.ts',
  reporter: 'list',
  use: { baseURL: connectedBaseUrl, ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `npm run dev:connected -- --port ${connectedPort}`, url: connectedBaseUrl, reuseExistingServer: false, timeout: 120_000 },
})
