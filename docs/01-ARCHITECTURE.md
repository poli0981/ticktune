# 01 — Architecture

Suite 1.1 · 2026-10-20

## 1. System shape

TickTune is a **static-first web app with exactly one edge endpoint**.

```
┌────────────────────────── Browser (desktop only) ──────────────────────────┐
│  Astro static pages: landing (VI + /en/), legal, 404                       │
│  /app/ → Svelte 5 island, hand-mounted by src/app/mount.ts (§3)            │
│     ├─ Timer engine (Worker + rAF + Wake Lock)                             │
│     ├─ Audio engine (Web Audio: 2×MediaElement → Gain → Analyser)          │
│     ├─ YouTube engine (official IFrame Player, visible, right rail)        │
│     ├─ Importer (validation pipeline, dedupe, metadata)                    │
│     └─ State (Svelte runes) + Log ring buffer + Settings (Dexie)           │
│  every page: Cloudflare Web Analytics beacon (disclosed, `09 §1`)          │
└──────────────┬─────────────────────────────────────────────┬──────────────┘
               │ static assets + /api/yt/oembed              │ YouTube mode only
     ┌─────────▼──────────────┐                    ┌─────────▼──────────────┐
     │ Cloudflare Worker      │  oEmbed fetch,     │ www.youtube.com        │
     │ (Static Assets + 1 API)│  cached 6 h ─────► │  (IFrame API, oEmbed)  │
     └────────────────────────┘                    │ youtube-nocookie.com   │
                                                   │  (the player itself)   │
                                                   └────────────────────────┘
```

Why one endpoint exists: `https://www.youtube.com/oembed` does **not** send CORS
headers, so the browser cannot call it directly. The same Worker that serves static
assets exposes `GET /api/yt/oembed?id=<videoId>` which fetches oEmbed server-side,
caches 6 h, and returns JSON — **same-origin only, no CORS headers** (v1.1; the app
calls it on its own origin, so `*` only ever served other sites). Details in
`06-YOUTUBE-INTEGRATION.md`.

## 2. Principles (in priority order)

1. **User media never leaves the machine.** No upload, no telemetry beyond the disclosed Cloudflare Web Analytics beacon (page-level, cookieless — `09 §1`).
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
| Components | `src/app/components/Tt*.svelte` | Svelte | Presentational + local state; animation is CSS only |
| Timer engine | `src/app/engine/timer/` | none (pure TS + Worker) | Framework-agnostic, unit-testable |
| Audio engine | `src/app/engine/audio/` | none (pure TS + ports) | Owns AudioContext + graph, behind `tt-audio-driver.ts` |
| YouTube engine | `src/app/engine/youtube/` | IFrame API (runtime script) | Player lifecycle, link import; two drivers (oEmbed fetch, player) |
| Importer | `src/app/engine/importer/` | music-metadata (dynamically imported) | Validation pipeline (`02 §4`); ids from `crypto.randomUUID` (`02 §2`) |
| Queue | `src/app/engine/queue/` | none | The play order and its cursor rules (`02 §5.1`) |
| Visuals | `src/app/engine/visuals/` | none | Gradient presets, contrast/scrim maths, dominant hue, visualizer geometry |
| Log | `src/app/engine/log/` | none | Ring buffer 500, code registry |
| State | `src/app/state/*.svelte.ts` | Svelte runes | `session`, `settings`, `playback`, `yt`, `backdrop`, `i18n` |
| i18n | `src/app/i18n/` + `src/app/state/i18n.svelte.ts` | i18next | Runtime EN/VI dictionaries for the island; the static pages use `src/i18n/static/` |
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

## 4. Directory tree

The tree as it is at v1.1. A path a chapter cites belongs here; when a chapter
starts citing a new one, add it.

