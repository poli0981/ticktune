## What and why

<!-- What changes, and the problem it solves. Link the issue: "Closes #…". -->

## Checklist

The full list, with the reasons, is in [CONTRIBUTING.md](https://github.com/poli0981/ticktune/blob/main/CONTRIBUTING.md#pr-checklist-ci-enforces-most-of-these).
CI enforces most of it.

- [ ] `pnpm lint` · `pnpm check` · `pnpm test` · `pnpm knip` pass
- [ ] No hard invariant from `CLAUDE.md` is touched: files stay in the browser,
      the YouTube player stays visible, time is derived, limits hold, the mobile
      gate holds
- [ ] New strings exist in all three languages (`docs/08 §3`)
- [ ] New dependency, origin or legal text? Notices, CSP and Privacy Policy, or
      `TT_LEGAL_VERSION`, updated in this PR
- [ ] Behaviour changes are reflected in the relevant `docs/` chapter

## Accessibility (UI changes)

See [ACCESSIBILITY.md](https://github.com/poli0981/ticktune/blob/main/ACCESSIBILITY.md#contributor-expectations).
Tick what you checked; say why if something does not apply.

- [ ] Works with the keyboard alone; focus is visible and never lost
- [ ] Every new control has an accessible name in all three languages
- [ ] No information is carried by colour alone; contrast uses the design tokens
- [ ] Reduced motion respected; nothing that carries text fades in
- [ ] Checked under forced colours (DevTools → Rendering → `forced-colors: active`)
- [ ] One screen-reader spot check (Narrator, NVDA or VoiceOver) — name which
- [ ] A new screen or state is scanned in `tests/e2e/a11y.spec.ts`
- [ ] A barrier that cannot be fixed is listed under Known limitations in
      `ACCESSIBILITY.md`

## Screenshots

<!-- UI changes: before / after. A change to how a screen looks also updates its
visual baselines (`pnpm test:visual:docker --update`, docs/13 §3). -->
