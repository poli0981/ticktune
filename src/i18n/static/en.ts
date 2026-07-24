/**
 * Static-page strings — docs/08 §1, the EN reference dictionary.
 *
 * ## Why this is `.ts` and not `.json`
 *
 * The app island's runtime dictionaries are JSON because i18next wants them
 * that way, and their key parity is guarded by a **test**
 * (`tests/unit/tt-i18n-keys.test.ts`). These are consumed by `.astro`
 * frontmatter at build time instead, so parity can be enforced one level
 * earlier: `vi.ts` is annotated `const vi: StaticDict`, which makes a missing
 * key, an extra key or a mis-nested one a **type error** under `pnpm check` —
 * in both directions, with no test required.
 *
 * EN is the reference by construction, exactly as `TtKey` makes it for the
 * island (`src/app/state/i18n.svelte.ts`). Add a key here first.
 *
 * Two mechanisms, two surfaces, deliberately not merged: this one never reaches
 * the browser as data — it is inlined into static HTML at build time.
 */

/*
 * Deliberately NOT `as const`.
 *
 * `as const` would make every value a string *literal* type, so
 * `const vi: StaticDict` would then require the Vietnamese text to be
 * byte-identical to the English — i.e. it would forbid translating, which is
 * the opposite of the point. Widening to `string` is what lets the annotation
 * check the SHAPE (keys, nesting, array element shape) while leaving the text
 * free. Array *lengths* are not expressible either way; the value-level test
 * covers that, the same division of labour the island's dictionaries use.
 */
export const en = {
  common: {
    /** The wordmark is a proper noun; it is never translated. */
    openApp: 'Open TickTune →',
    backHome: '← Back to home',
    sourceOffer: 'Source code — GPL-3.0',
    /** docs/08 §1: the language switch on the statics is a route, not a toggle. */
    switchTo: 'Tiếng Việt',
    switchToLabel: 'Chuyển sang tiếng Việt',
  },

  landing: {
    title: 'TickTune — a full-screen countdown with your own music',
    description:
      'A full-screen countdown behind your own music. Everything runs in your browser — no file ever leaves your machine.',
    heroHeadline: 'Your countdown. Your music. Your machine.',
    heroSub:
      'A large seven-segment countdown, your own audio behind it, and nothing uploaded anywhere.',
    heroMediaAlt: 'TickTune running a countdown with a visualizer behind it',
    /** docs/16 standing rule: placeholder media is labelled as such until P7. */
    heroPlaceholderNote: 'Placeholder capture — the real demo lands before v1.0.',

    featuresTitle: 'What it does',
    features: [
      {
        title: 'Runs entirely in your browser',
        body: 'Your files are read in memory for the session and never uploaded. There is no account and no server to send anything to.',
      },
      {
        title: 'Built to be looked at',
        body: 'A glowing seven-segment clock on a dark stage, with backgrounds, a visualizer and a tally light that keeps the beat.',
      },
      {
        title: 'Yours to keep',
        body: 'GPL-3.0, source in the open, no telemetry and no analytics. What you see is the whole thing.',
      },
    ],

    modesTitle: 'Three ways to play',
    modes: [
      {
        name: 'Single',
        body: 'One track, looped behind the countdown. The simplest way to start.',
      },
      {
        name: 'Playlist',
        body: 'A queue you can reorder by dragging or with Alt+↑/↓, with shuffle and repeat.',
      },
      {
        name: 'YouTube',
        body: 'Paste links and they play in YouTube’s own embedded player, which stays visible as their terms require.',
      },
    ],
    /** docs/06 §5 — a queue is all-local or all-links, never mixed. */
    modesNote: 'A queue is either all local files or all links — the two do not mix.',

    limitsTitle: 'Limits',
    limitsNote: 'Chosen so a session stays responsive, and enforced as you import.',
    limitsHead: { what: 'What', limit: 'Limit' },
    /** docs/02 §1 — these are the numbers the importer actually enforces. */
    limits: [
      { what: 'Single mode', limit: 'one file, up to 10:02' },
      { what: 'Playlist files', limit: 'up to 95 files' },
      { what: 'Playlist per file', limit: 'up to 10:02 each' },
      { what: 'Playlist total', limit: 'up to 91:00' },
      { what: 'YouTube links', limit: 'up to 50 (no duration cap)' },
      { what: 'Countdown', limit: '1 second to 24 hours' },
    ],

    faqTitle: 'Questions',
    legalTitle: 'The legal bits',
    legalNote: 'English is the canonical version of each document.',
  },

  faq: [
    {
      /**
       * docs/04 §2 item 6 — the one S2-decision deliverable that lives outside
       * the app. The re-scoped promise must be stated plainly HERE, where people
       * decide whether to trust it, rather than buried in the EULA.
       */
      q: 'Is the countdown accurate if I switch to another tab?',
      a: 'The countdown is accurate while the tab is visible. While it is in the background it is best-effort: the elapsed time is always computed correctly, but the browser may not let the app react until you come back. If it finishes while you are away, the Finished screen tells you when zero was actually reached rather than pretending it just happened.',
    },
    {
      q: 'Do my files get uploaded anywhere?',
      a: 'No. Local files are read inside your browser and held in memory for the session only. There is no upload endpoint, no analytics and no telemetry. Closing or reloading the tab clears the queue — the app warns you first.',
    },
    {
      q: 'Why does it not work on my phone?',
      a: 'TickTune is desktop-only by design. The layout is built around a large countdown with a side rail, and the audio and file handling assume a desktop browser. Phones and touch-only tablets see a short notice instead.',
    },
    {
      q: 'What happens with YouTube links?',
      a: 'They play in YouTube’s official embedded player, which stays visible at all times because their terms require it. TickTune never downloads, extracts or re-streams audio or video, and it cannot read the audio of a YouTube video — so the visualizer is unavailable in that mode.',
    },
    {
      q: 'Is anything stored on my machine?',
      a: 'Only your settings — language, background, countdown and playback preferences — plus the record that you accepted the terms. Your files, your queue and your links are never stored.',
    },
    {
      q: 'Is it really free?',
      a: 'Yes, and it is free software: GPL-3.0-only, with the source published. You can read it, run it, change it and share it under the same licence.',
    },
  ],

  notFound: {
    title: '404 — Channel not found · TickTune',
    heading: 'Channel not found',
    body: 'That page is not on this frequency.',
  },

  legal: {
    /** Rendered above every legal document body. */
    canonicalEn: 'This English text is the canonical version of this document.',
    canonicalVi:
      'This is a translation provided for convenience. The English version is canonical for interpretation.',
    versionLabel: 'Version',
    docs: {
      eula: 'Terms of Use',
      disclaimer: 'Disclaimer',
      privacy: 'Privacy Policy',
      thirdParty: 'Third-Party Notices',
    },
  },
};

/**
 * The shape every language must satisfy.
 *
 * `vi.ts` annotates against this, so drift is a compile error rather than a
 * runtime fallback — the guarantee the island's JSON dictionaries need a test
 * to reach.
 */
export type StaticDict = typeof en;
