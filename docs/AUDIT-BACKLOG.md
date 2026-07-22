# Audit backlog

Generated 2026-07-21 from a pre-implementation adversarial audit of the doc
suite: five review lenses, then every finding independently attacked by a
separate verifier instructed to refute it. **48 findings survived**; this file
tracks all of them.

- ✅ **22 closed** during the bootstrap — table at the end
- ✅ **3 closed + 1 partially resolved** during P2 slice S1 (2026-07-21)
- ✅ **1 closed** during P3 slice 1 (2026-07-22) — queue mutation during playback
- ⬜ **22 open**

Severity is the *verified* severity. Several findings were downgraded when the
verifier showed the original claim overreached; where that happened, the
narrowed claim is what is recorded here, not the original.

> Two process rules apply to anything fixed from this list: new log codes are
> registered in `docs/12 §6` **before** use, and a new dependency needs a
> GPL-3.0 compatibility **and attribution** check before it lands
> (`docs/11 §5`).

---

## Open

### 🔴 blocker · Third-party notices reproduce no license texts or copyright holders, and the fallback claim about lockfiles is factually wrong

**Owner phase:** P6 legal pass — BLOCKS first public release · **Lens:** legal-compliance

Narrowed to a real must-fix-before-first-deploy (not a pre-implementation blocker): legal/THIRD-PARTY-NOTICES.md reproduces no copyright lines or license texts for the distributed components, and the suite's process rules never require it. Specifically: (a) the MIT deps (astro, svelte, @astrojs/svelte, tailwindcss, motion, music-metadata, i18next, nanoid) need their copyright + permission notice carried into the shipped output; (b) dexie (Apache-2.0) needs a copy of the License per §4(a) and NOTICE retention per §4(d); (c) Be Vietnam Pro and JetBrains Mono ship woff2 via @fontsource with no OFL text stated as shipped — DSEG7 is already compliant because docs/01 §4 and docs/03 §1 vendor OFL.txt with it, so the auditor's "no license text for anything" is wrong; (d) transitive bundled code (music-metadata's strtok3/token-types chain, etc.) is never covered by a hand-maintained 12-row table, so the fix is a generated NOTICES artifact from the actual bundle at build time, wired into docs/14 §1 and the P1 scaffold, rather than more table rows. The lockfile sentence at lines 27-29 is a separate, minor wording fix — pnpm-lock.yaml genuinely records no license fields, but it describes non-distributed dev tooling that carries no notice obligation, so it is cosmetic, not the blocker the auditor frames it as. Actionable now only as a doc/process amendment (docs/11 §5, CONTRIBUTING.md PR checklist, docs/14 workflow inventory); the artifact itself cannot exist until the dependency tree does.

**Recommendation.** Generate `/legal/third-party` from the lockfile at build time (license-checker/oss-attribution-generator over the *production* dependency closure, transitive included), emitting full license text + copyright line per package into a `THIRD-PARTY-NOTICES.txt` shipped with the build. Delete the lockfile-metadata sentence. Change the docs/11 §5 and CONTRIBUTING checklist wording from "GPL-3.0 compatibility" to "GPL-3.0 compatibility **and** attribution/notice obligations".

<details><summary>Evidence</summary>

```
legal/THIRD-PARTY-NOTICES.md lines 27–29: "Dev-only tooling (TypeScript, ESLint, Prettier, knip, Vitest, Testing Library, happy-dom, Playwright, Wrangler, pnpm) is not distributed with the app; licenses are visible in the repository lockfile metadata." Table rows are of the form "| Astro | MIT | build framework |" with no notice text. CONTRIBUTING.md checklist: "New dependency? License checked for GPL-3.0 compatibility + row added to `legal/THIRD-PARTY-NOTICES.md`". docs/11-DEPENDENCIES.md §5: "Licenses of any new dependency are checked for GPL-3.0 compatibility before merge and appended to `legal/THIRD-PARTY-NOTICES.md`."
```

</details>

---

### 🟠 high · The entire edge surface — Worker route, oEmbed egress from Cloudflare IPs, edge cache, rate limiting — is unvalidated by any of the four spikes

**Owner phase:** P4 (edge surface) · **Lens:** technical-risk

Narrowed to a single item, severity low-to-medium: no doc plans any observation of how `https://www.youtube.com/oembed` responds to requests originating from Cloudflare's shared colo egress IPs (an IP profile the project does not control), and no contingency is stated if it is systematically throttled or challenged. Everything else in the original finding is already covered: rate limiting and `_headers` are validated by the 10 §11 / 13 §7 post-deploy checklists, 429 and net-fail have documented soft-failure handling (06 §5 step 4, 10 §6, TT-YT-001), oEmbed is off the playback path (thumbnails from i.ytimg.com, titles backfilled by `getVideoData()` per 06 §2), and `caches.default` / asset-vs-Worker routing are documented platform defaults already specified in 01 §5. Actionable fix, ~2 hours: extend 15-SPIKES S1's method with one line - run the same curated-id oEmbed probes from a throwaway workers.dev Worker, not only from the dev box - and record in 06 §3 what happens if oEmbed is unreachable from the edge (expected answer: import falls back entirely to `status:'pending'` + player-side backfill, which the docs should state explicitly rather than leave implied).

**Recommendation.** Add a fifth spike, S5 "Edge smoke", timeboxed at half a day, before P1 rather than P4 — the deliverable is ~40 lines of Worker code and it de-risks the only non-static piece of the system. Acceptance: (a) deployed Worker fetches oEmbed successfully for 50 ids in a burst and again after 24 h from at least two colos, with the observed status-code distribution recorded in 06 §3; (b) `caches.default` hit/miss behavior confirmed via a response header; (c) `_headers` verified present on an HTML response and correctly absent on `/api/*`; (d) the 60 req/min rate-limit rule returns 429 and the documented soft-failure path is reachable. If (a) shows any CF-egress throttling, 06 §3 needs a fallback design (longer cache TTL, stale-while-revalidate, or accepting `status:'pending'` as a common rather than exceptional state) and that changes P4's UI work.

<details><summary>Evidence</summary>

```
docs/15-SPIKES.md S1 method: "Also probe `/oembed` responses for each id (server-side curl is fine here)." · docs/06-YOUTUBE-INTEGRATION.md §3: "→ edge fetch https://www.youtube.com/oembed?... → 200 {title, author_name, thumbnail_url} (cached 6 h, caches.default)" — asserted behavior, no validation step. · docs/16-ROADMAP.md: `/api/yt/oembed` Worker route first appears in P4; header enforcement in P7.
```

</details>

---

### 🟠 high · Editing the queue during playback is implied by the UI but absent from the state machine; reorder outcomes undefined — ✅ **resolved**

**Owner phase:** P3 (playlist) · **Lens:** spec-completeness

> ✅ **Resolved 2026-07-22 (P3 slice 1).** `02 §5.1 — Queue mutation during
> playback` answers all three named forks by separating **display order** (the
> queue array) from **playback order** (a sequence of track ids) and making the
> cursor a **track id rather than an index**:
> (a) a drag regenerates nothing — with Shuffle OFF the playback order *is* the
> array so the next track changes immediately, and with Shuffle ON the stored
> permutation is untouched; (b) toggling Shuffle takes effect **immediately**,
> pinning the current track first; (c) the now-playing track always stays current,
> which the id-cursor gives for free. "No immediate repeat" is now a testable rule
> (swap `next[0]`↔`next[1]` when the fresh permutation would repeat the track
> that just played, at `length ≥ 2`), and add/remove **reconciles** the stored
> permutation instead of regenerating it.
>
> The keyboard half is closed too: `03 §7` binds **`Alt+↑/↓`** (bare `↑/↓` were
> already volume ±5) and `02 §8`'s context-menu item list — which named only
> "Track info" — now also names **Move up / Move down** and **Remove**, so
> `13 §2`'s TtQueuePanel reorder test and `13 §6`'s keyboard-only journey have a
> concrete target.

Narrowed to a medium-severity spec gap: the docs never define the relationship between the queue array order shown in the Z4 Playlist rail (03 §2) and the Fisher-Yates playback order of 02 §5 ("reshuffle on wrap"). Specifically undefined: (a) whether a manual drag-reorder regenerates, remaps, or invalidates the current shuffle cycle; (b) whether toggling Shuffle mid-playback reshuffles immediately or takes effect at the next wrap; (c) whether the now-playing track stays current when it or another row is moved. 02 §3 names "playback order state" without specifying it. Deletion during playback is already covered by 02 §6 / TT-USR-001 and should be dropped from the finding, as should the "state machine doesn't model mutation" framing. The keyboard-reorder point reduces to a minor note: a Move up/Move down entry should be named explicitly in 02 §8's context-menu item list so 13 §6's keyboard-only journey and 13 §2's TtQueuePanel "reorder" test have something concrete to target.

**Recommendation.** Add a 'Queue mutation during playback' subsection to 02 defining allowed operations per state and the effect of each (add/remove/reorder) on the current index and the shuffle order; specify a keyboard reorder binding (e.g. Alt+↑/↓) in 03 §7 and the reorder outcome for the now-playing row.

<details><summary>Evidence</summary>

```
02 §1: '`setup` | Choose mode, set countdown, build queue.' vs 03 §2 Z4 Playlist row: 'Queue list: drag-to-reorder, now-playing highlight, per-row duration, right-click → context menu (`02 §8`), shuffle/repeat toggles'. 02 §5: 'shuffle: Fisher–Yates, reshuffle on wrap, no immediate repeat'. 03 §8: 'Full keyboard support: queue rows focusable, context-menu equivalent via `Menu` key / `Shift+F10`'.
```

</details>

---

### 🟠 high · Privacy Policy omits the www.youtube.com script fetch, and the CSP permits youtube.com framing the docs say is never used

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed to a documentation-accuracy fix in one legal file, severity low/medium (not high), and only the privacy half:

legal/PRIVACY-POLICY.md §3 is written as an exhaustive enumeration ("Network requests the app makes") but omits the IFrame API loader fetch to https://www.youtube.com/iframe_api specified in docs/06 §2:22 and allowed by docs/09 §4:50. §4 compounds this by naming only the "privacy-enhanced youtube-nocookie.com host" as where Google code comes from, and by scoping collection to "once you interact with the player" when the loader fetch happens on entry into YouTube mode, before any interaction. Fix is one bullet in §3 plus a clause in §4 naming www.youtube.com as the script origin. Pre-implementation this is a cheap edit and should be made before the policy is published.

REFUTED sub-claims: (a) the frame-src www.youtube.com entry is not undocumented drift — docs/06 §7:101-102 states the addition explicitly ("frame-src youtube-nocookie.com + youtube.com"); (b) it does not "contradict" the host invariant — a CSP allowlist permits an origin, it does not assert use, and no doc designates CSP as the enforcement point for which host the player runs on (CLAUDE.md invariant 8 only requires CSP + privacy updates when a NEW origin is introduced); (c) script-src www.youtube.com is not a lapse — Google serves the IFrame API loader only from that URL, so 06 §2 is correct.

Optional tightening (not part of the original finding, worth its own item): frame-src www.youtube.com is redundant given host: youtube-nocookie, and dropping it would make CSP a backstop for the invariant — but 06 §7 should then be edited in the same pass. Separately, script-src omits https://s.ytimg.com, which is where www.youtube.com/iframe_api injects www-widgetapi.js from; if that holds at implementation time the CSP as written would break the player and s.ytimg.com would also need privacy-policy disclosure. Worth verifying in Spike S1 (docs/15:12).

**Recommendation.** Add a fourth bullet to PRIVACY-POLICY.md §3: "YouTube player code (`www.youtube.com/iframe_api`), fetched only when you enter YouTube mode." Remove `https://www.youtube.com` from `frame-src` in docs/09 §4 (keep it in `script-src`, which the API genuinely needs) so the CSP enforces the nocookie-only invariant, and add an E2E assertion in docs/13 that no frame is created on www.youtube.com.

<details><summary>Evidence</summary>

```
docs/06-YOUTUBE-INTEGRATION.md §2: "IFrame API script loaded lazily on first entry into YouTube mode (`https://www.youtube.com/iframe_api`, CSP-allowed, §09)." docs/09-SECURITY.md §4: `script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com;` and `frame-src https://www.youtube-nocookie.com https://www.youtube.com;`. docs/06 §1.1: "Playback only through the **official IFrame Player API**, host `https://www.youtube-nocookie.com` (privacy-enhanced mode)." CLAUDE.md invariant 2: "playback only via the official IFrame Player, always visible at ≥ 200×200 …, on `youtube-nocookie.com`." legal/PRIVACY-POLICY.md §3 lists only three request classes.
```

</details>

---

### 🟠 high · YouTube API Services ToS attribution duties are absent from the "non-negotiable" compliance list

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed: the only real gap is that the YouTube Terms of Service and Google Privacy Policy are referenced as plain prose with no URLs. Add hyperlinks — https://www.youtube.com/t/terms in legal/EULA.md §4 (line 35), legal/DISCLAIMER.md (line 28) and the legal/THIRD-PARTY-NOTICES.md Services table (line 35), and https://policies.google.com/privacy in legal/PRIVACY-POLICY.md §4 (line 35-36) and legal/EULA.md §4 — and optionally add a sixth bullet to docs/06 §1 pointing at those legal files so the obligation is tracked alongside the other embed rules. Severity low-to-medium, not high; the disclosure and binding language itself is already present.

**Recommendation.** Add a sixth rule to docs/06 §1 and to CLAUDE.md: the YouTube-mode UI and the legal pages must carry live links to https://www.youtube.com/t/terms and https://policies.google.com/privacy, plus a visible "uses YouTube API Services" statement. Hyperlink these in EULA §4, PRIVACY-POLICY §4 and THIRD-PARTY-NOTICES Services table. Verify the current YouTube API Services ToS/Developer Policies text during Spike S1 and record the section references in 06 §1.

<details><summary>Evidence</summary>

```
docs/06-YOUTUBE-INTEGRATION.md §1 rules 1–5 (host, 384×216 visibility, "**Never** extract, proxy, cache, or re-stream", user-gesture chain, "restated in `CLAUDE.md`") — no attribution/link rule. legal/EULA.md §4: "you are also bound by YouTube's Terms of Service and Google's Privacy Policy" (plain text, no URLs). legal/PRIVACY-POLICY.md §4: "…as described in Google's Privacy Policy" (no URL). legal/THIRD-PARTY-NOTICES.md Services table: "YouTube embedded player & IFrame Player API | YouTube Terms of Service" (no URL).
```

</details>

---

### 🟠 high · Blurring/recoloring YouTube thumbnails is specified as a feature without a ToS check

**Owner phase:** P4 (YouTube) · **Lens:** legal-compliance

Narrowed to medium severity, docs-only: the suite specifies a modified/decorative use of the YouTube thumbnail (blurred full-bleed background in 06 §6 / 03 §64, dominant-hue extraction in 03 §5, echoed in 05 §86) without any corresponding entry in 06 §1's otherwise exhaustive non-negotiable compliance list, and without S1 (15-SPIKES) covering it. Fix pre-implementation: add a thumbnail-usage rule to 06 §1 stating the constraint the project intends to hold to, add a thumbnail row to legal/THIRD-PARTY-NOTICES.md's Services table (it currently has none — the "never bundled or modified" text is about the player/IFrame API, so the auditor's claimed contradiction there does not exist), and extend S1 to empirically verify canvas pixel access to i.ytimg.com, since without ACAO the hue-extraction half of the feature taints the canvas and is unimplementable regardless of the terms question.

**Recommendation.** Extend Spike S1 to include a written ToS/Developer-Policy read on thumbnail modification. Safest redesign: render the unmodified thumbnail at normal size inside the player rail (linked to the video) and drive the ambient background from a generated gradient rather than a blurred/derived version of YouTube's image. Fix the "never … modified" wording in THIRD-PARTY-NOTICES to match whatever is decided.

<details><summary>Evidence</summary>

```
docs/06-YOUTUBE-INTEGRATION.md §6: "Substitutes: blurred `hqdefault` thumbnail background, slow gradient drift, steady tally light." docs/03-UI-SPEC.md §5: "Skipped when no cover art or in YouTube mode (thumbnail hue used instead)." legal/THIRD-PARTY-NOTICES.md Services table: "loaded at runtime from YouTube only in YouTube mode; never bundled or modified". docs/06 §4 closing note scopes Spike S1 to "Exact signal↔cause mapping (esp. age vs region)".
```

</details>

---

### 🟠 high · OFL obligations are only satisfied for DSEG7; the two @fontsource families ship with no license file, and the Reserved Font Name condition is never mentioned despite planned subsetting

**Owner phase:** P6 legal pass — @fontsource OFL half only; DSEG7 is already compliant · **Lens:** legal-compliance

Narrow, low severity: legal/THIRD-PARTY-NOTICES.md lists Be Vietnam Pro and JetBrains Mono with a license name but no copyright holder, and neither docs/01 §4 nor any other doc provisions shipping their OFL text alongside the distributed woff2 (only public/fonts/dseg7/OFL.txt exists). OFL-1.1 §2 conditions redistribution on the copyright notice and license accompanying the Font Software, and the 11 §5 / CONTRIBUTING.md dependency gate checks only GPL-3.0 compatibility, so it never surfaces this. Fix = add the two upstream copyright lines to the notices table and ship the OFL texts the @fontsource packages already contain (e.g. under public/fonts/ or the rendered /legal/third-party page). The Reserved Font Name concern, the "subsetting creates a Modified Version" concern, and the caching-header concern are all dropped: RFN §5 governs naming Modified Versions and is not implicated by the CSS font-family reference to unmodified DSEG7; no doc describes an actual subsetting build step and no subsetting tool appears in 11 §3; and /_astro/* already carries the same immutable Cache-Control rule in docs/09 §3.

**Recommendation.** Copy each family's `OFL.txt` (with its upstream copyright line) into `public/fonts/<family>/` and reference all three from `/legal/third-party`; add the copyright holders to the notices table. Before shipping any subset, read each font's OFL header for a Reserved Font Name — if DSEG's RFN applies to a subset you generate, either ship keshikan's released woff2 unmodified or rename the derived family (e.g. `TT Segment`) in `--font-digit`. Add "OFL/RFN check" to the docs/11 §5 dependency process.

<details><summary>Evidence</summary>

```
docs/01-ARCHITECTURE.md §4: "`fonts/dseg7/` # vendored DSEG7 Classic woff2 + OFL.txt" (no equivalent for the other two). legal/THIRD-PARTY-NOTICES.md: "| Be Vietnam Pro (font) | SIL OFL 1.1 | via @fontsource package (packaging MIT) |" — no copyright holder, no license text. docs/07-MOBILE-GATE.md §3: "Be Vietnam Pro subset for the gate/landing stays (few KB, needed for VI text)." docs/03-UI-SPEC.md §1: `--font-digit: "DSEG7 Classic", …`. docs/09-SECURITY.md §3: "/fonts/* Cache-Control: public, max-age=31536000, immutable".
```

</details>

---

### 🟡 medium · Seven wrong section cross-references between chapters

**Owner phase:** P6 doc sweep · **Lens:** consistency

Four cross-references cite the wrong section and should be fixed: docs/07-MOBILE-GATE.md:74 `13 §5` → `13 §3`; docs/08-I18N.md:40 `13 §3` → `13 §1`; docs/09-SECURITY.md:14 `10 §5` → `10 §4`; docs/09-SECURITY.md:32 `10 §4` → `10 §2`. Two more are imprecise rather than wrong: docs/09-SECURITY.md:88 and docs/11-DEPENDENCIES.md:60 cite `14 §2`, which does hold the codeql.yml stub, but the audit.yml row and the Dependabot config line are in 14 §1 — widen to `14 §1–2`. Drop the remaining three: docs/03-UI-SPEC.md:83 `07 §3` correctly points at the enforcement mechanism that keeps the landing HTML in the DOM, and `16 §P6` / `16 §post` resolve unambiguously to a roadmap table row and a heading (notation style, not a broken anchor). Severity is low, not medium — no cited ref sends a reader to a materially misleading claim, and all are one-line doc edits before implementation.

**Recommendation.** Fix the seven refs (07 §3→§5, 13 §5→§3, 13 §3→§1, 10 §5→§4, 10 §4→§2, 14 §2→§1 ×2). For 16, either add real numbered sections (`## P0 … ## P7`, `## Post-1.0`) or change the two callers to cite "16-ROADMAP.md, phase P6" / "16-ROADMAP.md, Post-1.0 backlog". Add a CI docs-lint step that resolves every `NN §M` reference against the target file's headings — cheap, and the suite already has 40+ such refs that will keep drifting.

<details><summary>Evidence</summary>

```
docs/03-UI-SPEC.md:83: "Static, indexable (07 §3)." — but docs/07 §5 is "SEO consequence & mitigation (accepted trade-off)"
docs/07-MOBILE-GATE.md:74: "Playwright projects with mobile viewports/touch (`13 §5`)" — docs/13 §5 is "Performance budget (checked in P7)"
docs/08-I18N.md:40: "any missing/extra key fails the build (`13 §3`)" — the guard is listed in docs/13 §1 Unit table
docs/09-SECURITY.md:14: "Bot Fight Mode (`10 §5`)" — docs/10 §5 is "WAF (Free plan)"; Bot Fight Mode is §4
docs/09-SECURITY.md:32: "HSTS is set at the Cloudflare zone (`10 §4`)" — HSTS is docs/10 §2 "TLS"
docs/09-SECURITY.md:88 and docs/11-DEPENDENCIES.md:60: "Dependabot weekly … (`14 §2`)" — docs/14 §1 holds the inventory + "Dependabot: `.github/dependabot.yml`, npm weekly, grouped minor/patch."
docs/08-I18N.md:17: "roadmap P6 task (`16 §P6`)"; docs/10-CLOUDFLARE-SETUP.md:91: "post-1.0, `16 §post`" — docs/16 has no § numbering
```

</details>

---

### 🟡 medium · Six file/directory paths referenced by chapters do not exist in the 01 §4 target directory tree

**Owner phase:** P6 doc sweep · **Lens:** consistency

Narrowed to two paths and downgraded to low severity: the 01 §4 directory tree enumerates src/ down to individual filenames but omits two source directories that chapters specify concretely — src/lib/ (07 §2's `src/lib/tt-gate-const.ts`) and src/i18n/static/ (08 §1's `src/i18n/static/{vi,en}.ts`, distinct from the runtime `src/app/i18n/`). This is tree incompleteness, not contradiction: no doc places these files elsewhere, and both chapters give unambiguous paths a scaffolder can follow. Fix is a two-line addition to the 01 §4 tree. The other four paths (scripts/, knip.json, legal/, tests/manual/) are root-level tooling/meta in the same category as the tree's already-omitted package.json, .github/, LICENSE, and tsconfig.json — not defects; legal/ is additionally documented in README's repo-file table and already exists on disk. The timer-worker "split across two roots" is not a finding at all.

**Recommendation.** Make 01 §4 the exhaustive tree: add `src/lib/`, `src/i18n/static/`, `scripts/`, `tests/manual/`, `knip.json`, `legal/`, `CLAUDE.md`, `README.md`, `package.json`, `.github/`. Decide whether the timer worker lives at `src/app/engine/timer/tt-timer.worker.ts` (keeps the engine self-contained, matches 01 §3) or stays under `src/workers/`, and make both places agree. Note this also resolves the standing repo-state problem that the suite currently sits in `ticktune-docs/` while every path in it assumes repo root.

<details><summary>Evidence</summary>

```
docs/01-ARCHITECTURE.md §4 tree root: only `public/`, `src/{layouts,pages,app,styles,workers}`, `worker/index.ts`, `wrangler.jsonc`, `astro.config.mjs`, `tests/{unit,component,e2e}/`, `docs/`
docs/07-MOBILE-GATE.md §2: "// src/lib/tt-gate-const.ts — also inlined verbatim into the head script"
docs/08-I18N.md §1: "strings from `src/i18n/static/{vi,en}.ts` typed dictionaries"
docs/05-AUDIO-ENGINE.md §7: "generated in the repo by `scripts/make-chime.ts`"; §8: "produced by `scripts/make-fixtures.ts`"
docs/10-CLOUDFLARE-SETUP.md §7: "Build step `scripts/inject-csp-hash.ts`"
docs/13-TESTING.md §4: "Curated list maintained in `tests/manual/yt-matrix.md`"
docs/12-CODE-STANDARDS.md §5: "knip config lives in `knip.json`"
docs/01-ARCHITECTURE.md §3: "| Timer engine | `src/app/engine/timer/` |" vs tree line "│   └── workers/tt-timer.worker.ts"
```

</details>

---

### 🟡 medium · Privacy Policy tells users settings are stored in localStorage; 02 and 12 forbid it

**Owner phase:** P6 legal pass · **Lens:** consistency

Low-severity wording inaccuracy, not a legal or compliance defect: PRIVACY-POLICY.md §2 (line 19) should read "via IndexedDB" instead of "via IndexedDB/localStorage", to match 02-DATA-FLOW.md §3, which names Dexie/IndexedDB as the sole persistence layer for settings and legal-gate acceptance. Drop the auditor's secondary claims — 12 §4 bans localStorage only "for structured data" (not outright), and the "Reset app clears all locally stored data" promise is not broken by 03 §6's "clears Dexie" since nothing is persisted outside Dexie.

**Recommendation.** Change the Privacy Policy to "stored locally in your browser's IndexedDB database" (drop localStorage). Add a line to CONTRIBUTING's PR checklist / 12 §4 noting that any change to storage mechanism requires a Privacy Policy edit in the same PR — the checklist already has that rule for CSP origins but not for storage.

<details><summary>Evidence</summary>

```
legal/PRIVACY-POLICY.md §2: "Settings … and your Legal Gate acceptance are stored locally via IndexedDB/localStorage on your device."
docs/02-DATA-FLOW.md §3: "**Persisted** (Dexie `ticktune` DB, table `settings`): language, theme/background choice, … legal-gate acceptance `{version, acceptedAt}`, last-used mode."
docs/12-CODE-STANDARDS.md §4 banned-patterns table: "| `localStorage` for structured data | Dexie only (settings schema versioned) |"
```

</details>

---

### 🟡 medium · GPL-3.0 compliance is incomplete beyond the LICENSE blob: no copyright notice, no SPDX convention, no license metadata, no explicit source offer

**Owner phase:** P6 legal pass · **Lens:** repo-hygiene

Low-severity documentation-completeness gap, not a GPL compliance failure. Three concrete items remain: (a) docs/12-CODE-STANDARDS.md §1 states no policy on per-file `SPDX-License-Identifier: GPL-3.0-only` headers, so a file extracted in isolation carries no terms and the only-vs-or-later distinction is unstated in source; (b) no doc specifies `"license": "GPL-3.0-only"` for the package.json that docs/14-CI-CD.md:121 already depends on; (c) README.md states the license but never links the LICENSE file. Related minor gap found while verifying: the directory tree in docs/01-ARCHITECTURE.md §4 omits LICENSE, README.md, CLAUDE.md, legal/ and package.json. Drop entirely: the demand for a copyright notice inside LICENSE (the verbatim text must not be edited, and © 2026 poli0981 is already in legal/THIRD-PARTY-NOTICES.md, which is surfaced in the About panel), the "no explicit source offer" claim (03-UI-SPEC.md:123 + 14-CI-CD.md:121 already require version, license and GitHub link in About), and the LICENSE-vs-COPYING question (only LICENSE exists; nothing proposes COPYING).

**Recommendation.** Keep LICENSE (do not add COPYING as a duplicate). Add the GPL "How to Apply These Terms" copyright/notice block to README.md's License section with the year and holder, set `"license": "GPL-3.0-only"` in package.json, and add a one-line SPDX-header convention to 12 §1. Make 03's About panel requirement explicit: it must show the build version AND a link to the exact source commit/tag, which doubles as the GPL §6 source offer.

<details><summary>Evidence</summary>

```
`head -3 LICENSE` → "GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007" (verbatim text, no appended copyright/how-to-apply notice filled in). legal/THIRD-PARTY-NOTICES.md:8 "TickTune's own code: **GPL-3.0-only** — © 2026 poli0981." legal/EULA.md §2: "licensed under **GNU GPL-3.0-only** — see `LICENSE` in the repository". 03-UI-SPEC.md:123 "| About | Version, license, GitHub, third-party notices |". 12-CODE-STANDARDS.md §1 (Naming) contains no license-header rule. No package.json exists.
```

</details>

---

### 🟡 medium · Countdown rendering cost at rAF is never spiked, yet the signature visual stacks three blurred text-shadows, a ghost layer, scanlines and a canvas on the same frames

**Owner phase:** P5 (visuals) · **Lens:** technical-risk

Two low-severity doc-wording gaps, not a medium architectural risk to the signature visual:

(a) 13 §5's performance budget names only the visualizer, so the sub-60 s countdown's own per-frame paint is unbudgeted. The countdown is the one element that re-rasters layered blurred text every rAF frame (04 §4 `SS.mmm`, 03 §1 `text-shadow: 0 0 8px, 0 0 24px, 0 0 64px` at `clamp(96px, 18vw, 280px)`), yet the only frame-cost guards in the suite — 13 §5's long-task check and 05 §6's adaptive degrade — are both scoped to the canvas. Fix: extend 13 §5's budget line to cover the sub-60 s countdown regime with the visualizer running, and add a frame-rate clause to 16-ROADMAP's P1 exit criterion (currently just "Countdown runs full formats"), which is where the countdown display actually lands. No new P0 spike is warranted — 15-SPIKES' four spikes are correctly scoped to the genuinely unknown external behaviors, and the glow's cost is observable in P1 on the stated dev box.

(b) 03 §1 specifies the ghost as the fixed literal "888:88:88" (9 glyphs) while 04 §4's formats are 7, 5 and 6 glyphs and calls the same layer just "888". State that the ghost string is derived from the active format's glyph pattern. Note this does not weaken any anti-jitter guarantee — 04 §4's "DSEG7 is inherently monospaced" is what provides that — it is only a rendering/alignment detail.

**Recommendation.** Fold a 1–2 hour render-cost probe into P1, where 16 already schedules "timer engine + countdown display". Minimal test: a static page with the real DSEG7 face, the three-layer glow, the ghost layer and a full-screen scanline overlay, updating a `SS.mmm` string every rAF, profiled at 1440p and 4K with the Performance panel and with 6× CPU throttling; then again with a dummy canvas doing analyser-style fills. Record frame time. If the text paint dominates, the standard mitigations (promote the digit layer to its own compositing layer, pre-render the glow as a blurred duplicate that does not change per frame, or drop the 64 px shadow below 60 s) are all cheap in P1 and expensive in P7. Also correct 04 §4/03 §1 so the ghost string is defined per format.

<details><summary>Evidence</summary>

```
docs/04-TIMER-ENGINE.md §4: "| **< 60 s** | `SS.mmm` | every rAF frame | `42.183` |" · docs/03-UI-SPEC.md §1: "layered `text-shadow: 0 0 8px, 0 0 24px, 0 0 64px` of the current digit color at decreasing alpha. Ghost segments: render \"888:88:88\" behind the live digits at 6% opacity" · docs/13-TESTING.md §5: "Visualizer steady-state: no long tasks > 50 ms while playing (Performance panel spot-check)" — scheduled in P7, and scoped to the visualizer only.
```

</details>

---

### 🟡 medium · Import pipeline has no cancel, no concurrency rule, no directory handling, and no partial-batch policy — **partially resolved**

**Owner phase:** P3 (playlist) · **Lens:** spec-completeness

> ✅ **Both halves P2 owns are resolved (2026-07-21, P2 slice S1).** `02 §4` now
> opens with a **step 0 pre-scan** that flattens dropped directories via
> `webkitGetAsEntry` (depth-first, `Intl.Collator` order, capped at 500 entries →
> the newly registered TT-IMP-008) and **hoists the count cap ahead of** the
> duration/metadata work, which is the ordering defect. The same edit settles the
> concurrent-drop rule (single-flight, ignored with a toast), the cancel button
> (none in v1.0, with the reason), the partial-batch policy (accepted files are
> kept), and adds the two silent-failure hazards the implementation must handle —
> `DataTransfer.items` neutering after the first `await`, and
> `readEntries()`'s 100-entry chunking, which truncates this project's own
> 104-file corpus.
>
> **Left open against P3:** the import progress indicator (deferred with the
> reason recorded — Single mode imports one file at a median 11 ms) and any
> Playlist-specific recursion niceties.

02 §4 leaves two real gaps, both fixable with a sentence each before P2/P3 implementation. (1) Dropped directories are unhandled: the pipeline consumes `File` objects only, so a folder dropped on the Setup drop zone (03 §3) falls through step 1's extension allow-list and is logged as TT-IMP-001 "unsupported format". The doc should either specify recursion via `webkitGetAsEntry`/`getAsFileSystemHandle` or state an explicit reject-with-distinct-code policy. This matters concretely because the project's own test corpus is a 104-file folder. (2) Step ordering lets unbounded work precede the count cap: step 2's duration decode runs for every dropped File before step 3's `queue.length >= 95 -> TT-IMP-004` check can reject it, so an N-file drop performs N sequential loadedmetadata probes. Hoisting a pre-loop count check ahead of step 2 fixes it. NOT part of the finding: the parseBlob blow-up (parseBlob is step 5, already gated behind step 3), the partial-batch ambiguity (the `for each File` loop plus the "Added 12 - Skipped 3" summary toast make partial-add explicit), and the missing cancel button (nicety on a bounded sub-10-second operation). A third, lesser item is worth one sentence for symmetry: 06 §5 specifies "4 concurrent" oEmbed checks for the YouTube importer while 02 §4 says only "sequentially" and never states what a second drop during an in-flight batch does (queue / reject / abort).

**Recommendation.** Specify: cancel button semantics (keep already-added tracks), behavior for a second concurrent drop, directory traversal (recurse or reject), a hard pre-scan cap on dropped file count, and an explicit statement that accepted files are kept when a later file trips an aggregate limit.

<details><summary>Evidence</summary>

```
02 §4: 'Batch processed sequentially with a progress indicator; ends with a summary toast ("Added 12 · Skipped 3")'. Step 3: 'Aggregate checks (Playlist mode only): total + durationMs > 5_460_000 (91:00) ... fail → TT-IMP-003 / queue.length ≥ 95 ... fail → TT-IMP-004'. 15 S3 acceptance: '95-file batch parses < 10 s total on the dev box.'
```

</details>

---

### 🟡 medium · i18n runtime policy gaps: no fallback/missing-key behavior, self-contradictory detection rule, ambiguous legal links, and undefined VI legal content before P6

**Owner phase:** P5 (i18n) · **Lens:** spec-completeness

08 §2 omits two implementer-facing i18next runtime settings that the rest of the suite makes consequential: (a) interpolation.escapeValue — 09 §4 bans {@html} and relies on Svelte's own escaping, so i18next's default escapeValue:true would double-escape interpolated values into visible HTML entities; and (b) missing-key behavior/fallbackLng, which is low-risk given the build-failing en/vi key-diff guard (13 §1) but still undefined for typo'd t() calls, where i18next's default would render raw IDs like 'yt.err.blocked.title'. Separately, 08 §1 defines two static legal trees (/legal/* VI, /en/legal/* EN) while 03 §3 item 2 and 03 §6 refer only to 'links to /legal/*' and 'reopen legal pages' — no doc states which tree the in-app legal gate and Settings link to when the app language is toggled on the single /app/ route. Severity: low-to-medium, doc-only fix. The 'self-contradictory language detector' and 'VI legal content undefined during P1–P5' portions of the original finding are dropped as unfounded.

**Recommendation.** State `fallbackLng: 'en'`, the missing-key behavior (dev throw / prod fallback), and escaping. Reword the detector sentence to 'no i18next detector plugin; one-time `navigator.language` sniff at init'. Add a rule mapping app language → legal route prefix. State what the VI legal routes serve before P6 (EN text with a banner, or route not shipped).

<details><summary>Evidence</summary>

```
08 §2: 'no HTTP backend, no language detector — explicit toggle only' followed by 'Initial language: persisted setting → else `navigator.language` starts with `vi` → VI, else EN.' 08 §1: 'both languages ship at v1.0 — VI translation of legal drafts is a roadmap P6 task (`16 §P6`).' 16 P1 scope: 'legal gate shell'. 16 P6 scope: 'legal pages from `legal/*` drafts, **VI translation of legal**'.
```

</details>

---

### 🟡 medium · The Worker route `/api/yt/oembed` has no automated test tier — it is mocked everywhere and verified only post-deploy

**Owner phase:** P4 (worker) · **Lens:** spec-completeness

The Worker handler's own logic in `worker/index.ts` (`^[A-Za-z0-9_-]{11}$` validation -> 400, upstream 404/400 passthrough mapping, the two distinct cache TTLs of 6 h / 15 min, and the `/api/* Cache-Control: max-age=21600` header from 09 §3) has no automated test tier: 13 §3-§4 mock it, 13 §7 checks it only post-deploy, and 11 §3 lists no Workers test runner (`@cloudflare/vitest-pool-workers` / miniflare). Narrowing: (a) the CF rate-limiting rule and Bot Fight Mode are zone configuration (10 §5-§6), not Worker code, so leaving those to the live checklist is correct and is not part of the gap; (b) the 11-char id regex IS unit-tested per 13 §1 line 15, but for the client-side URL parser in `src/app/engine/youtube/`, not for the Worker's independent copy of the same check; (c) CORS is under-specified rather than merely untested — only 01 §1 line 30 mentions it ("returns JSON with CORS") and no doc gives the authoritative header value, so a spec line is needed before an assertion can be written. Severity is closer to low-medium: the endpoint takes no URL parameter by design so the open-proxy threat is structurally mitigated; the untested surface is regression risk on a small handler, not a ship-blocking hole.

**Recommendation.** Add a 13 §Worker tier with unit tests for the id regex (valid/invalid/injection attempts), status passthrough, cache TTL selection and CORS headers, using `@cloudflare/vitest-pool-workers`; add that package to 11 §3 and a job to 14 §1's `ci.yml`.

<details><summary>Evidence</summary>

```
13 §4: 'CI mocks `/api/yt/oembed` responses for the import-pipeline E2E instead of hitting YouTube.' 13 §7: '[ ] Headers/CSP live (`10 §11`), `/api` 429 after burst' (post-deploy only). 09 §1: 'Edge endpoint `/api/yt/oembed` | Abuse as open proxy, request floods | Strict `videoId` validation (11-char regex only ...)'. 11 §3 dev-dependency table lists vitest, happy-dom, playwright — no Workers test pool.
```

</details>

---

### 🟡 medium · Diagnostics payload shape is asserted by a test but never typed, and console capture has no defined mechanism

**Owner phase:** P1 (log engine) · **Lens:** spec-completeness

Narrowed to a low-severity doc inconsistency: the docs never define how `console.warn`/`console.error` reach the diagnostics buffer. 02 §7 specifies global capture only for `window.onerror` + `unhandledrejection` (→ TT-SYS-3xx per 12 §6), which does not intercept console calls, yet 12 §4 justifies allowing warn/error on the grounds that they "also feed the diagnostics buffer", and 02 §7's payload lists "last 50 log entries" and "captured console errors" as two distinct members — while the ring-buffer entry type `{ts, level, code, message, trackId?}` mandates a TT-code that raw console output has no source for. Fix during P-phase implementation by either (a) deleting the "captured console errors" key and the 12 §4 parenthetical, keeping one coded ring buffer, or (b) stating the wrapper (e.g. a `log.warn`/`log.error` facade in `src/app/engine/log/` that mirrors to console) and giving the second store a shape. The remaining sub-claims — undefined `version` source, missing TtSettings, absent TS interface, and missing redaction rule — are refuted by 14 §5 / 03 §6, 02 §3, doc-scope, and PRIVACY-POLICY §5 + bug_report.yml + 09 §1 respectively.

**Recommendation.** Type the payload as `TtDiagnostics` in 02 §7, state the version source, define the console-capture mechanism (wrapper vs patch) and whether it is the same ring buffer, and add a redaction rule for file names/titles (or an explicit note that they are included so users can review before pasting).

<details><summary>Evidence</summary>

```
02 §7: 'Copy Diagnostics button producing JSON: `{ app:\'TickTune\', version, ua, mode, settings-snapshot, last 50 log entries, captured console errors }`'. 12 §4: '`console.log` in committed code | `no-console` (allow `warn`/`error`, which also feed the diagnostics buffer)'. 13 §1 Log row: 'ring-buffer wrap at 500; level filter; diagnostics payload shape'.
```

</details>

---

### 🟡 medium · Roadmap phases do not own several artifacts that earlier phases depend on, and open blockers are unscheduled

**Owner phase:** P6 doc sweep · **Lens:** spec-completeness

Narrowed to repo hygiene only: no doc in the suite mentions a `.gitignore` (16's phase table, CONTRIBUTING §Setup, and 01 §4's directory tree all omit it), yet the repo has none and P0/S3 runs against a 104-file personal library under `test/` that must never be pushed — and P0 precedes P1 scaffold, so the first spike branch is already exposed. Actionable fix: add a `.gitignore` (covering `test/`, `.idea/`, `node_modules/`, `dist/`, `.astro/`, `.wrangler/`) as an explicit pre-P0 task, note in 15 §S3 that the personal corpus stays out of the repo, and assign the `ticktune-docs/` → repo-root relocation (assumed by 01 §4 and CLAUDE.md) to P1. Drop the claims about make-chime.ts / make-fixtures.ts / inject-csp-hash.ts ownership, about the open blockers being unscheduled, and about S3 needing to be CI-reproducible — all are refuted by 11 §2/§4, 14's confirm-before-committing banner, 16 P7, 09 §4, 10 §7, 15's throwaway-spike framing, and 13 §3–4.

**Recommendation.** Add the three generator/build scripts to their consuming phases (chime + fixtures → P2, inject-csp-hash → P1 since it runs on every deploy), add a 'P1 · repo hygiene' line covering `.gitignore` and the docs relocation, schedule the domain purchase and the workflow-filename confirmation with explicit owners/dates, and note in 15 §S3 that the corpus is local-only and its findings are recorded in the doc rather than reproduced in CI.

<details><summary>Evidence</summary>

```
16 P2 exit criteria: 'Single mode E2E passes; fade+chime works with tab hidden'. 05 §7: '`public/audio/chime.opus` — ... generated in the repo by `scripts/make-chime.ts`'. 14 §5.3: 'Tag `vX.Y.Z` → `deploy.yml` builds, runs `scripts/inject-csp-hash.ts`'. 16 P1 scope: 'Scaffold (Astro 7 + Svelte 5 + TW 4 + wrangler), TS7-vs-5.9 check (`11 §4`), ... CI stubs live'. 15 S3 method: 'corpus: mp3 (ID3v1-only, v2.3 UTF-16, v2.4 UTF-8), flac, m4a, ogg, opus, wav — including files tagged in Vietnamese (own library)'.
```

</details>

---

### 🟡 medium · Privacy Policy has no controller identity, contact point, retention, or jurisdiction, and docs/09 declares data-subject handling out of scope

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed to a documentation-completeness gap, severity low-medium: legal/PRIVACY-POLICY.md contains no contact section and no operator identity, so a reader who lands on the standalone /legal/privacy route (docs/08 §1 ships legal pages as separate VI/EN routes) has no route to raise a privacy question - the only contact anywhere in the suite is EULA §8's GitHub issues URL, which requires a GitHub account and forces a privacy question to be aired publicly. Additionally, none of the four legal docs names a governing jurisdiction (EULA §6/§7 say only "applicable law"). Since §4 concedes Cloudflare processes IP addresses to deliver the site, the operator is a controller for that processing, and an identity + contact line is standard under both GDPR Arts. 13-14 and Vietnam's Decree 13/2023 (relevant given Vietnamese is the default UI). Fix: add a short "Contact / Who runs TickTune" section to PRIVACY-POLICY.md naming the operator and a non-GitHub channel (a dedicated privacy alias), and add a governing-law line to EULA; add this as an explicit P6 exit criterion, since P6's current exit criteria are purely technical. DROP from the finding: the retention claim (already covered by §2 and §4), the docs/09-SECURITY.md §1 claim (misread of a threat-model engineering-scope line whose parenthetical is correct), and the "(c) 2026 poli0981 is a handle" claim (valid pseudonymous copyright notice, not a defect).

**Recommendation.** Add a "Who operates TickTune / contact" section to PRIVACY-POLICY.md with a real contact email, and a short "Your rights" paragraph stating that no personal data is held server-side beyond transient/edge processing and giving the channel to ask. Add a governing-law clause to EULA.md. Reword docs/09 §1 from "no PII stored" to "no PII stored by the application; edge-level request data is processed by Cloudflare — see PRIVACY-POLICY §4".

<details><summary>Evidence</summary>

```
legal/PRIVACY-POLICY.md §7 is the final section ("Material changes re-trigger the Legal Gate…"); no contact/controller section exists. legal/EULA.md §8: "Issues and questions: `https://github.com/poli0981/ticktune/issues`." docs/09-SECURITY.md §1: "Out of scope (no backend, no accounts, no PII stored): … GDPR data-subject tooling". docs/08-I18N.md §1: "Vietnamese is the default".
```

</details>

---

### 🟡 medium · Diagnostics payload is broader than the Privacy Policy discloses, and the bug template overpromises

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed to trivial/low severity and reframed as a spec-completeness gap, not a privacy-disclosure defect: docs/02-DATA-FLOW.md §7 leaves the log entry `message` field's content entirely unspecified while bug_report.yml already assures reporters the JSON is safe to paste into a public GitHub issue. The actionable pre-implementation fix is a one-line constraint in 12-CODE-STANDARDS §6 stating that log messages carry only the TT-XXX-nnn code plus non-identifying context (never raw fileName or user-supplied strings), which makes the template's assurance true by construction. Optionally add `mode` and console-capture to the PP §5 parenthetical for exactness, but PP §5 requires no substantive change: the artifact is local-only, never transmitted, and already carries "Review it before sharing." The auditor's blob-URL / trackId file-name leak vector should be dropped entirely as factually wrong.

**Recommendation.** Align the PRIVACY §5 enumeration with the actual 02 §7 field list and state plainly that log lines and console output may include the names of files you loaded. Change the issue-template copy to "It contains no file contents, but may include file names and your settings — review before posting." Optionally redact `fileName` to `<name>.<ext>`-hash in diagnostics export.

<details><summary>Evidence</summary>

```
docs/02-DATA-FLOW.md §7: "**Copy Diagnostics** button producing JSON: `{ app:'TickTune', version, ua, mode, settings-snapshot, last 50 log entries, captured console errors }`". legal/PRIVACY-POLICY.md §5: "a JSON snapshot (app version, browser user-agent, settings, recent internal log)". .github/ISSUE_TEMPLATE/bug_report.yml, diagnostics field: "It contains no personal files — feel free to review it first."
```

</details>

---

### 🟡 medium · All four legal documents are marked Draft with no finalization task and no defined legal-version constant, despite re-gating promises

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed claim: the legal-gate version has no defined source of truth or sync discipline. docs/03-UI-SPEC.md §3.2 says the gate is "Re-shown if legal version bumps" and docs/02-DATA-FLOW.md §3 persists `{version, acceptedAt}`, but no doc names the file holding that constant (contrast docs/07-MOBILE-GATE.md L15, which pins `TT_GATE` to `src/lib/tt-gate-const.ts` — a path that is itself absent from the docs/01 §4 directory tree), states how the `Version 1.0-draft` headers in the four legal/*.md files and their `src/pages/legal/*.astro` renderings stay in sync with it, or defines what triggers a bump. Concrete fixes, all cheap before scaffolding: (a) declare the constant's home and add it to the docs/01 §4 tree; (b) add a CONTRIBUTING.md PR-checklist line next to the existing CSP/Privacy item — "legal/* text changed materially? bump the legal version constant + all four doc headers in this PR"; (c) add a version-bump re-show case to docs/13-TESTING.md §2/§7, which currently only covers first-run Accept and persistence; (d) add "legal version string finalized (no `-draft`) in constant, legal/*.md, and rendered pages" to the P7 exit criteria, since the v1.0.0 tag would otherwise persist "1.0-draft" as the accepted version. Drop the lawyer-review / draft-title portion of the original finding — that is not an actionable exit criterion for this project.

**Recommendation.** Define `TT_LEGAL_VERSION` in a single module (alongside `src/lib/tt-gate-const.ts` per docs/07 §2), document it in docs/02 §3, and add a CONTRIBUTING checklist item: "Changed any file in `legal/`? Bump `TT_LEGAL_VERSION` and note whether the change is material." Add a P6/P7 exit criterion that the drafts lose "(Draft)" status before the v1.0.0 tag.

<details><summary>Evidence</summary>

```
legal/EULA.md line 5–6: "This draft is written by the developer, not by a lawyer". legal/PRIVACY-POLICY.md line 3: "Version 1.0-draft". docs/16-ROADMAP.md §P6 exit criteria: "Lighthouse ≥ 95 static pages; hreflang correct". docs/02-DATA-FLOW.md §3: "legal-gate acceptance `{version, acceptedAt}`". legal/EULA.md §1: "if these documents change materially, the gate is shown again."
```

</details>

---

### 🟡 medium · Domain is ticktune.net in README and ticktune.com throughout docs/10, while the EULA scopes itself to an unnamed "official domain"

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

docs/10-CLOUDFLARE-SETUP.md contradicts itself and the README-declared convention: its intro (line 4) names the placeholder `ticktune.net`, but every operative step uses `ticktune.com` (line 9 zone add, line 13 www redirect, line 33 custom domain attach, line 103 launch-checklist curl). README.md:7 states "All docs use `ticktune.net` as placeholder", so docs/10 is the only file out of sync. Fix is a 4-occurrence find-and-replace in one file. Severity: low — doc-only string inconsistency in a runbook whose domain is unpurchased (README open action item #1) and which docs/16-ROADMAP.md:17 schedules for rewrite at P7 anyway. The EULA portion of the original finding is dropped: legal/EULA.md is a self-declared non-lawyer draft slated for P6 (docs/16-ROADMAP.md:15), its unnamed "official domain" is a consequence of the same unpurchased-domain item rather than an independent defect, and the fork concern is inverted — leaving the domain unnamed is what keeps a redistributed copy from binding a fork's users to the upstream service.

**Recommendation.** Resolve open action item 1 (README §Open action items) and then do a single search-and-replace across docs/10 and README. In EULA.md §2 name the domain explicitly and add: "These terms apply only to the instance operated at <domain>; independently hosted copies of the GPL-licensed source are governed by their own operators' terms."

<details><summary>Evidence</summary>

```
README.md line 7: "**Domain (planned):** `ticktune.net` … All docs use `ticktune.net` as placeholder." docs/10-CLOUDFLARE-SETUP.md §intro: "the domain (placeholder `ticktune.net`) is registered"; §1.1: "Add site → `ticktune.com` → Free plan."; §1.3: "`www.ticktune.com/* → https://ticktune.com/$1`"; §11: "`https://ticktune.com` 200". legal/EULA.md §2: "This EULA governs your use of the hosted service at the official domain".
```

</details>

---

### ⚪ low · Minor stale references: Discord link, auto-theme YouTube behavior, perf-budget phase

**Owner phase:** P6 doc sweep · **Lens:** consistency

CONTRIBUTING.md:50 points readers to "the project Discord (link in README)", but no Discord URL exists anywhere in the suite — README.md has no Discord link or Community section (the only other mention is docs/07 §5, which cites Discord as an audience channel, not a URL). Fix by adding the URL to README or dropping the parenthetical. The other two sub-claims (03 §5 auto-theme, 13 §5 vs 16 P5 perf budget) are not defects.

**Recommendation.** (a) Add the Discord URL to README (or remove the pointer). (b) Reword 03 §5 to "In YouTube mode the dominant hue is derived from the `hqdefault` thumbnail instead of cover art; skipped only when neither exists." (c) Change P5's exit to "perf budget measured (formal pass in P7)" or move the budget check into P5 in 13 §5.

<details><summary>Evidence</summary>

```
CONTRIBUTING.md: "Discussions happen on GitHub Issues and the project Discord (link in README)." — README.md contains no Discord URL
docs/03-UI-SPEC.md §5: "Skipped when no cover art or in YouTube mode (thumbnail hue used instead)."
docs/13-TESTING.md §5: "## 5. Performance budget (checked in P7)" vs docs/16-ROADMAP.md P5 exit: "Reduced-motion + a11y milestones announced; perf budget met"
```

</details>

---

### ⚪ low · Privacy Policy names localStorage as a storage mechanism that the code standards ban

**Owner phase:** P6 legal pass · **Lens:** legal-compliance

Narrowed to a single-token accuracy fix: legal/PRIVACY-POLICY.md §2 line 19 says settings and gate acceptance "are stored locally via IndexedDB/localStorage", but every technical doc specifies Dexie (IndexedDB) only — 02-DATA-FLOW.md §3 persists language, theme, playback prefs, and legal-gate acceptance to the Dexie `ticktune` DB `settings` table, and 12-CODE-STANDARDS.md line 38 bans `localStorage` for structured data. Drop "/localStorage" from PRIVACY §2 so the legal disclosure matches the architecture. Drop the auditor's reset-promise argument: "'Reset app' in Settings clears all locally stored data" is a superset claim that clearing Dexie satisfies, so there is no live contradiction with 03-UI-SPEC.md §6 "reset app (clears Dexie)". Optional follow-on, not part of this finding: 12 §4 bans localStorage only for *structured* data, leaving scalar flags permitted while 03 §6 scopes reset to Dexie — if any scalar flag is ever introduced during implementation, the reset scope must be widened at that time.

**Recommendation.** Change PRIVACY §2 to "stored locally in your browser's IndexedDB", and make the reset routine explicitly clear both the Dexie database and any stray `localStorage`/`sessionStorage` keys so the "clears all locally stored data" promise holds regardless.

<details><summary>Evidence</summary>

```
legal/PRIVACY-POLICY.md §2: "stored locally via IndexedDB/localStorage on your device" and "'Reset app' in Settings clears all locally stored data." docs/12-CODE-STANDARDS.md line 38: "| `localStorage` for structured data | Dexie only (settings schema versioned) |". docs/03-UI-SPEC.md §6 General row: "reset app (clears Dexie)".
```

</details>

---

## Closed during P2 slice S1 (2026-07-21)

| Severity | Finding | Where it was closed |
|----------|---------|---------------------|
| 🟡 medium | The self-made chime ships as Opus, a codec the same doc flags as unreliable in Safari, with no fallback | docs/05 §7 rewritten — the chime is **synthesised at runtime** with two OscillatorNodes, so the asset, the codec question, the CC0 provenance note and `scripts/make-chime.ts` are all deleted rather than fixed. Failure is no longer silent: **TT-PLY-103** registered in docs/12 §6. Also removes a `scripts/guard-no-corpus.mjs` conflict nobody had noticed — the guard rejects any tracked audio outside `tests/e2e/fixtures/`, so shipping the asset would have required widening it |
| 🟠 high | 'Match queue length' button has no defined behavior although a component test asserts it | docs/03 §3 — formula `clamp(ceil(Σ durationMs / 1000)·1000, 1 s, 24 h)`, the disabled conditions (empty queue / any unknown duration / YouTube mode), and the one-shot rule |
| 🟠 high | Countdown input parsing, preset units, and out-of-range handling are unspecified | docs/03 §3 — presets stated as **minutes** (the narrowed finding's whole remit) |
| 🟡 medium | Import pipeline: directory handling and step ordering | docs/02 §4 step 0 — see the partially-resolved entry above; the progress-indicator half stays open against P3 |

## Closed during the 2026-07-21 bootstrap

| Severity | Finding | Where it was closed |
|----------|---------|---------------------|
| 🔴 blocker | No .gitignore exists anywhere — 651 MB test corpus and .idea/ are one `git add -A` from the first commit | .gitignore committed first (rooted /test/) + scripts/guard-no-corpus.mjs |
| 🔴 blocker | Doc suite lives in ticktune-docs/ but every internal reference and GitHub convention assumes repo root | suite moved to repo root; ticktune-docs/ removed |
| 🔴 blocker | Worker timer throttling is only validated with audio playing; the app has documented silent-but-running states where `done` can fire minutes late | docs/15 S2 extended: silent-hidden-tab, YouTube-mode, clock-jump cases + docs/04 §2 caveat |
| 🔴 blocker | The mobile gate's conditional bundle load is incompatible with `client:only`, making the stated E2E assertion unachievable | measured; hand-mount chosen — docs/01 §3, docs/07 §3, docs/13 §3, CLAUDE.md |
| 🔴 blocker | No TtSettings type, no Dexie schema/version, and most setting defaults & ranges are missing | docs/02 §3.1-3.2 TtSettings, TT_DEFAULT_SETTINGS, Dexie schema, upgrade policy |
| 🔴 blocker | `setup → ready` guard 'queue valid' is undefined, `ready` has no back edge, and the Start button's owner is ambiguous | docs/02 §1 — `ready` collapsed into a predicate; isQueueValid() defined |
| 🟠 high | Placeholder domain is `ticktune.net` in README/10-preamble but `ticktune.com` throughout the Cloudflare walkthrough | docs/10 — all four occurrences changed to ticktune.net |
| 🟠 high | Countdown display format for the 60 s – 1 h band is specified two different ways (03 §2 vs 04 §4) | docs/04 §4 named single source of truth; docs/03 §2 Z3 defers to it |
| 🟠 high | Zero build configuration exists; astro.config.mjs is never specified anywhere in the suite | astro.config.mjs written + normative block added to docs/01 §5 |
| 🟠 high | The inline-gate CSP hash is a build-time coupling that is neither specified precisely nor validated until six phases after the code it protects ships | docs/10 §7 normative contract incl. the exactly-one-hash assertion |
| 🟠 high | The drift re-anchor rule cannot distinguish an NTP/wall-clock jump from a throttling gap, and S2 never manipulates the clock | docs/04 §1 dual-clock skew rule; docs/04 §7 injects the two clocks separately |
| 🟠 high | Two UI affordances can hide the YouTube player, contradicting the non-negotiable ToS rule, and S1 does not test the player inside the real rail | docs/03 §2 YouTube visibility carve-out; §4 and §7 cross-reference it |
| 🟠 high | 'Restart', 'auto-restart' and 'loop countdown' are three named end behaviors with no definitions and no defaults | docs/02 §3.3 endAction stay/restart/loop, mutually exclusive |
| 🟠 high | 'Behavior when playlist ends early (silence / loop)' contradicts 'Repeat playlist' and has no default or precedence rule | docs/02 §3.3 — redundant control deleted; repeatPlaylist is the only knob |
| 🟠 high | YouTube `status:'pending'` has no defined recovery path; `status:'error'` is never assigned | docs/02 §1 status table — pending counts toward validity, error does not |
| 🟡 medium | 01 §4 target directory tree is incomplete — scaffolding from it verbatim omits paths other chapters require | docs/01 §4 tree made exhaustive |
| 🟡 medium | Crossfade scheduling is validated only against synthetic fixtures, but `element.duration` is unreliable on exactly the real-world files the app targets | docs/15 S4 now requires real VBR MP3s from the test/ corpus |
| 🟡 medium | Focus mode contradicts the YouTube always-visible rule, and its interaction with Z7 auto-hide is undefined | docs/03 §2 carve-out + §4 Focus keeps the player visible |
| ⚪ low | No SECURITY.md or vulnerability-disclosure path for a public GPL repo with a live deployment | .github/SECURITY.md + docs/09 §7 (GitHub Private Vulnerability Reporting) |
| ⚪ low | Ordering hazard: the entire doc suite is staged but uncommitted, so nothing is protected before the ignore rules land | .gitignore was the very first commit, ahead of the suite |
| ⚪ low | Adaptive scrim vs manual 'scrim strength' setting has no precedence rule; visualizer sensitivity has no scale | docs/02 §3.1 scrimAuto precedence + visualizerSensitivity range |
| ⚪ low | No vulnerability-disclosure policy or private security contact; EULA routes everything to public issues | .github/SECURITY.md + docs/09 §7 |
