import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decide,
  IDEAS_URL,
  ISSUE_COMMENT,
  KIND,
  KIND_QUESTION,
  kindOf,
  LABEL,
  POLICY_URL,
  PR_COMMENT,
} from '../../scripts/triage.ts';

/**
 * scripts/triage.ts — what the maintenance-mode triage workflow does with an
 * issue or a pull request (MAINTENANCE.md, docs/14 §1).
 *
 * The workflow holds a write token on events anyone can trigger, so every
 * branch of the decision is pinned here rather than trusted to a shell `if`.
 */

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

/** An issue body as GitHub renders the feature form. */
function formBody(kind: string): string {
  return [
    `### ${KIND_QUESTION}`,
    '',
    kind,
    '',
    '### What are you trying to do?',
    '',
    'Something.',
  ].join('\n');
}

function issueEvent(
  overrides: {
    action?: string;
    label?: string;
    labels?: string[];
    body?: unknown;
    association?: string;
    state?: string;
  } = {},
): unknown {
  return {
    action: overrides.action ?? 'opened',
    ...(overrides.label !== undefined && { label: { name: overrides.label } }),
    issue: {
      number: 7,
      state: overrides.state ?? 'open',
      author_association: overrides.association ?? 'NONE',
      labels: (overrides.labels ?? [LABEL.feature]).map((name) => ({ name })),
      body: overrides.body ?? formBody(KIND.fresh),
    },
  };
}

function prEvent(
  overrides: {
    action?: string;
    title?: string;
    association?: string;
    userType?: string;
    labels?: string[];
  } = {},
): unknown {
  return {
    action: overrides.action ?? 'opened',
    pull_request: {
      number: 12,
      state: 'open',
      title: overrides.title ?? 'feat(youtube): add a lyrics panel',
      author_association: overrides.association ?? 'FIRST_TIME_CONTRIBUTOR',
      user: { type: overrides.userType ?? 'User' },
      labels: (overrides.labels ?? []).map((name) => ({ name })),
    },
  };
}

describe('kindOf — the feature form dropdown', () => {
  it.each(Object.values(KIND))('reads %j', (kind) => {
    expect(kindOf(formBody(kind))).toBe(kind);
  });

  it('reads a CRLF body', () => {
    expect(kindOf(formBody(KIND.needed).replaceAll('\n', '\r\n'))).toBe(KIND.needed);
  });

  it('is undefined without the question, with an empty answer, or for a non-string', () => {
    expect(kindOf('### What happened?\n\nIt broke.')).toBeUndefined();
    expect(kindOf(`### ${KIND_QUESTION}\n\n### Next\n\nx`)).toBeUndefined();
    expect(kindOf(null)).toBeUndefined();
  });
});

describe('decide — issues', () => {
  it('closes a request for something new, with the policy comment', () => {
    expect(decide('issues', issueEvent())).toEqual({
      action: 'close',
      reason: 'a new feature outside the backlog',
      kind: 'issue',
      number: 7,
      label: LABEL.closed,
      comment: ISSUE_COMMENT,
    });
  });

  it.each([KIND.roadmap, KIND.needed])('keeps %j open for the maintainer', (kind) => {
    expect(decide('issues', issueEvent({ body: formBody(kind) }))).toMatchObject({
      action: 'label',
      label: LABEL.triage,
      number: 7,
    });
  });

  it('closes an issue the owner labelled enhancement by hand', () => {
    const event = {
      ...(issueEvent({
        action: 'labeled',
        label: LABEL.feature,
        body: '### What happened?\n\nx',
      }) as object),
      sender: { login: 'poli0981' },
      repository: { owner: { login: 'poli0981' } },
    };
    expect(decide('issues', event)).toMatchObject({
      action: 'close',
      reason: 'labelled enhancement by hand',
    });
  });

  it.each([
    ['labelled by someone else', 'labeled', 'someone'],
    ['opened with the label but no answer', 'opened', 'poli0981'],
  ])('sends an issue with no answer to a human when %s', (_case, action, sender) => {
    const event = {
      ...(issueEvent({ action, label: LABEL.feature, body: 'edited away' }) as object),
      sender: { login: sender },
      repository: { owner: { login: 'poli0981' } },
    };
    expect(decide('issues', event)).toMatchObject({ action: 'label', label: LABEL.triage });
  });

  it.each([
    ['another label was added', issueEvent({ action: 'labeled', label: 'bug' })],
    ['not a feature request', issueEvent({ labels: ['bug'] })],
    ['the roadmap exemption', issueEvent({ labels: [LABEL.feature, LABEL.exempt] })],
    ['already closed by the bot', issueEvent({ labels: [LABEL.feature, LABEL.closed] })],
    ['already sent to triage', issueEvent({ labels: [LABEL.feature, LABEL.triage] })],
    ["the owner's own issue", issueEvent({ association: 'OWNER' })],
    ['a closed issue', issueEvent({ state: 'closed' })],
    ['an edit', issueEvent({ action: 'edited' })],
  ])('does nothing for %s', (_case, event) => {
    expect(decide('issues', event).action).toBe('none');
  });

  it('does nothing without a usable issue number', () => {
    expect(decide('issues', { action: 'opened', issue: { number: '7; rm -rf /' } }).action).toBe(
      'none',
    );
    expect(decide('issues', null).action).toBe('none');
  });
});

