/**
 * Run spike S5 — docs/15 §S5: does a notification created by a dedicated
 * worker at the deadline arrive on time while the tab is hidden and silent?
 *
 *   pnpm s5                                   Edge, Chrome, Brave, Firefox at once
 *   pnpm s5 --browsers msedge,chrome --runs 3 --minutes 5
 *
 * Every browser is launched the way a user runs it: a plain process on a fresh
 * profile, nothing attached to its pages. Under Playwright every page reported
 * 'visible' — a background tab, a minimised window and a persistent context
 * alike (measured on Edge 155) — so a hidden run is only honest in a browser
 * nobody drives. The Chromium family gets --remote-debugging-port, used ONLY at
 * the browser level: grant notifications, open tabs (/json/new), close. Firefox
 * gets a user.js that allows notifications, and its tabs on the command line.
 *
 * Per browser: `--runs` tabs (10) of `--minutes` (25), plus a VISIBLE 30 s
 * control in the front tab, so the runs are background tabs. A control the OS
 * hid anyway — its window covered by another — is inconclusive, not a pass.
 *
 * The harness starts itself from its query (`?auto=&label=&collect=1`), and its
 * worker and page POST every record patch to /__s5 on this script's own static
 * server for dist-spikes/: same origin, so there is nothing new to allow. The
 * script ends once every run has fired (plus time for `show`), or at
 * minutes + 3. Spike pages carry no analytics beacon (TtBase `analytics`).
 *
 * Real OS notifications appear while this runs. Paths are this Windows dev
 * box's install locations. Results go to test/s5-results/ (git-ignored).
 */
import { build } from 'astro';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const browsers = opt('browsers', 'msedge,chrome,brave,firefox').split(',');
const minutes = Number(opt('minutes', '25'));
const runs = Number(opt('runs', '10'));
const PORT = Number(opt('port', '4332'));
// 127.0.0.1, not `localhost`: one address for the server and every browser,
// and still a secure context, which notifications require.
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ROOT = resolve('dist-spikes');
const OUT = 'test/s5-results';
const CONTROL_MIN = 0.5;

// Absolute, like the browsers below: nothing here is looked up on PATH.
const TASKKILL = String.raw`C:\Windows\System32\taskkill.exe`;
const POWERSHELL = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;

const EXE: Record<string, string> = {
  msedge: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  chrome: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  brave: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  firefox: 'C:/Program Files/Mozilla Firefox/firefox.exe',
};
for (const b of browsers)
  if (!EXE[b] || !existsSync(EXE[b])) {
    console.error(`✖ ${b}: not installed at ${EXE[b] ?? '(unknown browser)'}`);
    process.exit(1);
  }

interface Rec {
  runId: string;
  label?: string;
  ua?: string;
  minutes?: number;
  endAtEpoch?: number;
  startedAt?: number;
  firedAt?: number;
  lateMs?: number;
  hiddenAtFire?: boolean;
  notified?: boolean;
  shownAt?: number;
  shownLateMs?: number;
  error?: string;
  ticks?: number;
  maxTickGapMs?: number;
  ticksOver1s?: number;
  workerHasNotification?: boolean;
  permission?: string;
  pageSawFireAt?: number;
  visibility?: Array<[number, boolean]>;
}

// ── static server for dist-spikes/ + the /__s5 collector ─────────────────────

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const records = new Map<string, Rec>();
const byLabel = (label: string) => [...records.values()].find((r) => r.label === label);

