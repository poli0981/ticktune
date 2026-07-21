# 01 — Architecture

Suite 1.0 · 2026-07-21

## 1. System shape

TickTune is a **static-first web app with exactly one edge endpoint**.

```
┌────────────────────────── Browser (desktop only) ──────────────────────────┐
│  Astro static pages: landing (VI + /en/), legal, 404                       │
│  /app/ → Svelte 5 island <TtApp client:only="svelte">                      │
│     ├─ Timer engine (Worker + rAF + Wake Lock)                             │
│     ├─ Audio engine (Web Audio: 2×MediaElement → Gain → Analyser)          │
│     ├─ YouTube engine (official IFrame Player, visible, right rail)        │
│     ├─ Importer (validation pipeline, dedupe, metadata)                    │
│     └─ State (Svelte runes) + Log ring buffer + Settings (Dexie)           │
└──────────────┬─────────────────────────────────────────────┬──────────────┘
               │ static assets + /api/yt/oembed              │ iframe embed
     ┌─────────▼──────────────┐                    ┌─────────▼──────────────┐
     │ Cloudflare Worker      │  edge fetch, 6h    │ youtube-nocookie.com   │
     │ (Static Assets + 1 API)│ ─────────────────► │ (player + oEmbed +     │
     └────────────────────────┘                    │  i.ytimg.com thumbs)   │
                                                   └────────────────────────┘
```

Why one endpoint exists: `https://www.youtube.com/oembed` does **not** send CORS
headers, so the browser cannot call it directly. The same Worker that serves static
assets exposes `GET /api/yt/oembed?id=<videoId>` which fetches oEmbed server-side,
caches 6 h, and returns JSON with CORS. Details in `06-YOUTUBE-INTEGRATION.md`.

## 2. Principles (in priority order)

1. **User media never leaves the machine.** No upload, no telemetry, no analytics.
   Local files live in RAM as `File` objects for the session only (decision D3).
2. **ToS-clean YouTube.** Official embedded player, visibly rendered, ≥ 200×200 px.
   Never extract audio, never hide the player, never proxy streams.
3. **Correct time beats smooth time.** The countdown is derived from a stored end
   timestamp on every tick — never accumulated intervals (`04-TIMER-ENGINE.md`).
4. **Desktop-only, enforced early.** Inline gate before any heavy module loads
   (`07-MOBILE-GATE.md`).
5. **Fail visible, log everything.** Every rejection/skip/error produces a coded log
   entry (`02-DATA-FLOW.md §7`) surfaced via toasts/overlays and Copy Diagnostics.

## 3. Module map

| Module | Location | Runtime deps | Notes |
|--------|----------|--------------|-------|
| Pages/layouts | `src/pages/`, `src/layouts/` | Astro | Static output only; no SSR |
| App island | `src/app/TtApp.svelte`, entry `src/app/mount.ts` | Svelte 5 | Single mount point — see the mount note below |
| Components | `src/app/components/Tt*.svelte` | Svelte, Motion | Presentational + local state |
| Timer engine | `src/app/engine/timer/` | none (pure TS + Worker) | Framework-agnostic, unit-testable |
| Audio engine | `src/app/engine/audio/` | music-metadata | Owns AudioContext + graph |
| YouTube engine | `src/app/engine/youtube/` | IFrame API (runtime script) | Player lifecycle + error map |
| Importer | `src/app/engine/importer/` | music-metadata, nanoid | Validation pipeline (`02 §4`) |
| Log | `src/app/engine/log/` | none | Ring buffer 500, code registry |
| State | `src/app/state/*.svelte.ts` | Svelte runes | `session`, `settings`, `playback` |
| i18n | `src/app/i18n/` | i18next | Runtime EN/VI dictionary |
| Edge worker | `worker/index.ts` | Wrangler runtime | Static assets + `/api/yt/oembed` |

**Rule:** engines are pure TypeScript with zero Svelte imports. Components subscribe
to engine events through the state layer. This keeps the timer/audio/importer fully
unit-testable in Node (Vitest) without a DOM. Enforced by the ESLint
`no-restricted-imports` zone rule (`12 §3.1`), not by convention.

### Mount decision — ✅ RESOLVED 2026-07-21: hand-mount behind the gate guard

**`src/pages/app/index.astro` hand-mounts `src/app/mount.ts` behind the `07 §3.2`
guard. No Astro client directive is used for the app island.**

Earlier revisions specified `<TtApp client:only="svelte" />` while `07 §3.2`
specified a manual load guard. Those are mutually exclusive: `client:only` emits
its own hydration bootstrap and fetches the island bundle unconditionally, so the
"no app-bundle request on a blocked viewport" assertion in `07 §6` / `13 §3` — a
**P1 exit criterion** — could not pass. Three candidates were built and measured
against the **built** output (static server over `dist/`, Playwright, Pixel 7 vs
1440×900, counting every `.js` request):

