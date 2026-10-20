# 09 — Security

Suite 2.0 · 2026-10-21 · Spec goal: "basic and sufficient" — right-sized for a
static client-side app, not theater.

## 1. Threat model

| Asset | Threats considered | Posture |
|-------|--------------------|---------|
| Visitors' browsers | XSS, clickjacking, malicious third-party scripts | Strict CSP, no inline event handlers; third-party scripts are exactly two: the YouTube IFrame API (only in YT mode) and the Cloudflare Web Analytics beacon (every page, since v1.1) |
| User media/privacy | Exfiltration, tracking | Files never transmitted; the only telemetry is the cookieless Cloudflare Web Analytics beacon (page-level timing, disclosed in the Privacy Policy, no access to app state); fonts self-hosted; youtube-nocookie |
| The site itself | Defacement via supply chain, CI compromise | Lockfile-pinned deps, `pnpm audit` + CodeQL + Dependabot in CI, least-privilege workflow permissions (`14 §3`) |
| Edge endpoint `/api/yt/oembed` | Abuse as open proxy, request floods | Strict `videoId` validation (11-char regex only — it is *not* a URL proxy), same-origin only (no CORS headers since v1.1), bounded upstream wait, 6 h edge cache, CF rate-limiting rule (`10 §6`) |
| Edge endpoint `/api/yt/durations` (v2.0) | Key theft, quota exhaustion, open proxy | Key is a Worker secret sent in a header — never in the page or a URL; ≤ 50 ids, each the same 11-char regex; same-origin only; per-id edge cache (24 h, 15 min for "none"); per-IP Workers rate limit (`10 §6`); fails closed to "no lengths", which costs a convenience and nothing else (`06 §3`) |
| DDoS / bots | Volumetric attacks | Cloudflare default DDoS mitigation + WAF and rate-limit rules (`10 §5`–`§6`); Bot Fight Mode stays **off** (`10 §4`) |

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
  YouTube iframe). HSTS is set at the Cloudflare zone (`10 §2`) rather than
  per-response — served as `max-age=31536000; includeSubDomains; preload`
  (measured 2026-10-20).
- `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`: TickTune may embed
  YouTube; nothing may embed TickTune.

## 3. Caching headers

```
/_astro/*      Cache-Control: public, max-age=31536000, immutable   (hashed assets)
/fonts/*       Cache-Control: public, max-age=31536000, immutable   (pinned release)
/sw.js         Cache-Control: no-cache                               (v2.0, `10 §9`)
/api/*         Cache-Control: set by the Worker per answer — oEmbed 6 h, lengths 15 min,
               failures max-age=0 (`06 §3`)
html           Cache-Control: public, max-age=0, must-revalidate    (platform default)
```

⚠️ **Do not add a `Cache-Control` line to the `/*` rule in `public/_headers`.**
Cloudflare *appends* header values when several rules match a path instead of
letting the most specific one win, so `/*` + `/_astro/*` shipped
`public, max-age=0, must-revalidate, public, max-age=31536000, immutable` —
two conflicting `max-age` values in one header, of which implementations
generally honour the first. Every content-hashed bundle and the vendored font
was uncacheable in production as a result.

HTML needs no rule: the Workers Static Assets default is already
`public, max-age=0, must-revalidate`. Nor can this be fixed in the Worker — a
matching asset is served **before** the Worker is invoked, so `worker/index.ts`
never sees those requests. `/api/*` is different precisely because no asset
matches it.

Found on the live site on 2026-07-21; `wrangler dev` against `/` alone did not
reveal it, because only one rule matched there. Verified fixed by re-checking a
hashed asset, the font and an HTML route separately.

## 4. Content-Security-Policy (authoritative)

```
default-src 'self';
script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://static.cloudflareinsights.com;
frame-src https://www.youtube-nocookie.com https://www.youtube.com;
img-src 'self' data: blob:;
media-src 'self' blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
connect-src 'self' https://cloudflareinsights.com;
worker-src 'self' blob:;
frame-ancestors 'none';
base-uri 'self';
form-action 'none';
object-src 'none';
upgrade-insecure-requests
```

