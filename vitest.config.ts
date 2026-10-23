import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  plugins: [svelte()],
  // Mirrors astro.config.mjs, and read from the same package.json rather than
  // stubbed: the About panel renders this string, so the component test should
  // assert the real one. A hardcoded test value would pass while the build
  // shipped `__TT_VERSION__` unreplaced.
  define: { __TT_VERSION__: JSON.stringify(version) },
  // Without this, `import { mount } from 'svelte'` resolves to svelte's SERVER
  // build and every component test dies with `mount(...) is not available on
  // the server` — Svelte 5 ships client/server halves behind export conditions
  // and Node's default resolution picks the server one. Measured 2026-07-21
  // against the P1 config; docs/13 §2's whole component tier depends on it.
  resolve: { conditions: ['browser'] },
  test: {
    globals: true,
    environment: 'happy-dom',
    /*
     * `tests/worker/**` is a third tier, added in P4.
     *
     * The edge endpoint had **no automated coverage at all** and could not get
     * any from the tiers that existed: Playwright's `webServer` is
     * `astro preview`, not `wrangler`, so `/api/yt/oembed` does not exist under
     * E2E and `docs/13 §3` plans to *mock* it rather than run it. That was
     * tolerable while the Worker only proxied a body through. It stopped being
     * tolerable when spike S1 established that this response is the **only**
     * place a failure cause survives — the player reports `onError 150` for
     * every cause there is.
     *
     * The handler is importable and its two dependencies (`fetch`,
     * `caches.default`) are stubbable, so this needs neither network nor
     * browser. It is excluded from the `src/app/engine/**` coverage gate below
     * for the same reason the drivers are: different program, different globals.
     */
    include: [
      'tests/unit/**/*.test.ts',
      'tests/component/**/*.test.ts',
      'tests/worker/**/*.test.ts',
    ],
    // Scaffold affordance: the tree is empty until the timer suite lands
    // (docs/13 §1). Safe to keep afterwards because the coverage thresholds
    // below fail loudly if the include globs ever stop matching real tests.
    passWithNoTests: true,
    // E2E is Playwright's job (docs/13 §3); never let vitest pick it up.
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      /*
       * Two readers since 2026-10-23 (docs/13 §1, docs/14 §1): the threshold
       * below, which gates the pure engine core, and SonarQube Cloud, which
       * reads `lcov.info` for its quality gate's coverage-on-new-code condition
       * across everything it analyses. Sonar counts a source file MISSING from
       * the report as 0% covered, not as unknown — so the report spans all of
       * src/ and worker/, and every carve-out below is repeated in
       * sonar-project.properties' `sonar.coverage.exclusions`
       * (tests/unit/tt-coverage-scope.test.ts holds the two lists together).
       * `.svelte` files stay out: Sonar does not analyse them, so their lines
       * would be paths it cannot resolve.
       */
      include: ['src/**/*.ts', 'worker/**/*.ts'],
      exclude: [
        // Browser wiring, not logic. These own Worker, requestAnimationFrame,
        // visibilitychange and Wake Lock — the impure boundary the pure core
        // exists to keep small (docs/01 §3). They cannot execute in Node, so
        // "unit coverage" of them would mean mocking every browser API and
        // then asserting the mocks, which tests nothing real.
        //
        // They are covered where they actually run: Playwright (docs/13 §3) and
        // spike S2, which drives this exact driver for 30-90 minutes across
        // hidden, minimised and suspended states (docs/15 §S2).
        //
        // The threshold below therefore applies to the pure core only — which
        // is what docs/13 §1's "the engines are pure by design" reasoning meant.
        'src/app/engine/**/*.worker.ts',
        'src/app/engine/**/*-driver.ts',
        // The island entry: one `mount()` behind the gate. Every E2E spec runs it.
        'src/app/mount.ts',
        // Spike harnesses: run by hand in real browsers, never shipped (docs/15).
        'src/spike/**',
        // Astro's content-collection config: every build executes it.
        'src/content.config.ts',
        // Declarations only — nothing in them executes.
        '**/*.d.ts',
      ],
      thresholds: {
        // docs/13 §1: ">= 85% lines on src/app/engine/** (enforced)". Scoped to
        // that glob rather than global, because the report now spans the whole
        // app and the bar is the pure core's. Enforced HERE, in config, so it
        // fails the run rather than relying on someone reading a report.
        'src/app/engine/**': {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 75,
        },
      },
      // `lcovonly` writes coverage/lcov.info for Sonar; `html` is the copy to browse.
      reporter: ['text', 'html', 'lcovonly'],
      reportsDirectory: 'coverage',
    },
  },
});