| Variant | Mobile: component chunks fetched | Mobile: mounted? | Desktop: mounted? | SSRs the component? |
|---------|----------------------------------|------------------|-------------------|---------------------|
| `client:only` + head guard | **2** (`TtProbe.*.js`, `client.svelte.*.js`) | **yes** ❌ | yes | no |
| custom `client:desktop` directive | 0 | no | yes | **yes** ⚠️ |
| **hand-mount (chosen)** | **0** (1 ≈200 B guard chunk) | no | yes | no |

`client:only` is eliminated on the measurement: it fetched the island and
hydrated it on a blocked viewport.

The custom directive passed the bundle test — `addClientDirective` hands the
directive a `load()` thunk, and never calling it means never importing the
component. It was still rejected: Astro **server-renders** the component and only
defers hydration (confirmed — the component's markup was present in the built
HTML, unlike the other two). That would put `TtApp` through SSR, so every module
touching `AudioContext`, Dexie or `Worker` would need a server guard forever, and
the app shell would be baked into `/app/`'s HTML only to be thrown away. The
original `client:only` intent was *no SSR*; hand-mounting preserves it exactly.

`client:media="(min-width: 1024px)"` was not built. It cannot express `07 §2`'s
*coarse AND NOT hover* clause, and as a live `matchMedia` listener it contradicts
`07 §2`'s deliberate "evaluated once at load".

Consequences to hold onto:

- `src/app/mount.ts` is the island entry and calls Svelte's `mount()` directly.
  `TtApp.svelte` is never referenced from an `.astro` template.
- The one remaining mobile request is the page's own guard chunk. It is
  deliberately a module script, **not** a second `is:inline` script: the CSP
  hash injector asserts exactly one distinct inline script site-wide
  (`10 §7`), and that one is the gate in `TtBase.astro`.
- `src/lib/tt-gate-const.ts` stays the single source of the predicate; the guard
  reads the `data-tt-blocked` attribute the gate already set rather than
  re-evaluating media queries, so the overlay and the loader cannot disagree.

## 4. Directory tree (target)

This tree is the **scaffold checklist** — it must be followable verbatim, with no
path invented along the way. Every path referenced anywhere in the suite appears
here.

```
ticktune/
├── .github/
│   ├── workflows/                 # 6 caller stubs (14-CI-CD.md §1)
│   ├── ISSUE_TEMPLATE/bug_report.yml
│   ├── dependabot.yml             # npm weekly, grouped (14 §1)
│   └── SECURITY.md                # private disclosure via GitHub PVR (09 §7)
├── public/
│   ├── _headers                   # security headers (09-SECURITY.md §2-4)
│   ├── fonts/dseg7/               # vendored DSEG7 Classic woff2 + OFL.txt
│   └── audio/chime.opus           # end-behavior chime (self-made, CC0)
├── scripts/
│   ├── inject-csp-hash.ts         # build step, normative contract in 10 §7
│   ├── make-chime.ts              # generates public/audio/chime.opus (05 §7)
│   ├── make-fixtures.ts           # generates tests/e2e/fixtures/ (13 §3, 15 S3)
│   ├── audit-corpus.mjs           # reports what the local test/ corpus covers
│   └── guard-no-corpus.mjs        # CI + pre-commit: blocks large/audio blobs
├── src/
│   ├── layouts/TtBase.astro       # <head>: mobile gate inline script, meta, fonts
│   ├── lib/
│   │   ├── tt-gate-const.ts       # TT_GATE, inlined verbatim into the head (07 §2)
│   │   └── tt-legal-const.ts      # TT_LEGAL_VERSION (02 §3 gate acceptance)
│   ├── i18n/static/{vi,en}.ts     # STATIC page strings — distinct from the
│   │                              # runtime app dictionary below (08 §1 vs §2)
│   ├── pages/
│   │   ├── index.astro            # landing VI (default)
│   │   ├── en/index.astro         # landing EN
│   │   ├── app/index.astro        # mounts the app island (see §3 mount note)
│   │   ├── legal/{eula,privacy,disclaimer,third-party}.astro  (+ /en/legal/)
│   │   └── 404.astro              # required by not_found_handling (§5)
│   ├── app/
│   │   ├── mount.ts               # island entry — the load guard's import target
│   │   ├── TtApp.svelte
│   │   ├── components/            # TtCountdown, TtSetup, TtLegalGate, TtQueuePanel,
│   │   │                          # TtBottomBar, TtSettings, TtYtPlayer, TtOverlay,
│   │   │                          # TtContextMenu, TtVisualizer, TtToast, TtFinished
│   │   ├── engine/
│   │   │   ├── timer/             # types.ts, tt-timer.ts, tt-format.ts,
│   │   │   │                      # tt-timer.worker.ts   ← engine owns its worker
│   │   │   └── {audio,youtube,importer,log}/
│   │   ├── state/{session,settings,playback}.svelte.ts
│   │   └── i18n/{index.ts,en.json,vi.json}   # RUNTIME dictionary (08 §2)
│   └── styles/global.css          # Tailwind 4 entry + design tokens (03 §1)
├── worker/index.ts                # CF Worker: ASSETS.fetch + /api/yt/oembed
├── tests/
│   ├── unit/                      # 13 §1
│   ├── component/                 # 13 §2
│   ├── e2e/
│   │   └── fixtures/              # generated tones, committed (13 §3)
│   └── manual/yt-matrix.md        # curated list from Spike S1 (13 §4)
├── docs/                          # this suite, committed
├── legal/                         # EULA, Disclaimer, Privacy, Third-Party
├── astro.config.mjs               # §5
├── wrangler.jsonc                 # §5
├── package.json · pnpm-lock.yaml
├── tsconfig.json                  # exact flag set in 12 §2
├── eslint.config.js               # incl. the engine-purity zone rule (12 §3.1)
├── knip.json · vitest.config.ts · playwright.config.ts
├── .prettierrc · .editorconfig · .nvmrc · .gitattributes
├── .gitignore                     # /test/ corpus never committed — see the file
├── CLAUDE.md · README.md · CONTRIBUTING.md · LICENSE
└── test/                          # LOCAL ONLY, git-ignored: ~651 MB spike corpus
                                   # (15 S3/S4). Never committed, never deployed.
```

