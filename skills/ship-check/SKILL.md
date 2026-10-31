---
name: ship-check
description: Ask Atlassian Jira whether a release is ready to ship, why an issue is blocked, and which context is missing, using the Ship Check MCP server.
---

# Ship Check

Use the Ship Check MCP tools whenever the user asks if a Jira release is ready, what blocks an issue, or whether design and release-note pages exist.

1. If the user does not name a version, call `list-releases` with the project key.
2. For "can we ship", call `assess-release` with `projectKey` and `versionName`. Report the verdict, the failing checks and the numbered next actions exactly as returned.
3. For "why is X stuck", call `explain-blockers` with `issueKey` and show the chain from the root blocker.
4. For missing documentation, call `find-context-gaps`.
5. Never state a count, issue key or page title that is not in a tool result. If a tool returns `error`, say so.

Endpoint: `https://mcp.atlassian.com/forge/<appId>`. An Atlassian admin must enable the tools under Connected apps first.
