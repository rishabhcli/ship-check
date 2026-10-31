# Devpost submission text (Codegeist 2026)

Fill each Devpost field from the matching block. Items marked TODO must be completed before submitting.

## Project name
Ship Check

## Tagline (under 60 characters)
Release readiness for Jira, with receipts

## Category
Apps for Software Teams

## Bonus prizes to select
- Best Agents (rovo:agent module plus reusable rovo:action modules)
- Best app with Atlassian MCP (rovo:mcp module)
- Best apps with Teamwork Graph integration (consumes the Teamwork Graph API)
- Not selected: Best Marketplace published app. Atlassian's docs say apps that need more than one Atlassian app can only be listed as paid apps, and Ship Check needs both Jira and Confluence scopes for its graph reads, so a listing would need a paid-app vendor setup.

## Description
Release managers and tech leads ask the same question before every release: can we ship this version? The answer usually comes from scanning a Jira board by hand. Ship Check answers it from the data and shows its evidence.

Pick a Jira version and Ship Check reads every issue that carries that fix version. It runs eight checks: how much work is done, open critical bugs, dependency chains, owners, regression risk, stalled work, linked context, and release notes. It returns a verdict (SHIP, AT RISK or HOLD), a score and an ordered list of what to do next.

Two checks use the Teamwork Graph. The graph knows which Confluence pages are linked to which Jira work items, so Ship Check can tell that a Highest-priority issue has no design, decision or runbook page behind it, and whether a release notes page exists for the version. If the graph cannot be read, those two checks say "unknown" and the report marks its confidence as partial. They are never counted silently.

The dependency check follows "is blocked by" links through unresolved issues, including issues outside the release. On the sample project, HCO-8 waits on HCO-7, which waits on HCO-24 (a vendor access request that is not in the release). The report names HCO-24 as the first thing to unblock.

The same answer is available three ways: a Ship Check page inside each Jira project, a Rovo agent, and an MCP server so tools such as Claude Code or Cursor can ask the same questions. All three call the same code, so a person, a Rovo agent and an outside agent never disagree. Every run is stored as a snapshot, so the next run shows what was resolved and what newly opened.

## How it was built
Forge app on Node.js 24 with UI Kit. Modules: jira:projectPage, rovo:agent, rovo:mcp and five action modules (list-releases, assess-release, explain-blockers, find-context-gaps, post-readiness-note). The readiness rules are pure functions with no Forge or network code, covered by a node:test suite of 14 tests. Jira data comes from the Jira REST API as the calling user. Graph data comes from requestTeamworkGraph through persisted Cypher queries over the content_entity_links_entity relationship. Snapshots use Forge key-value storage. Seed data is created by a script in the repository and is synthetic.

AI tools used: Claude Code was used to write and review the code. The Rovo agent prompt tells the model not to state anything that is not in an action result.

## How it meets the main technology requirement
Ship Check is a Forge app (manifest.yml with five module types) that integrates with Jira (project page, REST API as the user), Rovo (agent, reusable actions, MCP server) and the Teamwork Graph (read scopes read:graph:issue:jira and read:graph:page:confluence, persisted Cypher queries executed through requestTeamworkGraph). It was built during the submission period.

## Bonus prize write-ups
Best Agents: the Ship Check agent (rovo:agent) uses five reusable rovo:action modules. Other agents can invoke those actions as tools. The only write action, post-readiness-note, uses the UPDATE verb so users confirm before it runs.

Best app with Atlassian MCP: the rovo:mcp module exposes four read-only actions as tools (list-releases, assess-release, explain-blockers, find-context-gaps). The repository includes skills/ship-check/SKILL.md for third-party agents. An admin enables the tools per site under Connected apps, and the endpoint is https://mcp.atlassian.com/forge/a93caeb3-a2e1-44d0-99dc-82fb67e345c3.

Best apps with Teamwork Graph integration: Ship Check consumes the graph to find the Confluence pages linked to each work item in a release. It queries as the invoking user, handles the "missing scope returns empty, not an error" behavior by distinguishing errors from empty results, and reports unknown instead of guessing.

## Built with
forge, atlassian-jira, atlassian-confluence, rovo, teamwork-graph, model-context-protocol, javascript, react, ui-kit

## Links
- Code: https://github.com/rishabhcli/ship-check (MIT)
- Installation link (Forge sharing, Jira and Confluence): see tmp/install-link.txt, paste the full URL
- Video: TODO (YouTube, public, under 3 minutes)
- Demo project: sample Jira project HCO on rishabhrb.atlassian.net is not public; judges can recreate it with scripts/seed-demo-data.mjs

## Instructions for judges
1. Open the installation link, choose a site that has Jira and Confluence, and install on both.
2. In Jira, create a company-managed Scrum project with key HCO, then run: ATLASSIAN_SITE=<site> ATLASSIAN_EMAIL=<email> ATLASSIAN_API_TOKEN=<token> node scripts/seed-demo-data.mjs (about one minute). Any project that has fix versions also works without seeding.
3. Open the project and select the "Ship Check" tab. Choose version 2.4.0 (HOLD) and 2.3.2 (SHIP).
4. Context trail and Release notes need two persisted Teamwork Graph queries registered for the app (docs/teamwork-graph.md). Without them those two checks show "unknown" and everything else works.
5. For the agent and the MCP server, an admin must have Rovo available on the site and enable the tools under Atlassian Administration, Apps, Sites, your site, Connected apps, Ship Check.

## Known limits (state these honestly)
- Verified live: project page, Jira data, blocker chains, Teamwork Graph reads, snapshots.
- TODO verify live: Rovo agent chat and the MCP endpoint (Rovo chat was not available on the developer site used for testing).
- Persisted Teamwork Graph queries are registered per app id.
- Stalled-work detection is covered by unit tests only, because sample issues cannot be back-dated.