Two notes where this tree previously disagreed with the chapters that use it:

- **The timer worker lives with its engine** (`src/app/engine/timer/tt-timer.worker.ts`),
  not in a separate `src/workers/`. §3's rule is that an engine is a
  self-contained, framework-free unit; splitting its worker out of the folder
  breaks that and makes the engine's own tests reach across the tree.
- **`src/i18n/static/` and `src/app/i18n/` are both real and are not duplicates.**
  The first holds build-time strings for the Astro pages (`08 §1`, route-based
  VI/EN); the second is the i18next runtime dictionary for the island (`08 §2`).

## 5. Build & deploy

- `pnpm build` = `astro build && tsx scripts/inject-csp-hash.ts` → static output
  in `dist/`, with the mobile-gate CSP hash injected (`10 §7`).
- `astro.config.mjs`:
  ```js
  import { defineConfig } from 'astro/config';
  import svelte from '@astrojs/svelte';
  import tailwindcss from '@tailwindcss/vite';
  import { readFileSync } from 'node:fs';

  const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

  export default defineConfig({
    output: 'static',                       // no SSR — §6 non-goal
    site: 'https://ticktune.net',           // hreflang + canonical (08 §1, P6)
    integrations: [svelte()],
    vite: {
      plugins: [tailwindcss()],
      // Read by the About panel (03 §6) and the diagnostics payload (02 §7).
      // package.json is the single source of the version; 14 §5 bumps it there.
      define: { __TT_VERSION__: JSON.stringify(version) },
    },
  });
  ```
  `site` must be set before P6: `hreflang` alternates and canonical URLs are a
  P6 exit criterion and Astro cannot emit absolute ones without it.
- `wrangler.jsonc`:
  ```jsonc
  {
    "name": "ticktune",
    "main": "worker/index.ts",
    "compatibility_date": "2026-07-01",
    "assets": {
      "directory": "./dist",
      "binding": "ASSETS",
      "not_found_handling": "404-page"   // serves dist/404.html
    }
  }
  ```
- Worker fetch handler: route `/api/yt/oembed` → handler; everything else →
  `env.ASSETS.fetch(request)`.
- Deploy via `wrangler deploy` from CI (`14-CI-CD.md`).

## 6. Explicit non-goals (v1.0)

| Not doing | Why |
|-----------|-----|
| Server-side file storage / accounts | Cost, copyright liability, privacy — contradicts principle 1 |
| File System Access API persistence | D3 session-only; keeps Firefox/Safari support |
| GSAP | Non-FOSS license vs GPL-3.0 distribution (D7) |
| SSR / hybrid rendering | Nothing dynamic to render; static + 1 API route suffices |
| Audio extraction from YouTube | ToS violation, principle 2 |
| PWA / offline install, loudness normalization, YouTube Data API metadata | Deferred post-1.0 (`16-ROADMAP.md`) |
| Mobile support | D2; revisit only as a separate major effort |
