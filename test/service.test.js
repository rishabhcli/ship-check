import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIssue, jqlQuote } from '../src/jira.js';
import { assessProjectRelease, explainBlockers, pickVersion, postReadinessNote } from '../src/service.js';
import { fetchLinkedDocs, issueAri, parseLinkRows } from '../src/twg.js';

// A tiny fake Jira that speaks the REST shapes the app uses.
const raw = (id, key, over = {}) => ({
  id: String(id),
  key,
  fields: {
    summary: `summary ${key}`,
    status: { name: over.done ? 'Done' : 'To Do', statusCategory: { key: over.done ? 'done' : 'new' } },
    priority: { name: over.priority || 'Medium' },
    issuetype: { name: over.type || 'Task' },
    assignee: over.assignee === null ? null : { displayName: 'Ana' },
    updated: '2026-10-30T12:00:00.000+0000',
    issuelinks: over.links || [],
  },
});
const stubOf = (key, done = false) => ({ key, fields: { summary: `summary ${key}`, status: { name: done ? 'Done' : 'To Do', statusCategory: { key: done ? 'done' : 'new' } }, priority: { name: 'High' }, issuetype: { name: 'Task' } } });

function fakeJira({ comments = [] } = {}) {
  const issues = {
    'A-1': raw(1, 'A-1', { priority: 'Highest', type: 'Bug', links: [{ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: stubOf('X-9') }] }),
    'A-2': raw(2, 'A-2', { done: true }),
    'X-9': raw(9, 'X-9', { priority: 'High', assignee: null }),
  };
  return {
    request: async (path, init) => {
      const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (path.includes('/versions')) return ok([{ id: '1', name: '1.0', released: false, releaseDate: '2026-11-03' }, { id: '2', name: '0.9', released: true }]);
      if (path.includes('/search/jql')) {
        const jql = JSON.parse(init.body).jql;
        if (jql.includes('fixVersion')) return ok({ issues: [issues['A-1'], issues['A-2']] });
        if (jql.includes('key in')) return ok({ issues: [issues['X-9']] });
      }
      if (path.includes('/comment')) { comments.push(JSON.parse(init.body)); return ok({ id: '555' }); }
      const m = path.match(/\/issue\/([A-Z]+-\d+)/);
      if (m && issues[m[1]]) return ok(issues[m[1]]);
      return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    },
  };
}

const graphRow = (key, id, title) => ({ node: { columns: [{ key: 'w', value: { data: { __typename: 'JiraWorkItem', id: `ari:cloud:jira:c:issue/${id}`, key } } }, { key: 'p', value: { data: { __typename: 'ConfluencePage', id: 'p1', title, webUrl: `https://x/${title}`, lastUpdatedAt: null } } }] } });
const fakeTwg = (rows, errors) => ({ query: async () => (errors ? { errors } : { data: { customQuery: { edges: rows, pageInfo: { hasNextPage: false } } } }) });
const memoryStore = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), m }; };

test('normalizeIssue reads links from the viewpoint of the issue', () => {
  const issue = normalizeIssue(raw(1, 'A-1', { links: [{ type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: stubOf('X-9') }, { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, outwardIssue: stubOf('A-5', true) }] }));
  assert.deepEqual(issue.links.map((l) => [l.relation, l.other.key, l.other.category]), [['is blocked by', 'X-9', 'todo'], ['blocks', 'A-5', 'done']]);
  assert.equal(issue.assignee, 'Ana');
});

test('jqlQuote escapes quotes and backslashes', () => {
  assert.equal(jqlQuote('a"b\\c'), '"a\\"b\\\\c"');
});

test('pickVersion prefers an exact name, then a partial, then the next unreleased', () => {
  const versions = [{ name: '1.0', released: true }, { name: '2.4.0', released: false }, { name: '2.5.0', released: false }];
  assert.equal(pickVersion(versions, '2.5.0').name, '2.5.0');
  assert.equal(pickVersion(versions, '2.4').name, '2.4.0');
  assert.equal(pickVersion(versions, undefined).name, '2.4.0');
  assert.equal(pickVersion(versions, 'nope'), null);
});

test('parseLinkRows keeps only complete issue and page pairs', () => {
  const rows = parseLinkRows({ data: { customQuery: { edges: [graphRow('A-1', 1, 'Design'), { node: { columns: [] } }] } } });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].issue.key, rows[0].page.title], ['A-1', 'Design']);
});

test('fetchLinkedDocs de-duplicates pages across both query directions and flags graph errors as unknown', async () => {
  const issues = [{ key: 'A-1', id: '1' }, { key: 'A-2', id: '2' }];
  const ok = await fetchLinkedDocs(fakeTwg([graphRow('A-1', 1, 'Design')]), issues, 'c');
  assert.deepEqual(ok.docsByKey['A-1'].map((d) => d.title), ['Design']);
  assert.deepEqual(ok.docsByKey['A-2'], []);
  const bad = await fetchLinkedDocs(fakeTwg([], [{ message: 'x', extensions: { code: 'FEATURE_UNAVAILABLE' } }]), issues, 'c');
  assert.equal(bad.docsByKey, null);
  assert.match(bad.diagnostics.errors[0], /FEATURE_UNAVAILABLE/);
  assert.equal(issueAri('c', '1'), 'ari:cloud:jira:c:issue/1');
});

test('assessProjectRelease combines Jira, graph and snapshots end to end', async () => {
  const store = memoryStore();
  const deps = { jira: fakeJira(), twg: fakeTwg([graphRow('A-1', 1, 'Runbook')]), store, cloudId: 'c', projectKey: 'A', versionName: '1.0', now: new Date('2026-10-30T15:00:00Z') };
  const first = await assessProjectRelease(deps);
  assert.equal(first.report.verdict, 'HOLD');
  assert.deepEqual(first.report.checks.find((c) => c.id === 'dependencies').rootBlockers.map((r) => r.key), ['X-9']);
  assert.equal(first.delta.first, true);
  const second = await assessProjectRelease(deps);
  assert.equal(second.delta.first, false);
  assert.equal(second.delta.scoreDelta, 0);
});

test('assessProjectRelease reports partial confidence when the graph is off', async () => {
  const r = await assessProjectRelease({ jira: fakeJira(), twg: null, store: null, cloudId: 'c', projectKey: 'A', versionName: '1.0' });
  assert.equal(r.report.confidence, 'partial');
});

test('explainBlockers traces the chain and postReadinessNote writes one comment', async () => {
  const e = await explainBlockers({ jira: fakeJira(), issueKey: 'A-1' });
  assert.deepEqual(e.chains, [['X-9', 'A-1']]);
  assert.match(e.text, /Blocked by X-9/);
  const comments = [];
  const res = await postReadinessNote({ jira: fakeJira({ comments }), twg: null, store: null, cloudId: 'c', projectKey: 'A', versionName: '1.0', issueKey: 'A-2' });
  assert.equal(res.posted, true);
  assert.equal(comments.length, 1);
  assert.match(JSON.stringify(comments[0]), /Ship Check readiness note/);
});

test('an unknown version produces a readable error', async () => {
  await assert.rejects(assessProjectRelease({ jira: fakeJira(), twg: null, store: null, cloudId: 'c', projectKey: 'A', versionName: '9.9' }), /No version matching "9.9"/);
});
