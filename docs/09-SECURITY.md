# 09 — Security

Suite 1.0 · 2026-07-21 · Spec goal: "basic and sufficient" — right-sized for a
static client-side app, not theater.

## 1. Threat model

| Asset | Threats considered | Posture |
|-------|--------------------|---------|
| Visitors' browsers | XSS, clickjacking, malicious third-party scripts | Strict CSP, no inline event handlers, zero third-party scripts except YouTube IFrame API (loaded only in YT mode) |
| User media/privacy | Exfiltration, tracking | Files never transmitted; no analytics; fonts self-hosted; youtube-nocookie |
| The site itself | Defacement via supply chain, CI compromise | Lockfile-pinned deps, `pnpm audit` + CodeQL + Dependabot in CI, least-privilege workflow permissions (`14 §3`) |
| Edge endpoint `/api/yt/oembed` | Abuse as open proxy, request floods | Strict `videoId` validation (11-char regex only — it is *not* a URL proxy), 6 h edge cache, CF rate-limiting rule (`10 §6`) |
| DDoS / bots | Volumetric attacks | Cloudflare default DDoS mitigation + Bot Fight Mode (`10 §5`) — appropriate scale for this project |

Out of scope (no backend, no accounts, no PII stored): SQLi, authn/z, session
attacks, GDPR data-subject tooling (nothing to export/delete server-side).

## 2. Header set — `public/_headers` (served by Workers Static Assets)

```
/*
  Content-Security-Policy: <see §4, single line>
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=()
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY
```

- No `X-XSS-Protection` (obsolete). No COEP (`require-corp` would break the
  YouTube iframe). HSTS is set at the Cloudflare zone (`10 §4`) rather than
  per-response.
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`: TickTune may embed
  YouTube; nothing may embed TickTune.

## 3. Caching headers

```
/_astro/*      Cache-Control: public, max-age=31536000, immutable   (hashed assets)
/fonts/*       Cache-Control: public, max-age=31536000, immutable
/api/*         Cache-Control: public, max-age=21600                 (set by Worker)
/* (html)      Cache-Control: public, max-age=0, must-revalidate
```

## 4. Content-Security-Policy (authoritative)

```
default-src 'self';
script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;
frame-src https://www.youtube-nocookie.com https://www.youtube.com;
img-src 'self' data: blob: https://i.ytimg.com;
media-src 'self' blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
frame-ancestors 'none';
base-uri 'self';
form-action 'none';
object-src 'none';
upgrade-insecure-requests
```

Notes:
- `style-src 'unsafe-inline'` is required by Svelte/Motion runtime style writes;
  acceptable given zero third-party scripts and no user-generated HTML anywhere
  (all user strings render through Svelte text interpolation — never `{@html}`;
  enforced by lint rule, `12 §4`).
- The mobile-gate inline script must carry a hash: build step computes its SHA-256
  and appends `'sha256-…'` to `script-src` (small `_headers` templating step in
  the build; documented in `10 §7`).
- `blob:` in `img/media-src` covers cover art + local playback object URLs.
- Rollout: ship first as `Content-Security-Policy-Report-Only` during P7
  hardening week, watch console on the live site, then enforce.

## 5. Client hardening details

- All user-visible strings from files/YouTube (titles, artists) are treated as
  untrusted text — Svelte escapes by default; `{@html}` is banned repo-wide.
- `rel="noopener noreferrer"` on every external link.
- No `eval`, no `new Function` (CSP enforces).
- Object-URL accounting assert (`05 §3`) doubles as a leak canary.

## 6. Dependency & CI hygiene

`pnpm-lock.yaml` committed; CI runs `pnpm audit --prod` (fail on high/critical) +
CodeQL javascript-typescript + Dependabot weekly (`14 §2`). New deps require a
license check against GPL-3.0 compatibility (`legal/THIRD-PARTY-NOTICES.md`
process note).
