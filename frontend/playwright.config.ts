import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end tests.
 *
 * These drive the real React application in a real browser. They assume the API
 * and the web app are already running — see docs/qa/local-setup.md — because
 * standing them up takes long enough that a webServer block times out on a cold
 * Vite start on Windows.
 *
 *   npx playwright test --config=frontend/playwright.config.ts
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  // The dedicated E2E organisation is reset and seeded before every run (Phase 22B).
  globalSetup: './e2e/global-setup.ts',
  // The scenarios build on one another inside a file (create a budget line,
  // then spend against it), so a file's tests run in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: '../docs/testing/e2e-results.json' }]],
  use: {
    baseURL: BASE_URL,
    // A hidden or minimised window stops a headed browser painting, which makes
    // clicks and screenshots unreliable. Headless avoids that entirely.
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
