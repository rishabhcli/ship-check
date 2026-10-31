import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRelease, categoryFromJira, daysUntil, diffSnapshots, renderReport, traceBlockerChains } from '../src/engine/readiness.js';

const NOW = new Date('2026-10-30T15:00:00Z');
const stub = (key, category = 'todo', extra = {}) => ({ key, summary: `summary ${key}`, status: category === 'done' ? 'Done' : 'To Do', category, priority: 'High', type: 'Task', ...extra });
const issue = (key, over = {}) => ({ key, id: key.replace(/\D/g, ''), summary: `summary ${key}`, type: 'Story', priority: 'Medium', status: 'To Do', category: 'todo', assignee: 'Ana', updated: '2026-10-30T12:00:00Z', links: [], ...over });
const version = { name: '2.4.0', releaseDate: '2026-11-03' };
const docs = (map) => Object.fromEntries(Object.entries(map).map(([k, titles]) => [k, titles.map((t) => ({ title: t, url: `https://x/${t}` }))]));

test('categoryFromJira maps status categories', () => {
  assert.equal(categoryFromJira('done'), 'done');
  assert.equal(categoryFromJira('indeterminate'), 'in_progress');
  assert.equal(categoryFromJira('new'), 'todo');
  assert.equal(categoryFromJira(undefined), 'todo');
});

test('daysUntil counts whole days and handles missing dates', () => {
  assert.equal(daysUntil('2026-11-03', NOW), 4);
  assert.equal(daysUntil('2026-10-30', NOW), 0);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('not a date', NOW), null);
});

test('a finished, documented release is SHIP', () => {
  const issues = [issue('A-1', { category: 'done', status: 'Done', priority: 'High' }), issue('A-2', { category: 'done', status: 'Done' })];
  const report = assessRelease({ version, issues, docsByKey: docs({ 'A-1': ['Design'], 'A-2': ['Release Notes 2.4.0'] }), now: NOW });
  assert.equal(report.verdict, 'SHIP');
  assert.equal(report.score, 100);
  assert.equal(report.confidence, 'full');
  assert.deepEqual(report.nextActions, []);
});

test('an open critical bug forces HOLD', () => {
  const issues = [issue('A-1', { type: 'Bug', priority: 'Highest', category: 'in_progress', status: 'In Progress' }), issue('A-2', { category: 'done', status: 'Done' })];
  const report = assessRelease({ version, issues, docsByKey: docs({}), now: NOW });
  const c = report.checks.find((x) => x.id === 'hard-blockers');
  assert.equal(c.status, 'fail');
  assert.deepEqual(c.issueKeys, ['A-1']);
  assert.equal(report.verdict, 'HOLD');
});

test('dependency chains are traced to the root blocker, including issues outside the release', () => {
  const external = issue('X-9', { priority: 'High', status: 'In Progress', category: 'in_progress', links: [] });
  const mid = issue('A-2', { links: [{ type: 'Blocks', relation: 'is blocked by', other: stub('X-9') }] });
  const top = issue('A-3', { links: [{ type: 'Blocks', relation: 'is blocked by', other: stub('A-2') }] });
  const known = new Map([external, mid, top].map((i) => [i.key, i]));
  assert.deepEqual(traceBlockerChains('A-3', known), [['X-9', 'A-2', 'A-3']]);

  const report = assessRelease({ version, issues: [mid, top], externalIssues: [external], docsByKey: docs({}), now: NOW });
  const dep = report.checks.find((x) => x.id === 'dependencies');
  assert.equal(dep.status, 'fail');
  assert.deepEqual(dep.rootBlockers.map((r) => r.key), ['X-9']);
  assert.deepEqual(dep.rootBlockers[0].unblocks.sort(), ['A-2', 'A-3']);
  assert.match(report.nextActions[0], /Unblock X-9/);
});

test('resolved blockers and link cycles never block or loop', () => {
  const a = issue('A-1', { links: [{ type: 'Blocks', relation: 'is blocked by', other: stub('A-2') }] });
  const b = issue('A-2', { links: [{ type: 'Blocks', relation: 'is blocked by', other: stub('A-1') }] });
  const known = new Map([a, b].map((i) => [i.key, i]));
  assert.ok(Array.isArray(traceBlockerChains('A-1', known)));
  const done = issue('A-3', { links: [{ type: 'Blocks', relation: 'is blocked by', other: stub('A-4', 'done') }] });
  assert.equal(traceBlockerChains('A-3', new Map([[done.key, done]])).length, 0);
});

