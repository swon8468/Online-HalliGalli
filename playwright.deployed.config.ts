import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL
if (!baseURL?.startsWith('https://')) throw new Error('E2E_BASE_URL에 HTTPS 배포 주소가 필요합니다.')

export default defineConfig({
  testDir: './e2e-connected',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  globalSetup: './e2e-connected/global-setup.ts',
  globalTeardown: './e2e-connected/global-teardown.ts',
  reporter: 'list',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
