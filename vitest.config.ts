import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.ts'],
    // Scaffold affordance: the tree is empty until the timer suite lands
    // (docs/13 §1). Safe to keep afterwards because the coverage thresholds
    // below fail loudly if the include globs ever stop matching real tests.
    passWithNoTests: true,
    // E2E is Playwright's job (docs/13 §3); never let vitest pick it up.
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/app/engine/**'],
      // docs/13 §1: ">= 85% lines on src/app/engine/** (enforced)".
      // Enforced HERE, in config, so it fails the build rather than relying on
      // someone reading the number.
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 75,
      },
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