describe('decide — pull requests', () => {
  it.each([
    'feat: add a lyrics panel',
    'feat(youtube): add a lyrics panel',
    'feat!: drop the YouTube rail',
    'FEAT(timer)!: new mode',
  ])('closes %j from outside the project', (title) => {
    expect(decide('pull_request_target', prEvent({ title }))).toEqual({
      action: 'close',
      reason: 'a feature pull request from outside the project',
      kind: 'pr',
      number: 12,
      label: LABEL.closed,
      comment: PR_COMMENT,
    });
  });

  it.each([
    'fix(youtube): read a shorts link',
    'feature: something',
    'docs: feat is not a prefix here',
    'chore(deps): bump astro',
  ])('leaves %j alone', (title) => {
    expect(decide('pull_request_target', prEvent({ title })).action).toBe('none');
  });

  it.each([
    ['the owner', prEvent({ association: 'OWNER' })],
    ['a collaborator', prEvent({ association: 'COLLABORATOR' })],
    ['a member', prEvent({ association: 'MEMBER' })],
    ['Dependabot', prEvent({ userType: 'Bot' })],
    ['a roadmap pull request', prEvent({ labels: [LABEL.exempt] })],
    ['a reopened pull request', prEvent({ action: 'reopened' })],
  ])('exempts %s', (_case, event) => {
    expect(decide('pull_request_target', event).action).toBe('none');
  });
});

describe('decide — other events', () => {
  it('ignores events it does not triage', () => {
    expect(decide('push', {}).action).toBe('none');
    expect(decide(undefined, {}).action).toBe('none');
  });
});

describe('the pieces the script shares with other files', () => {
  it('matches the feature form word for word', () => {
    const form = read('.github/ISSUE_TEMPLATE/feature_request.yml');
    expect(form).toContain(`label: ${KIND_QUESTION}`);
    for (const kind of Object.values(KIND)) expect(form).toContain(`- ${kind}`);
    expect(form).toContain(`labels: ["${LABEL.feature}"]`);
  });

  it('links the policy and the ideas board, and the policy names the label', () => {
    for (const comment of [ISSUE_COMMENT, PR_COMMENT]) expect(comment).toContain(POLICY_URL);
    expect(ISSUE_COMMENT).toContain(IDEAS_URL);
    expect(read('MAINTENANCE.md')).toContain(`\`${LABEL.closed}\``);
  });

  it('is what the workflow runs, with the labels the workflow re-checks', () => {
    const workflow = read('.github/workflows/triage.yml');
    expect(workflow).toContain('node scripts/triage.ts');
    for (const label of [LABEL.closed, LABEL.triage, LABEL.exempt]) {
      expect(workflow).toContain(` ${label} `);
    }
    // Nothing from the event payload is interpolated into a shell line.
    expect(workflow).not.toMatch(/\$\{\{\s*github\.event\.(issue|pull_request)\.(title|body)/);
  });
});
