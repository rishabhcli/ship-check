# Ship Check privacy statement

Ship Check is a Forge app that runs on Atlassian infrastructure. It has no servers of its own.

- **What it reads:** Jira issues, versions and issue links, and Teamwork Graph relationships between Jira work items and Confluence pages, always as the user who opens the page or invokes the agent, so Jira and Confluence permissions apply.
- **What it stores:** one record per project and version in Forge key-value storage with the time of the last check, the verdict, the score and the issue keys that were open. It does not store names, email addresses, issue descriptions or comments.
- **What it writes:** only when a user explicitly asks it to post a readiness note, it adds one comment to the Jira issue they name.
- **What it sends elsewhere:** nothing. The app declares no external network egress.
- **Deletion:** uninstalling the app removes its Forge storage.

Contact: open an issue at https://github.com/rishabhcli/ship-check/issues
