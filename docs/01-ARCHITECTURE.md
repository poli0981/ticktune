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
| App island | `src/app/TtApp.svelte` | Svelte 5 | Single mount point; `client:only` |
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
unit-testable in Node (Vitest) without a DOM.

## 4. Directory tree (target)

```
ticktune/
├── public/
│   ├── _headers                  # security headers (09-SECURITY.md)
│   ├── fonts/dseg7/              # vendored DSEG7 Classic woff2 + OFL.txt
│   └── audio/chime.opus          # end-behavior chime (self-made, CC0)
├── src/
│   ├── layouts/TtBase.astro      # <head>: mobile gate inline script, meta, fonts
│   ├── pages/
│   │   ├── index.astro           # landing VI (default)
│   │   ├── en/index.astro        # landing EN
│   │   ├── app/index.astro       # mounts <TtApp client:only="svelte" />
│   │   ├── legal/{eula,privacy,disclaimer,third-party}.astro  (+ /en/legal/)
│   │   └── 404.astro
│   ├── app/
│   │   ├── TtApp.svelte
│   │   ├── components/           # TtCountdown, TtSetup, TtLegalGate, TtQueuePanel,
│   │   │                         # TtBottomBar, TtSettings, TtYtPlayer, TtOverlay,
│   │   │                         # TtContextMenu, TtVisualizer, TtToast, TtFinished
│   │   ├── engine/{timer,audio,youtube,importer,log}/
│   │   ├── state/{session,settings,playback}.svelte.ts
│   │   └── i18n/{index.ts,en.json,vi.json}
│   ├── styles/global.css         # Tailwind 4 entry + design tokens (03-UI-SPEC.md)
│   └── workers/tt-timer.worker.ts
├── worker/index.ts               # CF Worker: ASSETS.fetch + /api/yt/oembed
├── wrangler.jsonc
├── astro.config.mjs
├── tests/{unit,component,e2e}/
└── docs/ (this suite, committed)
```

## 5. Build & deploy

- `pnpm build` → Astro static output in `dist/`.
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
