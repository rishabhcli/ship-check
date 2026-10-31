/**
 * Rovo actions. Each function backs one `action` module in manifest.yml.
 *
 * The same functions are exposed three ways:
 *   1. to the Ship Check Rovo agent (rovo:agent -> actions),
 *   2. to any other Rovo agent as reusable tools (action modules),
 *   3. to third-party agents such as Claude Code or Cursor through the rovo:mcp module.
 *
 * Contract with the language model: every number and issue key in a response comes from Jira or the
 * Teamwork Graph. The functions never ask a model to compute anything, and they return an `error` field
 * instead of throwing so the agent can explain what went wrong.
 */
import { kvs } from '@forge/kvs';
import { assessProjectRelease, explainBlockers, getReleases, postReadinessNote } from './service.js';
import { userJiraClient } from './jira.js';
import { userTwgClient } from './twg.js';

const store = { get: (key) => kvs.get(key), set: (key, value) => kvs.set(key, value) };
export const deps = () => ({ jira: userJiraClient(), twg: userTwgClient(), store });

/** Pull defaults out of the Rovo invocation context (the page the user is looking at). */
function fromContext(payload) {
  const jira = payload?.context?.jira || {};
  return {
    cloudId: payload?.context?.cloudId,
    projectKey: (payload?.projectKey || jira.projectKey || '').toString().trim().toUpperCase(),
    issueKey: (payload?.issueKey || jira.issueKey || '').toString().trim().toUpperCase(),
    versionName: payload?.versionName ? String(payload.versionName).trim() : undefined,
  };
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    console.error('Ship Check action failed:', error?.message || error);
    return { error: String(error?.message || error) };
  }
}

/** Compact, model-friendly view of a report. */
export function compactReport(result) {
  const { report, delta } = result;
  return {
    summary: result.text,
    verdict: report.verdict,
    score: report.score,
    confidence: report.confidence,
    release: report.version,
    counts: report.counts,
    checks: report.checks.map((c) => ({ id: c.id, title: c.title, status: c.status, summary: c.summary, issueKeys: c.issueKeys.slice(0, 15) })),
    flaggedIssues: report.flagged.slice(0, 12).map((f) => ({ key: f.key, summary: f.summary, priority: f.priority, status: f.status, assignee: f.assignee, why: f.reasons.map((r) => `${r.title} (${r.status})`) })),
    nextActions: report.nextActions,
    sinceLastCheck: delta && !delta.first ? { since: delta.since, verdictChanged: delta.verdictChanged, scoreDelta: delta.scoreDelta, resolved: delta.resolved, newlyOpen: delta.newlyOpen } : 'first check, no earlier snapshot',
    dataSources: { jira: 'Jira REST API', teamworkGraph: result.diagnostics.errors.length ? `degraded: ${result.diagnostics.errors.join('; ')}` : `${result.diagnostics.rows} document link(s) read` },
  };
}

export async function listReleasesAction(payload) {
  return guarded(async () => {
    const { projectKey } = fromContext(payload);
    if (!projectKey) return { error: 'projectKey is required, for example HCO.' };
    const versions = await getReleases({ jira: deps().jira, projectKey });
    return { projectKey, versions };
  });
}

export async function assessReleaseAction(payload) {
  return guarded(async () => {
    const { cloudId, projectKey, versionName } = fromContext(payload);
    if (!projectKey) return { error: 'projectKey is required, for example HCO.' };
    const result = await assessProjectRelease({ ...deps(), cloudId, projectKey, versionName });
    return compactReport(result);
  });
}

export async function findContextGapsAction(payload) {
  return guarded(async () => {
    const { cloudId, projectKey, versionName } = fromContext(payload);
    if (!projectKey) return { error: 'projectKey is required, for example HCO.' };
    const result = await assessProjectRelease({ ...deps(), cloudId, projectKey, versionName, persist: false });
    const trail = result.report.checks.find((c) => c.id === 'context-trail');
    const notes = result.report.checks.find((c) => c.id === 'release-notes');
    const issueDocs = Object.entries(result.docsByKey || {}).map(([key, docs]) => ({ key, documents: docs.map((d) => ({ title: d.title, url: d.url })) })).filter((e) => e.documents.length);
    return { release: result.report.version, contextTrail: { status: trail.status, summary: trail.summary, issuesWithoutDocuments: trail.issueKeys }, releaseNotes: { status: notes.status, summary: notes.summary }, linkedDocuments: issueDocs, source: 'Jira + Teamwork Graph' };
  });
}

export async function explainBlockersAction(payload) {
  return guarded(async () => {
    const { issueKey } = fromContext(payload);
    if (!issueKey) return { error: 'issueKey is required, for example HCO-8.' };
    return await explainBlockers({ jira: deps().jira, issueKey });
  });
}

export async function postReadinessNoteAction(payload) {
  return guarded(async () => {
    const { cloudId, projectKey, versionName, issueKey } = fromContext(payload);
    if (!projectKey || !issueKey) return { error: 'projectKey and issueKey are required.' };
    return await postReadinessNote({ ...deps(), cloudId, projectKey, versionName, issueKey });
  });
}
