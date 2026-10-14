# Connectors check

Shared by `/quality-code:setup` (step 0) and `/quality-code:start` (step 1). Check, show one card, fix what the user picks. Never ask for a token, key or password in the chat, and never repeat one: personal values live in the plugin settings, which keep secrets in the system keychain. Nothing here is written to `.claude/quality-code.json`.

**Which connectors.** Jira (Atlassian) and GitLab always. Figma only when the adapter is `playwright`: read `adapter` from `.claude/quality-code.json`; without a config, run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read `adapter` from its `SETUP_JSON:` line (`both` counts as `playwright`). For `vitest`, leave Figma off the card.

**Check each one with a single read-only call:**

| Connector | Check | ✅ when |
|---|---|---|
| Jira (Atlassian) | `getAccessibleAtlassianResources`, on whichever Atlassian connection is available (the plugin's `atlassian-rovo` or one connected in claude.ai) | it returns at least one site; show its host |
| GitLab | find the tools of the `gitlab` connector (browser sign-in, GitLab's own MCP server at `<gitlab_api_url>/mcp`) and of `gitlab-token` (token); make one read-only call with each that is present: the current user | either connector answers |
| Figma | find the tools of the `figma` connector (browser sign-in) and of `figma-token` (token); make one read-only call with each that is present | either connector answers |

A connector whose tools are missing, that asks to sign in, or whose call errors is not ✅. Do not retry a failed call during this check. GitLab and Figma each have two ways in and need only one: the unused one stays disconnected, and that is fine; show the service as ✅ and do not mention the other.

**Who is signed in to GitLab.** The command that sent you here gives the `gitlab_username` from the plugin settings (empty when not set). Compare it, ignoring case and a leading `@`, with the username the current-user call returned. Same, or no `gitlab_username`: ✅, and the line shows `<username> on <host>`. Different: ⚠️ `signed in as <actual>, not <gitlab_username>`; the fix is to sign in with your own account or token, or to correct `gitlab_username`. A token that belongs to <actual>, not <gitlab_username> is never used silently.

**The card.** Show it and end the turn:

```
Connectors
  ✅ Jira (Atlassian)   <site host>
  ✅ GitLab             <username> on <host>
  ⚠️ GitLab             <one-line reason>; optional now, needed later for merge-request links
  ➖ Figma              <one-line reason>; optional, used for frontend design comparison
1. Continue
2. Fix one first
```

✅ connected, ⚠️ configured but failing, ➖ not set up or not available. GitLab gets one line: the ✅ form or the ⚠️ form.

- **Jira not ✅.** Show this card instead, with no way to continue, and end the turn:

  ```
  Jira is required. Type /mcp, choose atlassian-rovo and sign in (or connect Atlassian in claude.ai).
  1. Check again
  2. Stop
  ```

  `1` runs this check again. `2` stops the command. Never go past this card without Jira.
- **1. Continue:** go on. GitLab and Figma never block.
- **2. Fix one first:** list the connectors that are not ✅ as a numbered card, end the turn, and show the fix for the one picked:
  - Jira: the sign-in line above.
  - GitLab, two ways; the user picks one:
    1. **Browser sign-in**, like Jira: type /mcp, choose `gitlab` and sign in in the browser. There is no application to create and nothing to set: the connector is GitLab's own MCP server at `<gitlab_api_url>/mcp` (for example `https://gitlab.example.com/api/v4/mcp`), and it registers itself when you sign in. If the check says the server was not found (a 404, or `gitlab` never offers a sign-in), your GitLab does not have its MCP server switched on yet: ask a GitLab admin to allow MCP server access (GitLab 19.5 or later, any tier), and use the token way until then.
    2. **Token.** Create a GitLab personal access token with only the `read_api` scope and set it as `gitlab_token` from the `/plugin` menu (quality-code, configure). Do not paste it here. Set `gitlab_username` there too, so the check can confirm the token is yours. Then type /mcp and reconnect `gitlab-token`.

    Both use `gitlab_api_url` (your GitLab's address ending in `/api/v4`, no `/` at the end); if the check failed with "not found", that setting is the first thing to check. The plugin only ever calls GitLab's read operations.
  - Figma, two ways; the user picks one:
    1. **Browser sign-in.** Type /mcp, choose `figma` and sign in in the browser.
    2. **Token.** Create a Figma personal access token and set it as `figma_api_key` from the `/plugin` menu (quality-code, configure). Do not paste it here. Then type /mcp and reconnect `figma-token`.

  Then show `1. Check again / 2. Continue without it` and end the turn. `1` runs the whole check again.
