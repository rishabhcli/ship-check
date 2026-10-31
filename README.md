# Ship Check

Release readiness with receipts. A Forge app for Jira that answers "can we ship this version?" from real data, and exposes the same answer to people, Rovo agents and third-party agents.

Built for Codegeist 2026 (Apps for Software Teams).

## What it does

Pick a Jira version. Ship Check reads every issue with that fix version and runs eight checks:

| Check | Fails or warns when |
| --- | --- |
| Work completed | Few issues are done and the release date is near |
| Critical bugs | An open Bug has Highest, Blocker or Critical priority |
| Dependency chains | An open issue waits on unresolved work, including issues outside the release. Chains are traced to the root blocker. |
| Owners assigned | Open issues have no assignee (fails for High or above close to the release date) |
| Regression risk | An open bug "is caused by" work in the same release |
| Stalled work | An in-progress issue has not changed for more than 7 days |
| Context trail | High-priority issues have no linked Confluence page (design, decision, runbook). Read from the Teamwork Graph. |
| Release notes | No page titled like "Release Notes <version>" is linked to any issue in the release. Read from the Teamwork Graph. |

The verdict is SHIP, AT RISK or HOLD, with a score, evidence per check and an ordered "do next" list. Every run is stored as a snapshot, so the next run shows what was resolved and what newly opened.

If the Teamwork Graph cannot be read, the two graph checks report `unknown` and the report says its confidence is partial. They are never silently counted as failures or passes.

## Where it runs

| Surface | Module | Notes |
| --- | --- | --- |
| Jira project page "Ship Check" | `jira:projectPage` (UI Kit) | Version picker, checks table, do-next list, flagged issues, context trail, delta since last check |
| Rovo agent "Ship Check" | `rovo:agent` | Uses the actions below. Prompt forbids guessing: every number and key must come from an action result. |
| Reusable Rovo actions | `action` x5 | `list-releases`, `assess-release`, `explain-blockers`, `find-context-gaps`, `post-readiness-note` (the only write, confirmation required by the UPDATE verb) |
| MCP server for third-party agents | `rovo:mcp` | Exposes the four read-only actions as tools. Endpoint: `https://mcp.atlassian.com/forge/<appId>` after an admin enables the tools. See `skills/ship-check/SKILL.md`. |
| Teamwork Graph | `requestTeamworkGraph` + persisted Cypher | Consumes issue-to-page relationships (`content_entity_links_entity`) through two registered queries. Scopes: `read:graph:issue:jira`, `read:graph:page:confluence`. |

## Layout

```
manifest.yml            modules, actions, scopes
src/engine/readiness.js pure rules (no Forge, no network), unit tested
src/jira.js             Jira REST access, runs as the calling user
src/twg.js              Teamwork Graph client and response parsing
src/service.js          orchestration shared by the page, the agent and the MCP tools
src/actions.js          Rovo action handlers
src/resolver.js         backend for the project page
src/frontend/index.jsx  UI Kit page
scripts/seed-demo-data.mjs  creates the sample project and Confluence pages
test/                   node:test suite
```

## Install and try it

1. Install the Forge CLI (Node 22 or 24) and run `forge login`.
2. `npm install`, then `forge deploy -e development` and `forge install -e development` for Jira and for Confluence (the Teamwork Graph scope spans both).
3. Create a company-managed Scrum project with key `HCO`, then run the seed script to create sample data (versions 2.3.2, 2.4.0 and 2.5.0, 24 issues, links, and five Confluence pages):

   ```
   ATLASSIAN_SITE=your-site.atlassian.net ATLASSIAN_EMAIL=you@example.com ATLASSIAN_API_TOKEN=... node scripts/seed-demo-data.mjs
   ```

   All of that data is synthetic. Any real project with fix versions works without it.
4. Open the project, then the "Ship Check" tab.
5. Register the two persisted Teamwork Graph queries for your app id (see `docs/teamwork-graph.md`) and put the keys in `forge variables set TWG_QUERY_PAGE_TO_ITEM` and `TWG_QUERY_ITEM_TO_PAGE`. Without them the graph checks show `unknown`.

## Tests

```
npm test
```

The engine suite covers every check, blocker-chain tracing with cycles and external issues, the unknown handling for missing graph data, snapshot diffs and the plain-text rendering. These tests exercise the rules with fixtures, not a live site.

## Honest limits

- The Teamwork Graph only knows pages that the graph has indexed as linked to an issue. Indexing can lag after a page is created.
- Persisted Cypher queries are owned by one app id and registered per app. A copy of this app under another id needs its own registration.
- Stalled-work detection is tested with fixtures only: Jira does not allow back-dating `updated` on sample issues, so the demo site never trips it.
- Verdicts are rule based, not predictions. Thresholds live in `DEFAULT_CONFIG` in `src/engine/readiness.js`.
- The MCP endpoint needs an admin to enable the tools per site (Atlassian Administration, Connected apps).
- Release dates in the sample data are set relative to the day the seed ran.

## License

MIT. See `LICENSE`.
