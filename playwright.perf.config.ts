import { defineConfig, devices } from '@playwright/test';

/**
 * The render-cost probe — docs/13 §5 (v2.0). `pnpm perf:render`.
 *
 * Frame times belong to the GPU and the CPU that drew them, so this is a probe
 * for a real machine, not a CI gate: a runner has no GPU and a shared CPU, and
 * a budget checked there would measure the runner. It runs HEADED, in a
 * browser the machine actually has (Edge unless TT_PERF_CHANNEL says
 * otherwise), muted, one test at a time — two at once would share the CPU and
 * each would measure the other.
 */
const PORT = 4337;

export default defineConfig({
  testDir: './tests/perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env['TT_PERF_CHANNEL'] ?? 'msedge',
    headless: false,
    deviceScaleFactor: 1,
    baseURL: `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    launchOptions: { args: ['--mute-audio'] },
  },
  // The two sizes the audit named (AUDIT-BACKLOG, "Countdown rendering cost").
  projects: [
    { name: '1440p', use: { viewport: { width: 2560, height: 1440 } } },
    { name: '4k', use: { viewport: { width: 3840, height: 2160 } } },
  ],
  webServer: {
    command: `pnpm astro preview --port ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
  },
});