```
ticktune/
├── .github/
│   ├── workflows/                 # ci, e2e, audit, deploy — self-contained (14 §1)
│   ├── ISSUE_TEMPLATE/bug_report.yml
│   ├── dependabot.yml             # npm + actions, weekly, cooldown (14 §1)
│   └── SECURITY.md                # security@ + GitHub PVR (09 §7)
├── .githooks/pre-commit           # runs the corpus guard against the index
├── public/
│   ├── _headers                   # security headers + CSP (09 §2-4)
│   ├── .well-known/security.txt   # RFC 9116 contact
│   ├── fonts/dseg7/               # vendored DSEG7 Classic woff2 + OFL.txt
│   ├── demo/                      # the landing hero, recorded by make-demo.ts
│   ├── og/ · og-source.svg        # social card + its editable source
│   ├── favicon.svg · favicon.png · apple-touch-icon.png
│   └── robots.txt
│                                  # NO audio/ — the chime is synthesised at
│                                  # runtime (05 §7); the app ships no audio file
├── scripts/
│   ├── inject-csp-hash.ts         # build step, normative contract in 10 §7
│   ├── make-notices.ts            # build step: dist/THIRD-PARTY-NOTICES.txt
│   ├── check-budget.ts            # build step: the /app/ bundle budget (13 §5)
│   ├── check-doc-refs.ts          # CI: every `NN §M` citation resolves
│   ├── guard-no-corpus.mjs        # CI + pre-commit: blocks the test/ corpus
│   ├── verify-csp.mjs             # CI: the served CSP in a real browser
│   ├── make-fixtures.ts           # generates tests/e2e/fixtures/ (13 §3)
│   ├── make-demo.ts               # records public/demo/ from the real app
│   ├── make-brand-assets.mjs      # rasterises favicon + social card
│   ├── ensure-ffmpeg.ts           # the two generators' ffmpeg, on demand
│   └── run-spikes.ts              # `pnpm spikes`: TT_SPIKES=1 build + preview (15)
├── src/
│   ├── layouts/TtBase.astro       # <head>: mobile gate inline script, meta,
│   │                              # analytics beacon; the mobile notice
│   ├── content.config.ts          # the legal/*.md collections (08 §1)
│   ├── env.d.ts
│   ├── spike/                     # harnesses (15): pages/ + s1/ s3/ s4/ — routed only
│   │                              # for `astro dev` or TT_SPIKES=1 → dist-spikes/ (§5)
│   ├── lib/
│   │   ├── tt-gate-const.ts       # TT_GATE, inlined verbatim into the head (07 §2)
│   │   ├── tt-legal-const.ts      # TT_LEGAL_VERSION + the legal-route table
│   │   ├── tt-domain-types.ts     # TtMode/TtLoopStyle/TtEndAction — shared by
│   │   │                          # engines AND state; see the note below §4
│   │   ├── tt-yt-cause.ts         # oEmbed status → cause, shared with the Worker
│   │   └── tt-palette.ts          # the @theme colours JS needs (03 §1)
│   ├── i18n/static/{vi,en}.ts     # STATIC page strings — distinct from the
│   │                              # runtime app dictionary below (08 §1 vs §2)
│   ├── components/
│   │   ├── landing/               # TtLanding, TtHero, TtFeatureGrid,
│   │   │                          # TtModeExplainer, TtLimitsTable, TtFaq,
│   │   │                          # TtFooter, TtNotFound
│   │   └── legal/TtLegalDoc.astro
│   ├── pages/
│   │   ├── index.astro            # landing VI (default)
│   │   ├── en/index.astro         # landing EN
│   │   ├── app/index.astro        # mounts the app island (see §3 mount note)
│   │   ├── legal/{eula,privacy,disclaimer,third-party}.astro  (+ en/legal/)
│   │   └── 404.astro · en/404.astro   # required by not_found_handling (§5)
│   ├── app/
│   │   ├── mount.ts               # island entry — the load guard's import target
│   │   ├── TtApp.svelte           # the shell: wiring between engines and screens
│   │   ├── components/            # TtCountdown, TtBackdrop, TtVisualizer,
│   │   │                          # TtSetup, TtDropZone, TtQueuePanel,
│   │   │                          # TtSingleRail, TtYouTubeRail, TtBottomBar,
│   │   │                          # TtSettings, TtLegalGate, TtFinished,
│   │   │                          # TtTrackInfo, TtContextMenu, TtToast,
│   │   │                          # TtDebugPanel, TtIcon
│   │   ├── engine/
│   │   │   ├── timer/             # types.ts, tt-timer.ts, tt-format.ts,
│   │   │   │                      # tt-late.ts, tt-milestones.ts,
│   │   │   │                      # tt-timer-driver.ts, tt-timer.worker.ts
│   │   │   │                      #   ← engine owns its worker
│   │   │   ├── audio/ · importer/ # pure modules + ONE *-driver.ts holding
│   │   │   │                      # every browser API (13 §1 coverage carve-out)
│   │   │   ├── youtube/           # pure modules + TWO drivers: oEmbed fetch
│   │   │   │                      # (tt-yt-driver) and player (tt-yt-player-driver)
│   │   │   ├── log/ · queue/ · visuals/   # pure, no driver
│   │   ├── state/                 # {session,settings,playback,yt,backdrop,
│   │   │                          #  i18n}.svelte.ts + tt-settings-schema.ts
│   │   └── i18n/{en,vi}.json      # RUNTIME dictionary (08 §2)
│   └── styles/global.css          # Tailwind 4 entry, tokens, primitives (03 §1)
├── worker/index.ts                # CF Worker: ASSETS.fetch + /api/yt/oembed
├── tests/
│   ├── unit/                      # 13 §1
│   ├── component/                 # 13 §2
│   ├── worker/                    # the oEmbed route
│   ├── e2e/
│   │   └── fixtures/              # generated tones and tags, committed (13 §3)
│   └── manual/                    # yt-matrix.md + one live checklist per release
├── docs/                          # this suite, committed
├── legal/ · legal/vi/             # EULA, Disclaimer, Privacy, Third-Party
├── astro.config.mjs · wrangler.jsonc   # §5
├── package.json · pnpm-lock.yaml · pnpm-workspace.yaml
├── tsconfig.json                  # exact flag set in 12 §2
├── tsconfig.worker.json           # the Worker, type-checked separately
├── eslint.config.js               # incl. the engine-purity zone rule (12 §3.1)
├── svelte.config.js · knip.json · vitest.config.ts · playwright.config.ts
├── .prettierrc · .prettierignore · .editorconfig · .nvmrc · .gitattributes
├── .sonarcloud.properties
├── .gitignore                     # /test/ corpus never committed — see the file
├── CLAUDE.md · README.md · CONTRIBUTING.md · LICENSE
└── test/                          # LOCAL ONLY, git-ignored: ~651 MB spike corpus
                                   # (15 S3/S4). Never committed, never deployed.
```