function onPatch(runId: string, patch: Partial<Rec>): void {
  const r = records.get(runId);
  if (patch.firedAt !== undefined && r)
    console.log(
      `  ${r.label ?? runId}: fired ${r.lateMs} ms late, hidden ${r.hiddenAtFire}, notified ${r.notified}${r.error ? `, ${r.error}` : ''}`,
    );
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  if (req.method === 'POST' && url.pathname === '/__s5') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      try {
        const { runId, patch } = JSON.parse(body) as { runId: string; patch: Partial<Rec> };
        records.set(runId, { ...records.get(runId), ...patch, runId });
        onPatch(runId, patch);
      } catch {
        // A malformed post is a harness bug; it shows as a missing field.
      }
      res.writeHead(204).end();
    });
    return;
  }
  const file = SERVED.get(url.pathname);
  if (file === undefined) return void res.writeHead(404).end();
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
});

/**
 * Every servable file, keyed by its URL path, indexed once the build is done.
 * A request never reaches the filesystem: a path missing from this map does
 * not exist, so there is nothing to traverse and nothing to probe.
 */
const SERVED = new Map<string, string>();
function indexServed(dir: string): void {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      indexServed(file);
      continue;
    }
    const path = `/${relative(ROOT, file).split(sep).join('/')}`;
    SERVED.set(path, file);
    if (name === 'index.html') SERVED.set(path.slice(0, -'index.html'.length), file);
  }
}

// ── browsers ─────────────────────────────────────────────────────────────────

interface Launched {
  name: string;
  proc: ChildProcess;
  profile: string;
  close: () => Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, '0');
const harness = (name: string, label: string, m: number) =>
  `${ORIGIN}/spike/s5-notify/?auto=${m}&label=${encodeURIComponent(`${name}/${label}`)}&collect=1`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Windows of 1200×680 in a 2×2 grid: ≥ 1024 px wide so TtBase's gate lets the
// harness mount, and overlapping nowhere, so no front tab is covered by
// another browser's window.
const slot = (i: number) => ({ x: (i % 2) * 1260, y: Math.floor(i / 2) * 700, w: 1200, h: 680 });

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    execFileSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
}

/**
 * Stop whatever still runs on this profile — and nothing else: the match is the
 * temp profile's unique name, so the owner's own browser windows are untouched.
 * Firefox's launcher process used to hand over to the real browser and exit,
 * which left the browser running past `killTree` (measured).
 */
function killByProfile(profile: string): void {
  try {
    execFileSync(
      POWERSHELL,
      [
        '-NoProfile',
        '-Command',
        // $PID: this PowerShell's own command line carries the name too.
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'ignore' },
    );
  } catch {
    // Nothing left to stop.
  }
}

async function exited(proc: ChildProcess, ms: number): Promise<void> {
  if (proc.exitCode !== null) return;
  await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(ms)]);
}

