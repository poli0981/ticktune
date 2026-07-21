# 07 — Mobile Gate (site-wide block)

Suite 1.0 · 2026-07-21 · Locked decision D2

## 1. Behavior

Mobile and touch-only devices are blocked on **every** route. The gate must fire
before any heavy asset loads (spec: "avoid loading files and unnecessary
requests"), so it is an inline script in `<head>` of the base layout — zero
dependencies, runs before parser reaches `<body>` module scripts.

## 2. Criteria (single source of truth)

```ts
// src/lib/tt-gate-const.ts — also inlined verbatim into the head script
export const TT_GATE = {
  minWidth: 1024,          // px; blocks phones + portrait tablets
  blockCoarseOnly: true,   // touch-only, no hover → blocked (tablets w/o pointer)
} as const;

// head inline (is:inline, ~15 lines, no imports):
const blocked =
  window.innerWidth < 1024 ||
  (matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches);
if (blocked) document.documentElement.dataset.ttBlocked = '1';
```

- Evaluated **once at load**. Resizing a desktop window below 1024 px mid-session
  does not eject the user (deliberate — window snapping is normal desktop use).
- A desktop machine with touch + mouse has `hover: hover` → allowed. A tablet with
  attached keyboard/trackpad usually reports hover → allowed; pure touch → blocked.

## 3. Two-part enforcement

1. **Overlay:** `TtBase.astro` always renders a hidden full-screen
   `.tt-mobile-gate` element; CSS `html[data-tt-blocked] .tt-mobile-gate { display:flex }`
   plus `html[data-tt-blocked] body > *:not(.tt-mobile-gate) { visibility:hidden }`.
   No layout shift, no flash — the attribute is set before first paint.
2. **Load guard:** every heavy entry is conditional:
   ```ts
   if (!document.documentElement.dataset.ttBlocked) {
     import('./app/mount');        // Svelte island, engines, fonts-secondary
   }
   ```
   Fonts: DSEG7 + JetBrains Mono are loaded from the app bundle path only.
   Be Vietnam Pro subset for the gate/landing stays (few KB, needed for VI text).

   > ✅ **This guard is the chosen mechanism** (measured 2026-07-21, `01 §3`).
   > A plain `client:only` island was tried and rejected: it fetched the island
   > and hydrated it on a blocked viewport. `src/pages/app/index.astro`
   > therefore hand-mounts `src/app/mount.ts` through exactly the guard above —
   > no Astro client directive is involved.
   >
   > The guard is a **module** script, not a second `is:inline` one, so the
   > site keeps exactly one inline script (the gate in `TtBase.astro`) and the
   > CSP hash assertion in `10 §7` holds. On a blocked viewport the browser
   > therefore fetches one ≈200 B chunk that evaluates the `if` and stops —
   > zero component or framework bundles.
   >
   > It reads `data-tt-blocked` rather than re-evaluating the media queries, so
   > the overlay and the loader decide once, together.

## 4. Gate copy (bilingual, hardcoded in the static overlay — no JS i18n on mobile)

> **EN** — Sorry — TickTune isn't available on mobile.
> Please use a desktop browser and try again.
>
> **VI** — Xin lỗi — TickTune không hỗ trợ thiết bị di động.
> Vui lòng mở bằng trình duyệt trên máy tính.

(Original spec copy said "Desktop web/app"; adjusted — no desktop app exists.)
Below the text: wordmark + tally light (static), link to GitHub. Nothing else.

## 5. SEO consequence & mitigation (accepted trade-off)

Google indexes mobile-first; its smartphone crawler renders the page inside a
mobile viewport and will therefore see the gate. Mitigation applied:

- Landing/legal **HTML remains fully present in the DOM** under the overlay —
  content is crawlable text, not swapped out. Heavy bundles still never load.
- Honest expectation: interstitial-style blocking still devalues ranking. Accepted:
  TickTune's audience arrives via GitHub, Discord, and the SkullMute community, not
  organic mobile search.
- Never UA-sniff crawlers to show different content — that is cloaking and risks
  worse penalties than the interstitial itself.

## 6. QA

Playwright projects with mobile viewports/touch (`13 §5`): assert overlay visible,
app bundle request **absent** (network log), copy present in both languages;
desktop project asserts overlay hidden and island mounted. Manual check on one real
Android + one iPad (touch-only) before launch (`13 §7` live checklist).
