/**
 * Jira data access for Ship Check.
 *
 * Every function takes a `jira` client with one method, `request(path, init)`, that returns a
 * fetch-style Response. In production the client wraps `api.asUser().requestJira`, so Jira's own
 * permission checks decide what the caller can see. Tests pass a stub, so nothing here needs a network.
 */
import { asUser, assumeTrustedRoute } from '@forge/api';
import { categoryFromJira } from './engine/readiness.js';

/** Production client: calls Jira as the user who invoked the app. */
export function userJiraClient() {
  const client = asUser();
  return {
    request: (path, init) => client.requestJira(assumeTrustedRoute(path), init),
  };
}

const FIELDS = ['summary', 'status', 'priority', 'issuetype', 'assignee', 'updated', 'issuelinks'];

async function json(response, what) {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Jira ${what} failed with ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

export function jqlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Normalise one linked-issue stub from the issuelinks field. */
function stub(raw) {
  return {
    key: raw.key,
    summary: raw.fields?.summary || '',
    status: raw.fields?.status?.name || '',
    category: categoryFromJira(raw.fields?.status?.statusCategory?.key),
    priority: raw.fields?.priority?.name || '',
    type: raw.fields?.issuetype?.name || '',
  };
}

/** Turn a Jira REST issue into the shape the engine expects. */
export function normalizeIssue(raw) {
  const links = [];
  for (const link of raw.fields?.issuelinks || []) {
    if (link.inwardIssue) links.push({ type: link.type?.name, relation: link.type?.inward, other: stub(link.inwardIssue) });
    if (link.outwardIssue) links.push({ type: link.type?.name, relation: link.type?.outward, other: stub(link.outwardIssue) });
  }
  return {
    id: raw.id,
    key: raw.key,
    summary: raw.fields?.summary || '',
    type: raw.fields?.issuetype?.name || '',
    priority: raw.fields?.priority?.name || '',
    status: raw.fields?.status?.name || '',
    category: categoryFromJira(raw.fields?.status?.statusCategory?.key),
    assignee: raw.fields?.assignee?.displayName || null,
    updated: raw.fields?.updated || null,
    links,
  };
}

/** Unreleased and recently released versions of a project, soonest release date first. */
export async function listVersions(jira, projectKey) {
  const versions = await json(await jira.request(`/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`), 'version list');
  return versions
    .filter((v) => !v.archived)
    .map((v) => ({ id: v.id, name: v.name, released: !!v.released, releaseDate: v.releaseDate || null, description: v.description || '' }))
    .sort((a, b) => Number(a.released) - Number(b.released) || (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));
}

/** Run a JQL search, following pagination tokens, up to `limit` issues. */
export async function searchIssues(jira, jql, limit = 200) {
  const out = [];
  let nextPageToken;
  while (out.length < limit) {
    const body = { jql, fields: FIELDS, maxResults: Math.min(100, limit - out.length), ...(nextPageToken ? { nextPageToken } : {}) };
    const page = await json(
      await jira.request('/rest/api/3/search/jql', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }),
      'search',
    );
    out.push(...(page.issues || []).map(normalizeIssue));
    if (!page.nextPageToken || (page.issues || []).length === 0) break;
    nextPageToken = page.nextPageToken;
  }
  return out;
}

export async function fetchReleaseIssues(jira, projectKey, versionName) {
  return searchIssues(jira, `project = ${jqlQuote(projectKey)} AND fixVersion = ${jqlQuote(versionName)} ORDER BY priority ASC, key ASC`);
}

/**
 * Issues outside the release that still block release issues, followed up to `maxHops` levels so a
 * chain such as vendor request -> SDK upgrade -> feature is visible end to end.
 */
export async function fetchExternalBlockers(jira, releaseIssues, maxHops = 3) {
  const known = new Set(releaseIssues.map((i) => i.key));
  const external = [];
  let frontier = releaseIssues;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const wanted = new Set();
    for (const issue of frontier) {
      for (const l of issue.links) {
        if (l.relation === 'is blocked by' && l.other.category !== 'done' && !known.has(l.other.key)) wanted.add(l.other.key);
      }
    }
    if (wanted.size === 0) break;
    const fetched = await searchIssues(jira, `key in (${[...wanted].map(jqlQuote).join(', ')})`, 50);
    fetched.forEach((i) => known.add(i.key));
    external.push(...fetched);
    frontier = fetched;
  }
  return external;
}

export async function getIssue(jira, key) {
  const raw = await json(await jira.request(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`), `issue ${key}`);
  return normalizeIssue(raw);
}

/** Post a plain-text comment (rendered as paragraphs) on an issue. */
export async function addComment(jira, issueKey, text) {
  const content = text
    .split('\n')
    .filter((line) => line.trim().length)
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
  const body = { body: { type: 'doc', version: 1, content } };
  return json(
    await jira.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }),
    'comment',
  );
}
