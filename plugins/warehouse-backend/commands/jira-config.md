---
description: Set or show Jira defaults (cloudId, project) for /jira-* commands
argument-hint: [key=value ...] | show | reset
---

Manage `~/.claude/jira-config.json`. Args: `$ARGUMENTS`

Behavior:

- **No args or `show`** — Read the file if it exists and print it as a table. If missing, say so and offer to run discovery.
- **`reset`** — Delete the file.
- **`discover`** (or no file yet and user says yes) — Call `mcp__atlassian-rovo__getAccessibleAtlassianResources`. If one resource, save its `id` as `cloudId`. If multiple, ask which. Then call `mcp__atlassian-rovo__getVisibleJiraProjects` (with `cloudId`, `searchString: ""`, `action: "view"`) and ask which project key to set as `defaultProject` (or skip).
- **`key=value` pairs** — Merge into the JSON. Recognized keys: `cloudId`, `defaultProject`. Unknown keys still saved but flagged.

File shape:

```json
{
  "cloudId": "…",
  "defaultProject": "ABC"
}
```

Ticket templates are English only: `/ticket` always loads `.gitlab/issue_templates/{Story,Bug}.md`. A `language` key left over in an existing config is ignored.

Write with pretty JSON (2-space indent). Confirm the final state in one line.
