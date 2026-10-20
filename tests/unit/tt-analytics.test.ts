import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The analytics beacon, the CSP and the Privacy Policy move together — or the
 * site breaks or lies.
 *
 * - Beacon without the CSP origins: blocked in production only (dev and
 *   `astro preview` send no CSP), so nothing in the browser suites would notice.
 * - CSP origins without the beacon: a dead allowance that widens the policy.
 * - Either without the policy saying so: a data flow users never agreed to,
 *   the exact defect `TT_LEGAL_VERSION`'s history keeps re-learning.
 */

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const base = read('src', 'layouts', 'TtBase.astro');
const headers = read('public', '_headers');

const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? '';
const directive = (name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? [];

describe('Cloudflare Web Analytics — beacon, CSP and policy agree', () => {
  it('TtBase loads the beacon as an external module with the site token', () => {
    expect(base).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
    expect(base).toMatch(/data-cf-beacon='\{"token": "[0-9a-f]{32}"\}'/);
    // `is:inline` keeps Astro from bundling or rewriting the tag.
    expect(base).toMatch(
      /<script\s+is:inline\s+type="module"\s+src="https:\/\/static\.cloudflareinsights/,
    );
  });

  it('only the spike harnesses opt out, and every one of them does', () => {
    // They run on localhost in browsers `pnpm s4b|s5|s6` launch for real,
    // where _fixtures.ts cannot fulfil the beacon: a harness run is not a visit.
    const astroUnder = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.astro'))
        .map((f) => join(dir, f));
    const spikes = astroUnder('src/spike/pages');
    expect(spikes.length).toBeGreaterThan(0);
    for (const f of spikes) expect(read(f), f).toContain('analytics={false}');
    for (const f of [...astroUnder('src/pages'), ...astroUnder('src/components')])
      expect(read(f), f).not.toContain('analytics={false}');
  });

  it('the CSP allows exactly the two beacon origins it needs', () => {
    expect(directive('script-src')).toContain('https://static.cloudflareinsights.com');
    expect(directive('connect-src')).toContain('https://cloudflareinsights.com');
    // …and no wildcard sneaked in alongside them.
    expect(csp).not.toMatch(/\*\.cloudflareinsights\.com/);
  });

  it('both Privacy Policies disclose it', () => {
    for (const file of [
      ['legal', 'PRIVACY-POLICY.md'],
      ['legal', 'vi', 'PRIVACY-POLICY.md'],
    ]) {
      const policy = read(...file);
      expect(policy).toContain('Cloudflare Web Analytics');
      expect(policy).toContain('static.cloudflareinsights.com');
    }
  });
});
