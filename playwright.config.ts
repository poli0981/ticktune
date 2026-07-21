import { defineConfig, devices } from '@playwright/test';

// Deliberately NOT 4321 (astro dev's default). A dev server left running on that
// port was once silently reused here, and the suite measured dev-mode module
// paths instead of the built bundles — which is precisely what the mobile-gate
// assertion is about. Own port, own server, never reused.
const PORT = 4329;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },

  webServer: {
    // Test the built output, not the dev server — the mobile-gate assertion is
    // about which bundles the browser actually requests (docs/07 §6).
    command: `pnpm astro preview --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },

    // docs/07 §6 / docs/13 §3: on a blocked viewport the overlay must show AND
    // the app bundle must never be requested. Both a small viewport and a
    // touch-only pointer profile, because TT_GATE tests both conditions.
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
    },
  ],
});
