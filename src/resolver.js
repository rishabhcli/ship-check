/**
 * Backend for the Jira project page (UI Kit). The UI calls these with `invoke(name, payload)`.
 */
import * as resolverModule from '@forge/resolver';
import { assessProjectRelease, getReleases, postReadinessNote } from './service.js';
import { deps } from './actions.js';

// @forge/resolver is CommonJS with `exports.default`; depending on the bundler the class sits at
// `.default` or `.default.default`, so resolve it defensively.
const Resolver = resolverModule.default?.default || resolverModule.default;
const resolver = new Resolver();

const projectKeyOf = (context) => context?.extension?.project?.key;

resolver.define('getReleases', async ({ context }) => {
  const projectKey = projectKeyOf(context);
  const versions = await getReleases({ jira: deps().jira, projectKey });
  return { projectKey, versions };
});

resolver.define('assess', async ({ payload, context }) => {
  const projectKey = projectKeyOf(context);
  const result = await assessProjectRelease({ ...deps(), cloudId: context.cloudId, projectKey, versionName: payload?.versionName });
  // The docs list is shown in the UI as the "context trail".
  const docs = [];
  for (const [key, list] of Object.entries(result.docsByKey || {})) {
    for (const d of list) docs.push({ issueKey: key, title: d.title, url: d.url });
  }
  return { projectKey, report: result.report, delta: result.delta, docs, diagnostics: result.diagnostics };
});

resolver.define('postNote', async ({ payload, context }) => {
  const projectKey = projectKeyOf(context);
  return postReadinessNote({ ...deps(), cloudId: context.cloudId, projectKey, versionName: payload.versionName, issueKey: payload.issueKey });
});

export const handler = resolver.getDefinitions();
