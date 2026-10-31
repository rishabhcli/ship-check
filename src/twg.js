/**
 * Teamwork Graph access for Ship Check (consumer side).
 *
 * Ship Check asks the graph one question per release: "which Confluence pages are linked to these
 * Jira work items?" Raw Cypher is not available to Forge apps, so the question is registered once as a
 * persisted Cypher query (see docs/teamwork-graph.md and scripts/register-twg-queries.md) and executed
 * by key through the `customQuery` field.
 *
 * The graph is the only place that knows about pages that mention or link an issue without the issue
 * carrying a remote link, which is why the Context trail and Release notes checks use it.
 */
import { asUser } from '@forge/api';

/** Persisted query keys. Override per environment with `forge variables set TWG_QUERY_*`. */
export const QUERY_KEYS = {
  pageToItem: process.env.TWG_QUERY_PAGE_TO_ITEM || '5aed642c-3632-4ac2-a663-3eb1e63649c3',
  itemToPage: process.env.TWG_QUERY_ITEM_TO_PAGE || 'c3942601-9be5-4aa0-a100-a5c1ba903d3b',
};

export const CUSTOM_QUERY = `
query shipcheck_linkedDocs($queryKey: String!, $queryParams: CypherRequestParams, $after: String) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25, after: $after) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultNode {
              id
              data {
                __typename
                ... on ConfluencePage { id title webUrl lastUpdatedAt }
                ... on JiraWorkItem { id key }
              }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Production client: runs graph queries as the invoking user, so results respect their permissions. */
export function userTwgClient() {
  const client = asUser();
  return {
    async query(query, variables, operationName) {
      const response = await client.requestTeamworkGraph(query, variables, operationName);
      return response.json();
    },
  };
}

export const issueAri = (cloudId, issueId) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;

/** Flatten a customQuery response into [{ issue: {key,id}, page: {id,title,url,updated} }]. */
export function parseLinkRows(response) {
  const rows = [];
  const edges = response?.data?.customQuery?.edges || [];
  for (const edge of edges) {
    const row = {};
    for (const col of edge?.node?.columns || []) {
      const data = col?.value?.data;
      if (!data) continue;
      if (data.__typename === 'JiraWorkItem') row.issue = { key: data.key, id: data.id };
      if (data.__typename === 'ConfluencePage') row.page = { id: data.id, title: data.title, url: data.webUrl, updated: data.lastUpdatedAt };
    }
    if (row.issue?.key && row.page?.title) rows.push(row);
  }
  return rows;
}

async function runQuery(twg, queryKey, aris, diagnostics) {
  const rows = [];
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const response = await twg.query(CUSTOM_QUERY, { queryKey, queryParams: { workItemAris: aris }, after }, 'shipcheck_linkedDocs');
    if (response?.errors?.length) {
      diagnostics.errors.push(...response.errors.map((e) => e.extensions?.code || e.message));
      break;
    }
    rows.push(...parseLinkRows(response));
    const info = response?.data?.customQuery?.pageInfo;
    if (!info?.hasNextPage) break;
    after = info.endCursor;
  }
  return rows;
}

/**
 * Documents linked to each work item.
 *
 * @returns {{ docsByKey: Record<string, {title:string,url:string}[]> | null, diagnostics: object }}
 *          `docsByKey` is null when the graph could not be queried at all, which the engine reports
 *          as "unknown" instead of pretending every issue is undocumented.
 */
export async function fetchLinkedDocs(twg, issues, cloudId) {
  const diagnostics = { source: 'Teamwork Graph', queries: 0, rows: 0, errors: [] };
  const aris = issues.filter((i) => i.id).map((i) => issueAri(cloudId, i.id));
  if (aris.length === 0) return { docsByKey: {}, diagnostics };
  const docsByKey = Object.fromEntries(issues.map((i) => [i.key, []]));
  let answered = false;
  try {
    for (const queryKey of [QUERY_KEYS.pageToItem, QUERY_KEYS.itemToPage]) {
      for (let i = 0; i < aris.length; i += 25) {
        diagnostics.queries += 1;
        const before = diagnostics.errors.length;
        const rows = await runQuery(twg, queryKey, aris.slice(i, i + 25), diagnostics);
        if (diagnostics.errors.length === before) answered = true;
        diagnostics.rows += rows.length;
        for (const { issue, page } of rows) {
          const list = docsByKey[issue.key];
          if (list && !list.some((d) => d.url === page.url || d.title === page.title)) list.push({ title: page.title, url: page.url, updated: page.updated });
        }
      }
    }
  } catch (error) {
    diagnostics.errors.push(String(error.message || error));
  }
  return { docsByKey: answered ? docsByKey : null, diagnostics };
}
