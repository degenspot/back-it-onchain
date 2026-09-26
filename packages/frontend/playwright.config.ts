import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Playwright configuration for the end-to-end flow suite (FE-042).
 *
 * Runs against a production build rather than `next dev`: dev-mode
 * recompilation makes timings unpredictable, which is the usual source of
 * flake in a suite that has a wall-clock budget to meet.
 */
export default defineConfig({
  testDir: './e2e',
  // The acceptance criterion is a sub-60s suite; failing the run is more
  // useful than letting it quietly creep past that.
  globalTimeout: 60_000,
  timeout: 20_000,
  expect: { timeout: 5_000 },

  // Fail the run if a .only was committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    // The app registers a service worker at scope '/' (public/sw.js). A
    // service worker answers fetches before page.route() ever sees them, so
    // network stubs are silently bypassed and tests run against whatever is
    // really listening on the API port. Blocking registration is what makes
    // the fixtures authoritative.
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  /*
   * All three run on Chromium. The requirement is responsive *viewports*, not
   * cross-engine coverage, and pinning one engine keeps CI to a single browser
   * download — the stock iPad profile is WebKit, which would triple it for no
   * added signal about layout.
   */
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: {
    command: `pnpm run start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