/** A browser-level CDP session — the only kind this script opens. */
async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  ws.onmessage = (e: MessageEvent) => {
    const m = JSON.parse(String(e.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
    };
    if (typeof m.id !== 'number') return;
    const settle = pending.get(m.id);
    if (typeof settle !== 'function') return;
    pending.delete(m.id);
    settle(m);
  };
  return {
    send: (method: string, params: object = {}) =>
      new Promise<unknown>((ok, fail) => {
        const n = ++id;
        pending.set(n, (m) => (m.error ? fail(new Error(m.error.message)) : ok(m.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function launchChromium(name: string, i: number): Promise<Launched> {
  const profile = mkdtempSync(join(tmpdir(), `tt-s5-${name}-`));
  const { x, y, w, h } = slot(i);
  const proc = spawn(
    EXE[name]!,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-position=${x},${y}`,
      `--window-size=${w},${h}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let t = 0; !existsSync(portFile); t += 200) {
    if (t > 30_000) throw new Error(`${name}: no DevToolsActivePort after 30 s`);
    await sleep(200);
  }
  await sleep(200);
  const devtools = `http://127.0.0.1:${readFileSync(portFile, 'utf8').split('\n')[0]}`;
  const version = (await (await fetch(`${devtools}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const session = await cdp(version.webSocketDebuggerUrl);
  await session.send('Browser.grantPermissions', {
    origin: ORIGIN,
    permissions: ['notifications'],
  });
  // /json/new opens each tab in the FOREGROUND: the runs first, the control
  // last, so the control is the front tab and every run a background one.
  const open = (u: string) =>
    fetch(`${devtools}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' });
  for (let r = 1; r <= runs; r++) await open(harness(name, `run-${pad(r)}`, minutes));
  await open(harness(name, 'control', CONTROL_MIN));
  return {
    name,
    proc,
    profile,
    close: async () => {
      await session.send('Browser.close').catch(() => {});
      session.close();
      await exited(proc, 10_000);
      killTree(proc.pid);
    },
  };
}

function launchFirefox(i: number): Launched {
  const profile = mkdtempSync(join(tmpdir(), 'tt-s5-firefox-'));
  writeFileSync(
    join(profile, 'user.js'),
    [
      // 1 = allow: the harness cannot ask, nobody is there to answer.
      ['permissions.default.desktop-notification', 1],
      // First-run and default-browser chrome only — nothing that touches timers.
      ['browser.shell.checkDefaultBrowser', false],
      ['browser.aboutwelcome.enabled', false],
      ['browser.startup.homepage_override.mstone', '"ignore"'],
      ['datareporting.policy.dataSubmissionPolicyBypassNotification', true],
      ['toolkit.telemetry.reportingpolicy.firstRun', false],
      ['browser.sessionstore.resume_from_crash', false],
      ['browser.tabs.warnOnClose', false],
    ]
      .map(([k, v]) => `user_pref("${k}", ${v});`)
      .join('\n') + '\n',
  );
  const { x, y, w, h } = slot(i);
  writeFileSync(
    join(profile, 'xulstore.json'),
    JSON.stringify({
      'chrome://browser/content/browser.xhtml': {
        'main-window': {
          screenX: String(x),
          screenY: String(y),
          width: String(w),
          height: String(h),
          sizemode: 'normal',
        },
      },
    }),
  );
  // Command-line URLs open as tabs with the FIRST selected: the control first.
  const urls = [
    harness('firefox', 'control', CONTROL_MIN),
    ...Array.from({ length: runs }, (_, r) => harness('firefox', `run-${pad(r + 1)}`, minutes)),
  ];
  // -wait-for-browser: Firefox's launcher process otherwise exits at once,
  // leaving no process here that owns the browser.
  const proc = spawn(
    EXE['firefox']!,
    ['-profile', profile, '-no-remote', '-new-instance', '-wait-for-browser', ...urls],
    { stdio: 'ignore' },
  );
  return { name: 'firefox', proc, profile, close: async () => killTree(proc.pid) };
}

// ── run ──────────────────────────────────────────────────────────────────────

if (!args.includes('--no-build')) {
  process.env['TT_SPIKES'] = '1';
  await build({ root: process.cwd(), logLevel: 'warn' });
}
indexServed(ROOT);
await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', ok));

const launched: Launched[] = [];
const started = new Date();
async function shutdown(): Promise<void> {
  for (const l of launched) await l.close();
  await sleep(1000);
  for (const l of launched) {
    killByProfile(l.profile);
    try {
      rmSync(l.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (e) {
      console.warn(`⚠ could not remove ${l.profile}: ${(e as Error).message}`);
    }
  }
  server.close();
}
process.once('SIGINT', () => void shutdown().then(() => process.exit(130)));

try {
  for (const [i, name] of browsers.entries()) {
    launched.push(name === 'firefox' ? launchFirefox(i) : await launchChromium(name, i));
    console.log(
      `${name}: ${runs} × ${minutes} min in background tabs + a ${CONTROL_MIN * 60} s control in front`,
    );
  }

  const expected = browsers.flatMap((b) => [
    ...Array.from({ length: runs }, (_, r) => `${b}/run-${pad(r + 1)}`),
    `${b}/control`,
  ]);
  for (let t = 0; t < 60_000 && !expected.every((l) => byLabel(l)); t += 1000) await sleep(1000);
  const missing = expected.filter((l) => !byLabel(l));
  if (missing.length) console.log(`⚠ never started: ${missing.join(', ')}`);

  const deadline = Date.now() + (minutes + 3) * 60_000;
  console.log(
    `waiting for ${minutes} min runs (at most until ${new Date(deadline).toLocaleTimeString()})…`,
  );
  while (Date.now() < deadline) {
    if (expected.every((l) => byLabel(l)?.firedAt !== undefined)) {
      await sleep(20_000); // `show` and the page's own patches trail the fire
      break;
    }
    await sleep(5000);
  }

  // ── judge, per browser ──────────────────────────────────────────────────────
  mkdirSync(OUT, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, '-');
  const summary: string[] = [];
  let allGo = true;
  for (const b of browsers) {
    const rs = Array.from({ length: runs }, (_, r) => {
      const label = `${b}/run-${pad(r + 1)}`;
      return byLabel(label) ?? { runId: '–', label, error: 'never started' };
    });
    const ctl = byLabel(`${b}/control`);
    const good = rs.filter(
      (r) => r.hiddenAtFire && r.notified && (r.lateMs ?? 1e9) <= 2000 && !r.error,
    );
    // Visible at zero must never notify — runs or control alike.
    const leaked = [...rs, ...(ctl ? [ctl] : [])].filter(
      (r) => r.hiddenAtFire === false && r.notified,
    );
    const control =
      !ctl || ctl.firedAt === undefined
        ? 'missing'
        : ctl.hiddenAtFire
          ? 'inconclusive (the OS hid its window)'
          : ctl.notified
            ? 'FAIL (notified while visible)'
            : 'pass (visible, did not notify)';
    const need = Math.ceil(runs * 0.9);
    const go = good.length >= need && leaked.length === 0;
    allGo &&= go;
    const ua = rs.find((r) => r.ua)?.ua ?? ctl?.ua ?? '?';
    const lines = [
      `# S5 — ${b}, ${runs} × ${minutes} min hidden + ${CONTROL_MIN * 60} s visible control — ${go ? 'GO' : 'NO-GO'}`,
      '',
      `${ua}  `,
      `started ${started.toISOString()}, undriven browser, fresh profile`,
      '',
      '| run | hidden at zero | worker late (ms) | shown late (ms) | page late (ms) | max tick gap (ms) | ticks > 1 s | notified | error |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rs.map(
        (r) =>
          `| ${r.label} | ${r.hiddenAtFire ?? '–'} | ${r.lateMs ?? '–'} | ${r.shownLateMs ?? '–'} | ${r.pageSawFireAt && r.endAtEpoch ? r.pageSawFireAt - r.endAtEpoch : '–'} | ${r.maxTickGapMs ?? '–'} | ${r.ticksOver1s ?? '–'} | ${r.notified ?? '–'} | ${r.error ?? (r.firedAt === undefined ? 'never fired' : '')} |`,
      ),
      '',
      `visible control: ${control}`,
      `on time (≤ 2 s), hidden and notified: ${good.length}/${runs} — GO needs ≥ ${need}; notified while visible: ${leaked.length}`,
    ];
    writeFileSync(
      join(OUT, `${stamp}-${b}.json`),
      JSON.stringify({ ua, browser: b, minutes, runs: rs, control: ctl ?? null }, null, 2),
    );
    writeFileSync(join(OUT, `${stamp}-${b}.md`), lines.join('\n') + '\n');
    console.log(`\n${lines.join('\n')}`);
    summary.push(`${b}: ${go ? 'GO' : 'NO-GO'} (${good.length}/${runs}, control ${control})`);
  }
  console.log(`\n${summary.join('\n')}\n→ ${OUT}/${stamp}-*.{json,md}`);
  process.exitCode = allGo ? 0 : 1;
} finally {
  await shutdown();
}
