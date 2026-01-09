import { defineConfig, devices } from '@playwright/test';

const authFile = '/tmp/billmanager-test-results/.auth/user.json';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  reporter: [
    ['html', { outputFolder: '/tmp/billmanager-test-results/playwright-report' }],
    ['json', { outputFile: '/tmp/billmanager-test-results/test-results.json' }],
    ['list']
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    // Setup project - runs first to authenticate and save state
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Main tests - depend on setup, use stored auth (run before auth tests to avoid rate limits)
    {
      name: 'chromium',
      testIgnore: /auth\.(setup|spec)\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
    },
    // Auth tests - need fresh browser state, run last (they test login/logout)
    {
      name: 'auth-tests',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['chromium'],  // Run after main tests to avoid exhausting rate limit
    },
  ],
  webServer: undefined, // We start the server manually
});
