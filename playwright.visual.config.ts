import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression — docs/13 §3 (v2.0).
 *
 * Screenshots are only comparable when they come from the same fonts, the same
 * rasteriser and the same browser build, so the baselines are made — and CI
 * compares them — inside the pinned official image
 * `mcr.microsoft.com/playwright:v1.64.1-noble` (`pnpm test:visual:docker`
 * locally, the `visual` job in .github/workflows/quality.yml). On any other
 * machine a mismatch says nothing about the app.
 *
 * Motion is held still at the source: reduced motion swaps the hero video for
 * its still, `animations: 'disabled'` finishes every CSS animation, and the
 * caret is hidden. What still moves on its own (the running countdown, the
 * transport's clock) is masked in the specs that show it.
 */
const PORT = 4338;

export default defineConfig({
  testDir: './tests/visual',
  // One platform by construction (the image), so the name carries no suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `pnpm astro preview --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
