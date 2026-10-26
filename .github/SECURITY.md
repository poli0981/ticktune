# Security Policy

## Supported versions

Only the latest deployed release is supported. TickTune is a static client-side
app plus one small edge endpoint, so "patched" means "redeployed" — hard-reload
(`Ctrl+F5`) to pick up a fix.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use either private
channel:

- GitHub's
  [Private Vulnerability Reporting](https://github.com/poli0981/ticktune/security/advisories/new)
  (the Security tab of this repository), or
- email **security@poli0981.dev**.

The same contacts are published at
[`/.well-known/security.txt`](https://ticktune.net/.well-known/security.txt)
(RFC 9116). Expect an acknowledgement within a week. This is a solo, unpaid
project: there is no bounty and no formal SLA, but genuine reports are taken
seriously and credited unless you prefer otherwise.

## What is in scope

The deployed site and this repository's code — in particular:

- Anything that causes user-supplied audio, images or playlist data to leave the
  browser. That is hard invariant 1 (`CLAUDE.md`) and the central promise of
  `legal/PRIVACY-POLICY.md`; a break here is the most serious class of bug the
  project can have. (The Cloudflare Web Analytics beacon is the site's one,
  disclosed piece of telemetry; it reads page-level timing and nothing the app
  holds — anything showing otherwise is in scope.)
- XSS, including via crafted ID3/Vorbis tags or YouTube titles. All such strings
  are untrusted input; `{@html}` is banned repo-wide (`docs/09 §5`, lint-enforced).
- CSP bypasses, or a build that ships a stale/incorrect `script-src` hash
  (`docs/09 §4`, `docs/10 §7`).
- Abuse of the two edge endpoints, `GET /api/yt/oembed` and
  `GET /api/yt/durations` — they accept only 11-character video ids, are
  same-origin only, and are deliberately not general URL proxies (`docs/09 §1`).
  Getting the Data API key out of the Worker is in scope.
- Supply-chain issues in shipped dependencies (`docs/11 §5`), and in the CI path
  that deploys them (`docs/14 §2`).

## What is out of scope

- Missing headers or behaviour on Cloudflare-generated edge error pages: the zone
  is on the Free plan and those pages are Cloudflare-branded by decision
  (`docs/10 §8`). (The account's Workers Paid plan does not change the zone plan.)
- Rate limiting being reachable — 429 on `/api/*` is intended (`docs/10 §6`).
- The mobile gate being bypassable by spoofing a viewport. It is a product
  decision, not a security control (`docs/07`).
- Anything requiring the user's own device or browser to already be compromised.
- Reports that a user can load copyrighted audio into their own browser. That is
  the user's responsibility under `legal/EULA.md §3`; the app never transmits it.
