# 10 — Cloudflare Setup Guide

Suite 1.0 · 2026-07-21 · Requested by spec: full CF configuration walkthrough.
Assumes the domain (placeholder `ticktune.net`) is registered — Cloudflare
Registrar is fine — and the zone is on the **Free** plan unless noted.

## 1. Zone & DNS

1. Add site → `ticktune.net` → Free plan.
2. No origin server exists; the Worker owns the hostname. DNS is created
   automatically when the custom domain is attached to the Worker (§3). Any
   leftover placeholder A/AAAA records: delete.
3. Optional: `www` → Redirect Rule `www.ticktune.net/* → https://ticktune.net/$1`
   (301). Keep the apex canonical.

## 2. TLS (SSL/TLS tab)

- Mode: **Full (Strict)** — harmless and correct even with no origin.
- Edge Certificates: Always Use HTTPS **On** · Minimum TLS **1.2** ·
  TLS 1.3 **On** · Automatic HTTPS Rewrites **On**.
- **HSTS**: enable, `max-age=15552000` (6 months), includeSubDomains On,
  preload **Off** initially (turn on + submit to the preload list only after a
  stable month — preload is effectively irreversible).

## 3. Worker deploy (Workers Static Assets)

```bash
pnpm build                 # Astro → dist/
pnpm wrangler deploy       # uses wrangler.jsonc from 01 §5
```

- Workers & Pages → ticktune → Settings → **Domains & Routes** → add custom
  domain `ticktune.net` (this provisions DNS + cert).
- CI does this with `CLOUDFLARE_API_TOKEN` (token scope: Account.Workers Scripts
  Edit + Zone.Workers Routes Edit only) + `CLOUDFLARE_ACCOUNT_ID` secrets
  (`14 §4`).
- `not_found_handling: "404-page"` serves `dist/404.html` for unknown paths —
  this is the 404 story; no zone feature needed.
- Free Workers tier: 100k req/day — far above expected traffic; the paid Workers
  sub already on the account removes even that ceiling.

## 4. Security toggles (zone)

| Setting | Value |
|---------|-------|
| Security → Settings → Security level | Medium |
| **Bot Fight Mode** | On (Free-plan bot mitigation) |
| Browser Integrity Check | On |
| Scrape Shield (email obfuscation) | Off — no emails on pages; avoids DOM mutation |
| DDoS | Managed rules are always-on by default; nothing to configure |

## 5. WAF (Free plan)

Security → WAF: Cloudflare Managed Ruleset toggles available on Free are limited —
leave defaults. Custom rules (5 free) — add one:

- **Block non-GET on api**: expression
  `http.request.uri.path starts_with "/api/" and http.request.method ne "GET"`
  → Block.

  Note this blocks **HEAD** too, since `HEAD ne "GET"`. That is intended — the
  client only ever issues GET (`06 §5`) and nothing needs to probe the endpoint
  — but it is worth knowing before someone debugs it with `curl -I` and reads
  the result as an outage. `worker/index.ts` mirrors the rule in code so local
  `wrangler dev` behaves like production rather than diverging from it.

## 6. Rate limiting (Free plan includes 1 rule)

- Rule "api-oembed-guard": match `http.request.uri.path starts_with "/api/"`,
  **60 requests / 1 min per IP** → Block for 1 min, response 429.
- The app treats a 429 from `/api/*` as a soft failure: track kept as
  `status:'pending'`, toast `toast.rateLimited`, retry on Start (`06 §5`).
  This is the concrete realization of the spec's "429 custom page".

## 7. Headers

`public/_headers` (authoritative set in `09 §2–4`) is honored by Workers Static
Assets. Astro copies `public/` into `dist/` verbatim, so the committed `_headers`
carries a `'sha256-<TT_GATE_HASH>'` placeholder inside `script-src`, and the build
step rewrites it.

**`scripts/inject-csp-hash.ts` — normative contract:**

