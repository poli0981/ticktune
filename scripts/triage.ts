/**
 * Maintenance-mode triage — MAINTENANCE.md, docs/14 §1.
 *
 * Decides what `.github/workflows/triage.yml` does with a new issue or pull
 * request; the workflow then carries the decision out with `gh`. The decision
 * is a pure function of the event payload, so every branch is unit-tested
 * (tests/unit/tt-triage.test.ts) instead of living in shell `if`s. Ported from
 * bookmarkmagic's `scripts/triage.mjs`, which has run since 2026-11-18.
 *
 *  - An issue labelled `enhancement` (the feature form applies it) whose
 *    "kind of change" answer is "something new" — or that has no answer at
 *    all and the owner labelled it by hand — is labelled `maintenance-mode`,
 *    gets a comment and is closed as not planned.
 *  - The other two answers (in the backlog; needed for a fix) keep it open,
 *    labelled `needs-triage`, for the maintainer to read.
 *  - A pull request from outside the project titled `feat…` (Conventional
 *    Commits) is labelled and closed the same way.
 *  - Exempt: the owner's own issues, project members and collaborators, bots
 *    (Dependabot), anything labelled `roadmap`, anything already triaged.
 *
 * Nothing here runs code from the event: titles and bodies are only compared
 * with constants, and the workflow passes the payload by file, never through
 * shell interpolation.
 *
 * Usage (in CI): `node scripts/triage.ts` — reads GITHUB_EVENT_NAME and
 * GITHUB_EVENT_PATH from the environment the runner sets, prints a JSON
 * decision on stdout. It takes no arguments.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/poli0981/ticktune';
export const POLICY_URL = `${REPO}/blob/main/MAINTENANCE.md`;
export const IDEAS_URL = `${REPO}/discussions/categories/ideas`;

/** The feature form's dropdown, word for word (`.github/ISSUE_TEMPLATE/feature_request.yml`). */
export const KIND_QUESTION = 'Which kind of change is this?';
export const KIND = Object.freeze({
  roadmap: 'Something already in the backlog (docs/16)',
  needed: 'Needed to fix a bug, a UI/UX defect or an accessibility barrier',
  fresh: 'Something new — not in the backlog',
});

export const LABEL = Object.freeze({
  feature: 'enhancement',
  closed: 'maintenance-mode',
  triage: 'needs-triage',
  exempt: 'roadmap',
});

/** Associations that mean "part of the project", per GitHub's author_association. */
const INSIDERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const BOT_NOTE = '<sub>Posted automatically by the triage workflow.</sub>';

export const ISSUE_COMMENT = [
  'Thank you for the suggestion.',
  '',
  `TickTune is in **maintenance mode** ([MAINTENANCE.md](${POLICY_URL})): it takes bug, UI/UX and accessibility fixes, language fixes, dependency and security updates, and changes that are genuinely necessary. This request is for something new, so it has been labelled \`${LABEL.closed}\` and closed.`,
  '',
  `It has not been deleted, and it will be read. If it is in the backlog, or it is needed to fix a defect or remove a barrier, it will be reopened. Ideas are welcome in [Discussions › Ideas](${IDEAS_URL}).`,
  '',
  `> TickTune đang ở chế độ bảo trì: không nhận tính năng mới, nên đề xuất này đã được gắn nhãn và đóng — nhưng vẫn sẽ được đọc. Ý tưởng xin gửi ở [Discussions › Ideas](${IDEAS_URL}).`,
  '',
  BOT_NOTE,
].join('\n');

export const PR_COMMENT = [
  'Thank you for the pull request.',
  '',
  `TickTune is in **maintenance mode** ([MAINTENANCE.md](${POLICY_URL})). A pull request that adds a feature — its title starts with \`feat\` — is closed automatically unless the change is genuinely necessary, so this one has been labelled \`${LABEL.closed}\` and closed.`,
  '',
  'Please open an issue first; if it is accepted (label `roadmap`), this pull request will be reopened. If it is a fix rather than a feature, say so in a comment — a `fix:` title is what the maintainer expects.',
  '',
  '> TickTune đang ở chế độ bảo trì: pull request thêm tính năng mới được đóng tự động. Nếu đây là bản sửa lỗi, xin để lại bình luận — tiêu đề `fix:` là điều người bảo trì mong đợi.',
  '',
  BOT_NOTE,
].join('\n');

export interface Decision {
  action: 'close' | 'label' | 'none';
  reason: string;
  kind?: 'issue' | 'pr';
  number?: number;
  label?: string;
  comment?: string;
}

/**
 * The answer to the feature form's dropdown, or undefined when the body has
 * none (an issue from another form, labelled by hand). Issue forms render each
 * field as `### <label>` followed by the answer.
 */
