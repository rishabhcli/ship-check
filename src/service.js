/**
 * Orchestration: Jira + Teamwork Graph + readiness engine + snapshot store.
 *
 * Both entry points (the project page resolver and the Rovo actions that also back the MCP tools)
 * call these functions, so a human, a Rovo agent and a third-party agent always see the same facts.
 *
 * Dependencies are passed in (`jira`, `twg`, `store`) so the whole flow runs in unit tests without a network.
 */
import { assessRelease, diffSnapshots, renderReport, traceBlockerChains } from './engine/readiness.js';
import { addComment, fetchExternalBlockers, fetchReleaseIssues, getIssue, listVersions } from './jira.js';
import { fetchLinkedDocs } from './twg.js';

const snapshotKey = (projectKey, version) => `snapshot:${projectKey}:${version}`.toLowerCase();

/** Pick the requested version, or the unreleased version with the earliest release date. */
export function pickVersion(versions, requested) {
  if (requested) {
    const wanted = String(requested).trim().toLowerCase();
    return versions.find((v) => v.name.toLowerCase() === wanted) || versions.find((v) => v.name.toLowerCase().includes(wanted)) || null;
  }
  return versions.find((v) => !v.released) || versions[0] || null;
}

export async function getReleases({ jira, projectKey, now = new Date() }) {
  const versions = await listVersions(jira, projectKey);
  return versions.map((v) => ({ ...v }));
}

/**
 * Full assessment of one release.
 * @param {object} deps
 * @param {{request: Function}} deps.jira
 * @param {{query: Function}|null} deps.twg   Null disables the graph (checks report "unknown").
 * @param {{get: Function, set: Function}|null} deps.store
 */
export async function assessProjectRelease({ jira, twg, store, cloudId, projectKey, versionName, now = new Date(), persist = true, config }) {
  const versions = await listVersions(jira, projectKey);
  const version = pickVersion(versions, versionName);
  if (!version) {
    const names = versions.map((v) => v.name).join(', ') || 'none';
    throw new Error(`No version matching "${versionName || ''}" in project ${projectKey}. Versions: ${names}.`);
  }

  const issues = await fetchReleaseIssues(jira, projectKey, version.name);
  const externalIssues = await fetchExternalBlockers(jira, issues);

  let docsByKey = null;
  let diagnostics = { source: 'Teamwork Graph', queries: 0, rows: 0, errors: ['Teamwork Graph disabled'] };
  if (twg) ({ docsByKey, diagnostics } = await fetchLinkedDocs(twg, issues, cloudId));

  const report = assessRelease({ version, issues, externalIssues, docsByKey, now, config });

  let delta = null;
  if (store) {
    const previous = await store.get(snapshotKey(projectKey, version.name));
    delta = diffSnapshots(previous, report);
    if (persist) await store.set(snapshotKey(projectKey, version.name), delta.snapshot);
  }

  return { report, text: renderReport(report), delta, docsByKey, diagnostics, version };
}

/**
 * Explain why one issue is stuck: what it waits on (full chains) and what waits on it.
 */
export async function explainBlockers({ jira, issueKey }) {
  const issue = await getIssue(jira, issueKey);
  const known = new Map([[issue.key, issue]]);

  // Walk upstream, fetching each unresolved blocker so chains can be traced end to end.
  let frontier = [issue];
  for (let hop = 0; hop < 4; hop += 1) {
    const wanted = frontier.flatMap((i) => i.links.filter((l) => l.relation === 'is blocked by' && l.other.category !== 'done' && !known.has(l.other.key)).map((l) => l.other.key));
    if (wanted.length === 0) break;
    const fetched = await Promise.all([...new Set(wanted)].map((k) => getIssue(jira, k)));
    fetched.forEach((i) => known.set(i.key, i));
    frontier = fetched;
  }

  const chains = traceBlockerChains(issue.key, known);
  const downstream = issue.links.filter((l) => l.relation === 'blocks').map((l) => ({ key: l.other.key, summary: l.other.summary, status: l.other.status }));
  const waitingOn = issue.links.filter((l) => l.relation === 'is blocked by').map((l) => ({ key: l.other.key, summary: l.other.summary, status: l.other.status, resolved: l.other.category === 'done' }));

  const lines = [`${issue.key} (${issue.priority}, ${issue.status}): ${issue.summary}`];
  if (waitingOn.length === 0) lines.push('It is not blocked by any linked issue.');
  for (const w of waitingOn) lines.push(`Blocked by ${w.key} "${w.summary}" (${w.status})${w.resolved ? ', resolved' : ''}.`);
  if (chains.length) lines.push(`Unresolved chain(s), root first: ${chains.map((c) => c.join(' -> ')).join('; ')}.`);
  if (downstream.length) lines.push(`It blocks ${downstream.map((d) => `${d.key} (${d.status})`).join(', ')}.`);

  return {
    issue: { key: issue.key, summary: issue.summary, status: issue.status, priority: issue.priority, assignee: issue.assignee },
    waitingOn,
    chains,
    downstream,
    rootBlockers: [...new Set(chains.map((c) => c[0]))],
    text: lines.join('\n'),
  };
}

/** Post the readiness summary as a comment. Callers must obtain explicit user confirmation first. */
export async function postReadinessNote({ jira, twg, store, cloudId, projectKey, versionName, issueKey }) {
  const result = await assessProjectRelease({ jira, twg, store, cloudId, projectKey, versionName, persist: false });
  const text = `Ship Check readiness note\n${result.text}`;
  const comment = await addComment(jira, issueKey, text);
  return { posted: true, issueKey, commentId: comment.id, verdict: result.report.verdict, text };
}
