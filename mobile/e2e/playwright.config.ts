import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end checks against the app's web target.
 *
 * Two things must already be running: the local API on port 5000 with a
 * seeded demo organisation, and the app's web build on port 8081. Use the
 * production export (`npm run export:web && node scripts/serve-web.mjs`)
 * rather than the Metro development server: the development bundle is large
 * and unminified, and on a small machine a fresh browser context per test
 * spends most of its time parsing it. The web target proves screens,
 * navigation, forms and the session contract against the real API; it
 * proves nothing native, and the architecture document says which items
 * stay on the native verification list.
 *
 * Credentials come from E2E_EMAIL / E2E_PASSWORD and default to the demo
 * project manager of the local seed. Nothing here touches staging or
 * production.
 */
export default defineConfig({
  testDir: '.',
  // Every run starts from the seeded end-to-end organisation; see e2e/global-setup.ts.
  globalSetup: './global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/e2e',
  use: {
    baseURL: process.env.MOBILE_WEB_URL ?? 'http://localhost:8081',
    // Tracing records a snapshot per action; on a small machine that alone
    // can freeze the page under test. Screenshots on failure are enough.
    trace: 'off',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], hasTouch: false, isMobile: false, viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 1024, height: 768 } } },
  ],
})
