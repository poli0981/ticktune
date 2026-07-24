# P6 slice B live checklist — the legal pages

Filtered to what slice B ships: the eight `/legal/*` routes in both languages,
the Vietnamese translations of all four documents, and the in-app links moving
off GitHub and onto the site.

Run on a **desktop** browser against the **live deployment, before the merge** —
the ritual v0.6.0 corrected. (Cloudflare deploys this branch to `ticktune.net`
on push, so "the deployment" and "production" are the same thing here; see
`docs/14`.)

🔴 **The single most important item in this file is not a checkbox — it is
reading the Vietnamese.** These are legal documents. Every route, link, version
string and cross-link below is already asserted by
`tests/e2e/legal.spec.ts` and `tests/unit/tt-legal-parity.test.ts`, and all of
them pass. **No test can tell you whether the Vietnamese says what the English
says.** That is the entire reason this checklist exists. If a sentence is
awkward, wrong, or means something different from the English, say so — the
English is canonical, so a translation that drifts is a defect in the document,
not a wording preference.

## Blocking — read the translations

Open each and read it as a Vietnamese user would. The English is at the same
path under `/en/`, so you can compare side by side.

- [x] **`/legal/eula`** — Điều khoản sử dụng. Check §2 (giấy phép GPL-3.0),
      §6 (không bảo đảm / giới hạn trách nhiệm). These two carry the most legal
      weight; the rest is description.
- [x] **`/legal/disclaimer`** — Tuyên bố miễn trừ trách nhiệm. Six numbered
      points; check point 1 (nội dung do người dùng cung cấp) and point 6
      (`"AS IS"`, giữ nguyên tiếng Anh và có chú giải).
- [x] **`/legal/privacy`** — Chính sách quyền riêng tư. Check §1's list of what
      the app does *not* do, and §4's description of YouTube and Cloudflare.
- [x] **`/legal/third-party`** — Thông báo về thành phần của bên thứ ba. The
      component and licence columns are **deliberately untranslated**
      (`docs/08 §3.1`) — only the Notes column is Vietnamese. That is intended,
      not an oversight.

- [x] **Nothing reads like machine translation.** Legal Vietnamese has settled
      phrasing; if a sentence reads like it was translated word-by-word from
      English, flag it.
- [x] **The `"AS IS"` term is left in English with a Vietnamese gloss**, in both
      the EULA and the Disclaimer. This is intentional — it is a term of art —
      but confirm the gloss reads correctly.

## Blocking — the pages themselves

- [x] **All four VI pages carry the banner** saying the English is canonical,
      and the four EN pages carry the one saying they *are* canonical. Both
      languages get a banner on purpose: one only on the translation would read
      as a disclaimer rather than as a statement of which text governs.
- [x] **`Phiên bản 1.0-draft` shows at the bottom** of every page, both
      languages. It must match what the Legal Gate stores.
- [x] **The EULA's two in-text links work and stay in your language** — from
      `/legal/eula`, "Tuyên bố miễn trừ trách nhiệm" and "Chính sách quyền riêng
      tư" must land on `/legal/*`, not `/en/legal/*`. From `/en/legal/eula` the
      reverse.
- [x] **The language switch round-trips** on a legal page and keeps you on the
      same document.
- [x] **`← Về trang chủ`** goes to `/`, and its English counterpart to `/en/`.
- [x] **The wide licence table on `/legal/third-party` scrolls inside its own
      box** and does not make the page scroll sideways.
- [x] 🔴 **No route answers a 307.** Every legal link must land directly, with no
      redirect hop. This one **cannot be checked by the test suite**: the site
      builds directory routes, so the deployed host redirects `/legal/eula` to
      `/legal/eula/` — while `astro preview`, which the E2E runs against, serves
      both with a plain 200. The harness is more permissive than production, so
      the shell below is the only place this is visible.

```bash
for p in eula disclaimer privacy third-party; do
  for pre in "" "/en"; do
    printf '%-28s %s\n' "$pre/legal/$p/" "$(curl -s -o /dev/null -w '%{http_code}' "https://ticktune.net$pre/legal/$p/")"
  done
done   # every line must read 200, never 307
```

## Blocking — the in-app links moved

This is the part with a real failure mode, so check both languages.

- [x] **Legal Gate** (first run, or after "Đặt lại ứng dụng"): the four links at
      the bottom open **on the site**, not on GitHub. They open in a new tab —
      that is deliberate, since leaving `/app/` destroys the session queue.
- [x] **⚙ → Chung → Pháp lý**: the three links open on-site.
- [x] **⚙ → Giới thiệu**: "Ghi chú bên thứ ba" opens on-site. **"Mã nguồn" must
      still go to GitHub** — that is the GPL-3.0 §6 source offer and is not a
      site route.
- [x] 🔴 **Switch the app to English (⚙ → Ngôn ngữ), then re-open those links.**
      They must now go to `/en/legal/*`. This is the defect the whole slice was
      designed around: reading the constant directly gives four links that all
      work and are all the wrong language.
- [x] **The landing footer**, on `/` and again on `/en/` — same check, four
      links each.

## Non-blocking

- [x] **Lighthouse ≥ 95 on one legal page** — desktop, all four categories.
      Slice A's exit is already met; this is a spot-check that a new page type
      did not regress it. ⚠️ If Best Practices is short, read the console before
      assuming fonts: slice A's 92 had two different causes and the second was a
      Cloudflare-injected script, not ours.
- [x] Real Firefox: one legal page in each language.
- [x] The prose is comfortable to read at a normal window width.

## Known-absent — do not report

| Missing | Why |
|---------|-----|
| A lawyer's review | These are developer-written drafts and say so. Version stays `1.0-draft`; promoting to `1.0` is a P7 launch decision |
| A legal page in the sitemap | Deliberate — the sitemap filter keeps them out; they are linked, not landing pages |
| A language-correct 404 under `/en/*` | Cloudflare serves one 404 file site-wide (`docs/07`); unchanged from slice A |
| A re-prompt of the Legal Gate | `TT_LEGAL_VERSION` is unchanged on purpose. Publishing a translation of an unchanged document changes nobody's rights, and re-prompting every user over it would be the larger harm |
| A real demo video in the hero | **P7** |
| An axe scan / a bundle-size number | **P7** (`13 §5`, `13 §6`) |

## Production re-check — after the tag deploys to `ticktune.net`

- [x] `ticktune.net/app/` → ⚙ → Giới thiệu reads **0.10.0**. The line that
      proves the *tag* deployed rather than the branch push that preceded it.
- [x] All eight `/legal/*` routes return 200 on the custom domain.
- [x] Headers unchanged (`10 §11`), and still exactly one inline script whose
      hash equals the `script-src` hash.

```bash
for p in eula disclaimer privacy third-party; do
  for pre in "" "/en"; do
    printf '%-28s %s\n' "$pre/legal/$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://ticktune.net$pre/legal/$p")"
  done
done
```