| Aspect | Rule |
|--------|------|
| Ordering | Runs **after** `astro build`, **before** `wrangler deploy`. `pnpm build` = `astro build && tsx scripts/inject-csp-hash.ts` (`CLAUDE.md §Commands`) |
| Input | Globs `dist/**/*.html`; extracts the text of every inline `<script>` (i.e. one without `src`) |
| Hash | SHA-256 of the script's **exact** text content, base64 → `'sha256-…'` |
| **Assertion** | The set of distinct hashes must have size **exactly 1** — the mobile gate (`07 §2`) is the only inline script on the site. Size 0 → the gate vanished; size > 1 → an unhashed inline script slipped in. **Either fails the build with a non-zero exit** |
| Output | Replaces the `<TT_GATE_HASH>` placeholder in `dist/_headers`. Fails if the placeholder is absent (a stale `_headers` would silently ship a CSP that blocks the gate) |
| Idempotence | Safe to re-run; operates on `dist/`, never mutates `public/_headers` |

The size-1 assertion is what makes this coupling safe: without it, adding a second
inline script anywhere would ship a CSP that silently blocks it in production
only. Verified against a live enforcing CSP during P1 (`16 §P1`), not deferred to
P7 — at that point the gate is still the only inline script, so the check is
cheapest it will ever be.

## 8. Error pages — decision

Cloudflare **Custom Errors** went GA for **paid zone plans** (2025-04); the Free
zone plan shows Cloudflare-branded pages for edge-generated errors (challenge
pages, 52x). Decision per spec's conditional:

- App/asset-level errors are fully covered without any zone feature: SPA overlays
  (YT, offline, import), static `404.html`, Worker-emitted 4xx/429 JSON.
- Edge-generated CF pages are rare for a static Worker site; **accept default
  branding on Free**. If the zone is ever upgraded to Pro, add branded Error
  Pages then (assets ≤ 1.5 MB, single self-contained HTML) — nice-to-have only.

## 9. Offline / "No Internet"

Client-side: `navigator.onLine` + a failed-fetch probe drive a banner; entering
YouTube mode while offline shows a blocking panel (`yt.err.offline`); local modes
keep working once loaded. (Full offline PWA is post-1.0, `16 §post`.)

## 10. Observability

- Workers → ticktune → Logs (workers.dev tail / dashboard) for `/api` errors.
- Optional, privacy-consistent: **Cloudflare Web Analytics** (cookieless, no
  fingerprinting). If enabled, its beacon origin must be added to CSP
  `script-src`/`connect-src` and disclosed in the Privacy Policy — default is
  **off**; decide before launch.

## 11. Launch checklist (zone side)

Zone-side, still to do:

- [ ] Custom domain attached, cert active, `https://ticktune.net` 200
- [ ] HSTS present
- [ ] 61 rapid calls to `/api/*` → 429
- [ ] Bot Fight Mode on · [ ] rate-limit rule active
- [ ] `www` redirect (if configured) works

Everything domain-independent was verified locally against `wrangler dev` on
2026-07-21, so only the zone configuration above remains unproven:

- ✅ Full `_headers` set served, **CSP enforcing** (not Report-Only) — the
  injected `sha256-` matches what the browser computes, confirmed by loading the
  site in Chromium and asserting zero policy violations across `/`, `/app/` and
  a 404, on both desktop and mobile viewports. Repeatable:
  `pnpm build && pnpm exec wrangler dev --port 8788 --local` then
  `pnpm verify:csp`.
- ✅ The mobile gate still fires and the island still stays unloaded **with the
  CSP on** — a policy that blocked the inline gate would have shown up as the
  overlay silently not appearing.
- ✅ DSEG7 loads under `font-src 'self'`.
- ✅ `/api/yt/oembed?id=dQw4w9WgXcQ` → 200 JSON with
  `Cache-Control: public, max-age=21600` and CORS; `?id=xxx` and a missing `id`
  → 400 `invalid_id`; non-GET → 405.
- ✅ Unknown path → the styled 404 via `not_found_handling`.
- ✅ The `§7` one-inline-script assertion fails the build when violated — proven
  by adding a second inline script and watching `pnpm build` exit 1.

This deliberately pulls a P7 item forward (`14 §5`). In P1 the gate is the only
inline script on the site, so the check is as cheap as it will ever be, and a
broken hash coupling discovered at launch would be a launch slip.