export function kindOf(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === `### ${KIND_QUESTION}`);
  if (at === -1) return undefined;
  for (const line of lines.slice(at + 1)) {
    const text = line.trim();
    if (text.startsWith('### ')) return undefined;
    if (text !== '') return text;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => record(label).name)
    .filter((name): name is string => typeof name === 'string');
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Whether this event is the repository owner adding a label by hand. */
function addedByOwner(payload: Record<string, unknown>): boolean {
  const sender = record(payload.sender).login;
  const owner = record(record(payload.repository).owner).login;
  return (
    payload.action === 'labeled' && typeof sender === 'string' && sender !== '' && sender === owner
  );
}

function decideIssue(payload: Record<string, unknown>): Decision {
  const issue = record(payload.issue);
  const number = positiveInt(issue.number);
  if (number === undefined) return { action: 'none', reason: 'no issue number' };
  if (payload.action !== 'opened' && payload.action !== 'labeled') {
    return { action: 'none', reason: `issue action ${String(payload.action)}` };
  }
  if (payload.action === 'labeled' && record(payload.label).name !== LABEL.feature) {
    return { action: 'none', reason: 'a different label was added' };
  }
  if (issue.state !== 'open') return { action: 'none', reason: 'issue is not open' };
  const labels = labelNames(issue.labels);
  if (!labels.includes(LABEL.feature)) return { action: 'none', reason: 'not a feature request' };
  for (const done of [LABEL.exempt, LABEL.closed, LABEL.triage]) {
    if (labels.includes(done)) return { action: 'none', reason: `already labelled ${done}` };
  }
  if (issue.author_association === 'OWNER') {
    return { action: 'none', reason: "the owner's own issue" };
  }

  const kind = kindOf(issue.body);
  const forTriage: Decision = {
    action: 'label',
    reason: 'in policy — for the maintainer',
    kind: 'issue',
    number,
    label: LABEL.triage,
  };
  if (kind === KIND.roadmap || kind === KIND.needed) return forTriage;
  // No answer at all means the form was not used. Closing on that is the
  // owner's one-touch close, so it needs the owner's own `enhancement` label;
  // anything else (an edited body, an answer the form never offered) goes to
  // a human rather than being closed on a guess.
  if (kind !== KIND.fresh && !addedByOwner(payload)) {
    return { ...forTriage, reason: 'no answer to the form, not labelled by the owner' };
  }
  return {
    action: 'close',
    reason:
      kind === KIND.fresh ? 'a new feature outside the backlog' : 'labelled enhancement by hand',
    kind: 'issue',
    number,
    label: LABEL.closed,
    comment: ISSUE_COMMENT,
  };
}

/** Conventional Commits `feat`, with an optional scope and breaking-change mark. */
const FEAT_TITLE = /^feat(\([^)]*\))?!?:/i;

function decidePullRequest(payload: Record<string, unknown>): Decision {
  const pr = record(payload.pull_request);
  const number = positiveInt(pr.number);
  if (number === undefined) return { action: 'none', reason: 'no pull request number' };
  if (payload.action !== 'opened') {
    return { action: 'none', reason: `pull request action ${String(payload.action)}` };
  }
  if (pr.state !== 'open') return { action: 'none', reason: 'pull request is not open' };
  if (record(pr.user).type === 'Bot') return { action: 'none', reason: 'opened by a bot' };
  if (INSIDERS.has(String(pr.author_association))) {
    return { action: 'none', reason: 'opened from inside the project' };
  }
  if (labelNames(pr.labels).includes(LABEL.exempt)) {
    return { action: 'none', reason: 'labelled roadmap' };
  }
  if (typeof pr.title !== 'string' || !FEAT_TITLE.test(pr.title.trim())) {
    return { action: 'none', reason: 'not a feature pull request' };
  }
  return {
    action: 'close',
    reason: 'a feature pull request from outside the project',
    kind: 'pr',
    number,
    label: LABEL.closed,
    comment: PR_COMMENT,
  };
}

/**
 * What to do with one event.
 *
 * @param eventName GITHUB_EVENT_NAME
 * @param payload the parsed GITHUB_EVENT_PATH file
 */
export function decide(eventName: string | undefined, payload: unknown): Decision {
  const event = record(payload);
  if (eventName === 'issues') return decideIssue(event);
  if (eventName === 'pull_request_target') return decidePullRequest(event);
  return { action: 'none', reason: `event ${String(eventName)} is not triaged` };
}

/** @returns the exit code */
function main(): number {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === '') {
    console.error('triage: GITHUB_EVENT_PATH is not set — this runs inside GitHub Actions only');
    return 1;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (cause) {
    console.error(`triage: cannot read the event payload (${String(cause)})`);
    return 1;
  }
  process.stdout.write(`${JSON.stringify(decide(process.env.GITHUB_EVENT_NAME, payload))}\n`);
  return 0;
}

// Run only as the entry point, so the test can import the pure parts.
const isEntry =
  import.meta.url.startsWith('file:') &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  // exitCode, not exit(): exit() can cut off piped output before CI reads it.
  process.exitCode = main();
}
