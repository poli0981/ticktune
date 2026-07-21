# 10 — Cloudflare Setup Guide

Suite 1.0 · 2026-07-21 · Requested by spec: full CF configuration walkthrough.
Assumes the domain (placeholder `ticktune.net`) is registered — Cloudflare
Registrar is fine — and the zone is on the **Free** plan unless noted.

## 1. Zone & DNS

1. Add site → `ticktune.com` → Free plan.
2. No origin server exists; the Worker owns the hostname. DNS is created
   automatically when the custom domain is attached to the Worker (§3). Any
   leftover placeholder A/AAAA records: delete.
3. Optional: `www` → Redirect Rule `www.ticktune.com/* → https://ticktune.com/$1`
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
  domain `ticktune.com` (this provisions DNS + cert).
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

## 6. Rate limiting (Free plan includes 1 rule)

- Rule "api-oembed-guard": match `http.request.uri.path starts_with "/api/"`,
  **60 requests / 1 min per IP** → Block for 1 min, response 429.
- The app treats a 429 from `/api/*` as a soft failure: track kept as
  `status:'pending'`, toast `toast.rateLimited`, retry on Start (`06 §5`).
  This is the concrete realization of the spec's "429 custom page".

## 7. Headers

`public/_headers` (authoritative set in `09 §2–4`) is honored by Workers Static
Assets. Build step `scripts/inject-csp-hash.ts` computes the mobile-gate inline
script hash and rewrites the CSP line before deploy — CI runs it in `build`.

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

- [ ] Custom domain attached, cert active, `https://ticktune.com` 200
- [ ] `curl -I` shows full `_headers` set incl. final CSP (not Report-Only)
- [ ] HSTS present · [ ] 404 route serves styled page
- [ ] `/api/yt/oembed?id=dQw4w9WgXcQ` → 200 JSON; 61 rapid calls → 429
- [ ] Bot Fight Mode on · [ ] rate-limit rule active
- [ ] `www` redirect (if configured) works