Three notes where this tree previously disagreed with the chapters that use it:

- **`src/lib/tt-domain-types.ts` is not a stray types file.** `TtMode`,
  `TtLoopStyle` and `TtEndAction` are needed by both the engines and the settings
  schema, and §3's purity rule — enforced by ESLint with no type-import escape —
  forbids an engine importing from `src/app/state/`. `src/lib/` is outside that
  ban, so it is the one place both sides can share a definition instead of each
  keeping a copy. Values and ranges stay in `state/tt-settings-schema.ts`.

- **The timer worker lives with its engine** (`src/app/engine/timer/tt-timer.worker.ts`),
  not in a separate `src/workers/`. §3's rule is that an engine is a
  self-contained, framework-free unit; splitting its worker out of the folder
  breaks that and makes the engine's own tests reach across the tree.
- **`src/i18n/static/` and `src/app/i18n/` are both real and are not duplicates.**
  The first holds build-time strings for the Astro pages (`08 §1`, route-based
  VI/EN); the second is the i18next runtime dictionary for the island (`08 §2`).

## 5. Build & deploy

- `pnpm build` = `astro build && node scripts/inject-csp-hash.ts && node
  scripts/make-notices.ts && node scripts/check-budget.ts` → static output in
  `dist/`, with the mobile-gate CSP hash injected (`10 §7`), the full
  third-party notice generated, and the `/app/` budget enforced (`13 §5`).
- **`astro.config.mjs` and `wrangler.jsonc` are the source of truth**; until
  v1.1 this section held "normative" copies of both, and the copies had fallen
  four integrations and three Wrangler keys behind. What each setting is for:

  | `astro.config.mjs` | Why |
  |--------------------|-----|
  | `output: 'static'` | No SSR — `§6` non-goal; the one dynamic route is the Worker |
  | `site: 'https://ticktune.net'` | Absolute canonical and `hreflang` URLs (`08 §1`) |
  | `svelte()` | The `/app/` island |
  | `sitemap()` | `sitemap-index.xml`; its i18n mode is unused (VI has no path prefix) |
  | the satteri Markdown processor | Renders `legal/*.md`, rewriting their cross-links to the on-site routes |
  | `ttBundledPackages()` | Records the client module graph for `make-notices.ts` |
  | `define: { __TT_VERSION__ }` | `package.json`'s version, for About and diagnostics (`14 §5`) |
  | `vite.build.assetsInlineLimit` | Never inlines a font as a `data:` URI — `font-src 'self'` would block it (`09 §4`) |

  | `wrangler.jsonc` | Why |
  |------------------|-----|
  | `main: worker/index.ts` | The Worker: `/api/yt/oembed`, everything else `env.ASSETS.fetch` |
  | `assets.not_found_handling: '404-page'` | Serves `dist/404.html` |
  | `workers_dev: false` | No public `*.workers.dev` alias of production |
  | `preview_urls: true` | Each uploaded version gets a preview URL — where a release's live checklist runs (`14 §5`) |
  | `observability` | Worker logs, 7-day retention (Workers Paid) — disclosed in the Privacy Policy |
- **Deploy**: production changes only when a signed `vX.Y.Z` tag is pushed;
  `deploy.yml` verifies it and runs `wrangler deploy` (`14 §5`). Every other push
  only uploads a version.

## 6. Explicit non-goals (v1.1)

| Not doing | Why |
|-----------|-----|
| Server-side file storage / accounts | Cost, copyright liability, privacy — contradicts principle 1 |
| File System Access API persistence | D3 session-only; keeps Firefox/Safari support |
| GSAP | Non-FOSS license vs GPL-3.0 distribution (D7) |
| SSR / hybrid rendering | Nothing dynamic to render; static + 1 API route suffices |
| Audio extraction from YouTube | ToS violation, principle 2 |
| PWA / offline install, loudness normalization, YouTube Data API metadata | Deferred post-1.1 (`16-ROADMAP.md`) |
| Mobile support | D2; revisit only as a separate major effort |
