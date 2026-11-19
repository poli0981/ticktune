# Maintenance

**Status: maintenance mode, since v2.3.0 (2026-11).**

TickTune does what it set out to do: a full-screen countdown with your own
music — local files or YouTube links — in a desktop browser, with your files
never leaving it. From here the project is **maintained, not extended**. That
is not abandonment: keeping the site correct, safe and current matters more
than adding to it.

This file is the policy. The reasoning behind it, and what was left in the
backlog and why, is in [`docs/16-ROADMAP.md`](docs/16-ROADMAP.md).

## What is still done

1. **Dependencies, on a schedule.** Dependabot proposes updates weekly, for
   npm and for the GitHub Actions the workflows use, after a cooldown — three
   days for a minor or a patch, seven for a major. Each is merged after CI, and
   a major only after the written check
   [`docs/11 §5`](docs/11-DEPENDENCIES.md) asks for.
2. **Security, urgently.** An advisory rated **high or critical** against what
   ships — or a serious security problem in the toolchain itself: Node.js, the
   Workers runtime, Wrangler — is fixed as soon as a fixed version exists.
   While none exists, `docs/11 §5` records the advisory and why it cannot
   reach a user. To report a vulnerability, follow
   [`SECURITY.md`](.github/SECURITY.md).
3. **Major upgrades of the platform.** A new major of the language, runtime or
   framework — Node.js 26 → 28, TypeScript 6 → 7, a major of Astro or Svelte —
   is adopted on purpose, in its own pull request, with the docs updated first.
4. **Defects.** Bugs, UI/UX defects and accessibility barriers
   ([`ACCESSIBILITY.md`](ACCESSIBILITY.md)), through the issue forms.
5. **Language.** Vietnamese, English or Japanese wording that is wrong for the
   language, or for a region's culture or usage, and spelling mistakes that
   could mislead someone. The translation form is the way in.
6. **Necessary changes.** A change that is genuinely needed — to fix a defect,
   to remove a barrier, to keep YouTube playback working inside YouTube's
   terms when YouTube changes, or to keep the site working in a desktop
   browser it supports — can still land, and so can an item from the backlog
   in `docs/16` that is one of those.

## What is not

**New features.** Requests for them are closed automatically, by
[`.github/workflows/triage.yml`](.github/workflows/triage.yml):

- An issue opened with the **Suggest a feature** form whose first answer is
  "Something new — not in the backlog" is labelled `maintenance-mode`, gets a
  comment that links here, and is closed as *not planned*. The form's other two
  answers — in the backlog, or needed for a fix — keep the issue open, labelled
  `needs-triage`, for the maintainer to read.
- A pull request from outside the project whose title starts with `feat`
  (Conventional Commits) is labelled and closed the same way. Open an issue
  first.
- The maintainer can label any issue `enhancement` to close it the same way.

Nothing is deleted. Every closed request is read, and one that fits this
policy is reopened and labelled `roadmap`, which the automation leaves alone.

**Ideas** are welcome in
[Discussions › Ideas](https://github.com/poli0981/ticktune/discussions/categories/ideas),
where they can be talked through without an issue that has to be accepted or
refused.

Out of scope permanently, maintenance mode or not — the hard invariants in
[`CLAUDE.md`](CLAUDE.md): uploading your files anywhere, hiding the YouTube
player or extracting its audio, a mobile layout, tracking beyond the one
disclosed page-view beacon, and animation libraries whose licence conflicts
with the GPL.

## Releases

A **patch** ships when there is something to fix: a defect, an accessibility
barrier, a batch of language fixes, or a security problem that reaches what
ships. (An advisory against the build tools is fixed in the repository and
needs no release unless it changed what the site serves.) A **minor** carries
a necessary change of the kind above. There is no fixed schedule.

The site updates itself: a fix reaches you the next time you open TickTune.
The offline copy of `/app/` refreshes on the visit after a release.

## Supported versions

The version live at [ticktune.net](https://ticktune.net). See
[`SECURITY.md`](.github/SECURITY.md).

## Changing this policy

Through a pull request like any other, recorded in `docs/16` and announced in
[Discussions › Announcements](https://github.com/poli0981/ticktune/discussions/categories/announcements).
