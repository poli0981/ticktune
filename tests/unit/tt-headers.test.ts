import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `public/_headers` — the security headers and the CSP, as they ship.
 *
 * Until v1.1 **no test read this file**. The build checked one thing about it
 * (the gate-hash placeholder, `scripts/inject-csp-hash.ts`) and the rest was
 * verified by hand on the live site — which is how a doubled `Cache-Control`
 * made every hashed bundle uncacheable for a release (see the note at the top
 * of the file), and how `docs/09 §4`, which calls itself the authoritative CSP,
 * could drift from the policy actually served without anything noticing.
 *
 * This reads the source file, not `dist/`, so it runs without a build.
 */

const HEADERS = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
const SECURITY_DOC = readFileSync(join(process.cwd(), 'docs', '09-SECURITY.md'), 'utf8');

/** `_headers` → path pattern → header name (lower-case) → value. */
function parseRules(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = new Map();
      rules.set(raw.trim(), current);
      continue;
    }
    const at = raw.indexOf(':');
    if (current && at > 0)
      current.set(raw.slice(0, at).trim().toLowerCase(), raw.slice(at + 1).trim());
  }
  return rules;
}

/** `a b; c d` → directive → its sources, in order. */
function parseCsp(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) out.set(name, sources);
  }
  return out;
}

const rules = parseRules(HEADERS);
const all = rules.get('/*');
const csp = parseCsp(all?.get('content-security-policy') ?? '');

describe('public/_headers — docs/09 §2 and §4', () => {
  it('has the site-wide rule, both immutable cache rules and the service worker', () => {
    expect([...rules.keys()]).toEqual(['/*', '/_astro/*', '/fonts/*', '/sw.js']);
  });

  it('revalidates the service worker on every check — docs/10 §9', () => {
    expect(rules.get('/sw.js')?.get('cache-control')).toBe('no-cache');
  });

  it('sends the full security header set on every path', () => {
    expect(all?.get('x-content-type-options')).toBe('nosniff');
    expect(all?.get('referrer-policy')).toBe('no-referrer');
    expect(all?.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(all?.get('x-frame-options')).toBe('DENY');
    expect(all?.get('permissions-policy')).toContain('camera=()');
    expect(all?.get('permissions-policy')).toContain('microphone=()');
  });

  it('puts NO Cache-Control on `/*`, because Cloudflare appends rather than overrides', () => {
    // `/*` + `/_astro/*` once emitted "max-age=0, must-revalidate, …, max-age=31536000,
    // immutable" — two max-ages in one header, the first one winning.
    expect(all?.has('cache-control')).toBe(false);
    for (const path of ['/_astro/*', '/fonts/*']) {
      expect(rules.get(path)?.get('cache-control')).toBe('public, max-age=31536000, immutable');
    }
  });

  it('templates exactly one gate hash into script-src, and nowhere else', () => {
    // Ignoring `#` comment lines — the file's own header mentions the token.
    const live = HEADERS.split('\n').filter((l) => !l.trimStart().startsWith('#'));
    expect(live.join('\n').match(/<TT_GATE_HASH>/g)).toHaveLength(1);
    expect(csp.get('script-src')).toContain("'sha256-<TT_GATE_HASH>'");
  });

  it('keeps the tight defaults the threat model depends on', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    // No `data:` for fonts — Vite inlining fonts as data: URLs once broke this
    // on the live site (astro.config.mjs `assetsInlineLimit`).
    expect(csp.get('font-src')).toEqual(["'self'"]);
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
    // Never a wildcard and never unsafe script sources.
    for (const [name, sources] of csp) {
      expect(sources, name).not.toContain('*');
      if (name === 'script-src') {
        expect(sources).not.toContain("'unsafe-inline'");
        expect(sources).not.toContain("'unsafe-eval'");
      }
    }
  });

  it('reads blob: pictures as IMAGES, never as connections — docs/09 §4, v2.0.1', () => {
    /*
     * The samplers fetched blob: URLs and `connect-src` refused every one from
     * v0.7.0 to v2.0.0. The fix decodes through `<img>`; widening
     * `connect-src` instead would have let any script read any blob as data.
     * This pins that it was not the fix taken.
     */
    expect(csp.get('img-src')).toContain('blob:');
    expect(csp.get('connect-src')).not.toContain('blob:');
  });

  it('matches docs/09 §4, which calls itself the authoritative policy', () => {
    const block = /## 4\. Content-Security-Policy[\s\S]*?```\n([\s\S]*?)```/.exec(
      SECURITY_DOC,
    )?.[1];
    expect(block, 'docs/09 §4 has no fenced CSP block').toBeTruthy();
    const documented = parseCsp((block ?? '').replace(/\n/g, ' '));
    // The doc states the hash separately (it is computed at build time), so it
    // is the one source the served policy may have that the doc does not.
    const served = new Map(
      [...csp].map(([k, v]) => [k, v.filter((s) => s !== "'sha256-<TT_GATE_HASH>'")]),
    );
    expect(Object.fromEntries(served)).toEqual(Object.fromEntries(documented));
  });
});