Notes:
- `style-src 'unsafe-inline'` is required by Svelte's runtime style writes
  (`style:` directives, CSS custom properties); acceptable given that no
  user-generated HTML exists anywhere
  (all user strings render through Svelte text interpolation — never `{@html}`;
  enforced by lint rule, `12 §4`).
- The mobile-gate inline script must carry a hash: build step computes its SHA-256
  and appends `'sha256-…'` to `script-src` (small `_headers` templating step in
  the build; documented in `10 §7`).
- `blob:` in `img/media-src` covers cover art + local playback object URLs.
- ~~Rollout: ship first as `Content-Security-Policy-Report-Only` during P7
  hardening week, watch console on the live site, then enforce.~~
  🔴 **This never happened, and P7 slice B deleted the plan rather than
  performing it.** `public/_headers` has shipped `Content-Security-Policy:` since
  the first deploy — measured on the live site, which answers
  `content-security-policy`, not `…-report-only`. `10 §11` had already recorded
  "**CSP enforcing** (not Report-Only)" back in P1, so the suite has contradicted
  itself for six phases. The "switch to enforcing" release `14 §5` promised would
  have been a **no-op**.

  **The observation window the plan wanted was taken anyway, live, and it worked
  — twice.** P6 slice A's blocked `data:` fonts and the Cloudflare-injected
  script were both caught by the enforcing policy doing its job: refusing them,
  visibly, on a page that still rendered. Report-Only would have logged the same
  two findings and shipped the violations to users while we read the console.

  What made that survivable is that the policy has been strict from the first
  commit and the site ships **one** inline script whose hash the build injects
  and asserts (`10 §7`). A Report-Only phase is for retrofitting a CSP onto a
  site that already has inline handlers and third-party scripts — neither of
  which this project has ever had.

## 5. Client hardening details

- All user-visible strings from files/YouTube (titles, artists) are treated as
  untrusted text — Svelte escapes by default; `{@html}` is banned repo-wide.
  ⚠️ **The legal pages' `<Content />` is not an exception to this, because it is
  not the same thing.** The ban exists because `{@html}` renders an
  **unsanitised string at runtime**. `<Content />` is a build-time compilation of
  markdown that lives **in this repository**, checked in and reviewed like any
  other source: no runtime, no untrusted input, and a malformed document fails
  the build rather than reaching a browser. It is the same trust level as
  hand-writing the markup, and the alternative — retyping four legal documents
  as HTML — would be strictly worse, since the canonical text would then exist
  twice. Added P6 slice B; see `docs/08 §1.1`.
- ✅ **P6 slice B changed no origin, so the CSP is unchanged.** The legal pages
  are same-origin HTML with no scripts, no images and no fonts of their own.
- `rel="noopener noreferrer"` on every external link.
- No `eval`, no `new Function` (CSP enforces).
- Object-URL accounting assert (`05 §3`) doubles as a leak canary.

## 6. Dependency & CI hygiene

`pnpm-lock.yaml` committed; CI runs `pnpm audit --prod` (fail on high) and a
whole-tree audit at `critical`, CodeQL (GitHub default setup) and Dependabot
weekly (`14 §1`). New deps require a licence check against GPL-3.0
compatibility, and a distributed one a notices row (`11 §5`).

## 7. Vulnerability disclosure

`.github/SECURITY.md` is the policy. Two private channels: GitHub **Private
Vulnerability Reporting**, and **security@poli0981.dev** — both also published in
`/.well-known/security.txt` (RFC 9116; its `Expires` field must be renewed every
year, or scanners treat the file as stale). Until v1.1 this section said no email
address appeared anywhere in the project, while the Privacy Policy published one;
the role addresses are now deliberate and listed in `10 §4`.

⚠️ PVR must be **enabled** in repo Settings → Security → Private vulnerability
reporting, or the link in `SECURITY.md` 404s.

Headline in-scope class: anything causing user media to leave the browser — hard
invariant 1 and the central promise of `legal/PRIVACY-POLICY.md`. Explicitly out
of scope: Cloudflare-branded edge error pages (Free-plan decision, `10 §8`),
reachable rate limiting (intended, `10 §6`), and mobile-gate bypass via a spoofed
viewport — the gate is a product decision, not a security control.
