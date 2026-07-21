import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.astro/**',
      '.wrangler/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // The local spike corpus is never linted — it is audio, and it is ignored
      // by git anyway (see .gitignore).
      'test/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],

  // Browser globals for everything under src/; `no-undef` is off for TS because
  // tsc already proves identifiers exist and duplicating that here produces
  // false positives on type-only names.
  {
    files: ['src/**/*.{ts,svelte}'],
    languageOptions: { globals: globals.browser },
    rules: { 'no-undef': 'off' },
  },

  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
    },
  },

  // `*.svelte.ts` runes modules are plain TypeScript — they just use $state.
  // eslint-plugin-svelte's flat config claims them for the Svelte parser, which
  // then fails on ordinary TS syntax (`import Dexie, { type Table }`).
  {
    files: ['**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.browser,
    },
    rules: { 'no-undef': 'off' },
  },

  {
    rules: {
      // docs/12 §4 — banned patterns.
      'svelte/no-at-html-tags': 'error', // untrusted titles (docs/09 §5)
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Dexie only — localStorage is not for structured data (docs/12 §4).
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'Settings persist via Dexie only (docs/02 §3.2, docs/12 §4).',
        },
      ],

      // The client must never talk to youtube.com directly; oEmbed goes through
      // the edge route (docs/06 §3, docs/12 §4).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='fetch'] > Literal[value=/youtube\\.com|googleapis\\.com/]",
          message: 'Use the /api/yt/oembed edge route, never a direct client fetch (docs/06 §3).',
        },
      ],
    },
  },

  // ── Engine purity (docs/01 §3, docs/12 §3.1) ────────────────────────────────
  // Engines are pure TypeScript. This is what keeps them unit-testable in Node
  // without a DOM, and it is enforced here rather than left to review.
  {
    files: ['src/app/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'svelte', message: 'Engines must not import Svelte (docs/01 §3).' },
            { name: 'svelte/store', message: 'Engines must not import Svelte (docs/01 §3).' },
          ],
          patterns: [
            {
              group: ['**/components/**', '**/*.svelte', '**/state/**'],
              message:
                'Engines must not reach into components or state. Data flows engine → state → components (docs/12 §3.3).',
            },
          ],
        },
      ],
    },
  },

  // Config files and Node-side scripts run outside the browser. Build scripts
  // legitimately log — that output is the build log, not stray debugging.
  {
    files: ['*.config.{js,mjs,ts}', 'svelte.config.js', 'scripts/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },

  // The Cloudflare Worker runs on workerd: a fetch/Request/Response global set,
  // not Node's and not the browser's. Types come from tsconfig.worker.json.
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.worker } },
    rules: { 'no-console': 'off', 'no-undef': 'off' },
  },

  // Drives a browser, so its page.evaluate() bodies legitimately reference
  // document/window even though the file itself runs under Node.
  {
    files: ['scripts/verify-csp.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Tests run under vitest globals (see vitest.config.ts `globals: true`).
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-undef': 'off' },
  },
);