test('unassigned high-priority work near the release fails ownership, far from it only warns', () => {
  const issues = [issue('A-1', { priority: 'High', assignee: null })];
  const near = assessRelease({ version, issues, docsByKey: docs({}), now: NOW });
  assert.equal(near.checks.find((c) => c.id === 'ownership').status, 'fail');
  const far = assessRelease({ version: { name: '2.4.0', releaseDate: '2026-12-30' }, issues, docsByKey: docs({}), now: NOW });
  assert.equal(far.checks.find((c) => c.id === 'ownership').status, 'warn');
});

test('regression risk flags open bugs caused by work in the release', () => {
  const cause = issue('A-1', { category: 'in_progress', status: 'In Progress' });
  const bug = issue('A-2', { type: 'Bug', priority: 'Medium', links: [{ type: 'Problem/Incident', relation: 'is caused by', other: stub('A-1') }] });
  const report = assessRelease({ version, issues: [cause, bug], docsByKey: docs({}), now: NOW });
  const c = report.checks.find((x) => x.id === 'regression-risk');
  assert.equal(c.status, 'warn');
  assert.deepEqual(c.issueKeys, ['A-2']);
});

test('stalled in-progress work is flagged only past the threshold', () => {
  const old = issue('A-1', { category: 'in_progress', status: 'In Progress', updated: '2026-10-10T00:00:00Z' });
  const fresh = issue('A-2', { category: 'in_progress', status: 'In Progress', updated: '2026-10-29T00:00:00Z' });
  const report = assessRelease({ version, issues: [old, fresh], docsByKey: docs({}), now: NOW });
  assert.deepEqual(report.checks.find((c) => c.id === 'stale-work').issueKeys, ['A-1']);
});

test('without Teamwork Graph data the context checks are unknown, not failed', () => {
  const report = assessRelease({ version, issues: [issue('A-1', { category: 'done', status: 'Done' })], docsByKey: null, now: NOW });
  assert.equal(report.checks.find((c) => c.id === 'context-trail').status, 'unknown');
  assert.equal(report.checks.find((c) => c.id === 'release-notes').status, 'unknown');
  assert.equal(report.confidence, 'partial');
  assert.equal(report.verdict, 'SHIP');
});

test('context trail lists high-priority issues with no linked page; release notes need the version name', () => {
  const issues = [issue('A-1', { priority: 'Highest' }), issue('A-2', { priority: 'High' }), issue('A-3', { priority: 'Low' })];
  const report = assessRelease({ version, issues, docsByKey: docs({ 'A-2': ['Runbook', 'Release Notes 2.3.2'] }), now: NOW });
  const trail = report.checks.find((c) => c.id === 'context-trail');
  assert.equal(trail.status, 'warn');
  assert.deepEqual(trail.issueKeys, ['A-1']);
  assert.deepEqual(trail.metrics, { covered: 1, total: 2 });
  // "Release Notes 2.3.2" is for a different version, so 2.4.0 has none.
  assert.equal(report.checks.find((c) => c.id === 'release-notes').status, 'warn');
  const soon = assessRelease({ version: { name: '2.4.0', releaseDate: '2026-10-31' }, issues, docsByKey: docs({}), now: NOW });
  assert.equal(soon.checks.find((c) => c.id === 'release-notes').status, 'fail');
});

test('completion fails when little is done and the release is near', () => {
  const issues = [issue('A-1', { category: 'done', status: 'Done' }), issue('A-2'), issue('A-3'), issue('A-4')];
  const report = assessRelease({ version, issues, docsByKey: docs({}), now: NOW });
  assert.equal(report.checks.find((c) => c.id === 'completion').status, 'fail');
  assert.deepEqual(report.counts, { total: 4, done: 1, open: 3 });
});

test('diffSnapshots reports resolved and newly opened issues', () => {
  const first = assessRelease({ version, issues: [issue('A-1'), issue('A-2')], docsByKey: docs({}), now: NOW });
  const d1 = diffSnapshots(null, first);
  assert.equal(d1.first, true);
  const second = assessRelease({ version, issues: [issue('A-1', { category: 'done', status: 'Done' }), issue('A-2'), issue('A-3')], docsByKey: docs({}), now: NOW });
  const d2 = diffSnapshots(d1.snapshot, second);
  assert.deepEqual(d2.resolved, ['A-1']);
  assert.deepEqual(d2.newlyOpen, ['A-3']);
});

test('renderReport includes verdict, every check and ordered next actions', () => {
  const report = assessRelease({ version, issues: [issue('A-1', { type: 'Bug', priority: 'Highest' })], docsByKey: docs({}), now: NOW });
  const text = renderReport(report);
  assert.match(text, /Release 2\.4\.0: HOLD/);
  assert.match(text, /\[FAIL\] Critical bugs/);
  assert.match(text, /Do next:\n1\./);
});
