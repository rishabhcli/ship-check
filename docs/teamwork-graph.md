# Teamwork Graph usage

Ship Check reads which Confluence pages are linked to the work items of a release.

Raw Cypher is rejected for Forge apps ("The cypherQuery field is restricted"), so the question is registered once as a persisted query and run by key with `customQuery`.

Register (while logged in to the site, from a browser session, because the endpoint rejects API tokens):

```
POST https://<site>.atlassian.net/gateway/api/twg/cypher-queries
{ "appId": "ari:cloud:ecosystem::app/<your app id>",
  "name": "linked-docs-batch-directed",
  "cypher": "MATCH (p:ConfluencePage)-[:content_entity_links_entity]->(w:JiraWorkItem) WHERE w.ari IN $workItemAris RETURN w, p",
  "paramsSchema": [{ "name": "workItemAris", "type": "JSON", "required": true }] }
```

A second query with the arrow reversed (`(w:JiraWorkItem)-[...]->(p:ConfluencePage)`) is registered as well, because the validator accepts both directions and results from either are merged. Each call returns a `queryKey`; set them as `TWG_QUERY_PAGE_TO_ITEM` and `TWG_QUERY_ITEM_TO_PAGE`.

Results are read through `requestTeamworkGraph` as the invoking user, so they respect that user's permissions. A missing scope returns an empty result, not an error, which is why the app treats "no rows and no error" differently from "error".
