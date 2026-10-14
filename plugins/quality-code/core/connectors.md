# Connectors check

Shared by `/quality-code:setup` (step 0) and `/quality-code:start` (step 1). Check, show one card, fix what the user picks. Never ask for a token, key or password in the chat, and never repeat one: personal values live in the plugin settings, which keep secrets in the system keychain. Nothing here is written to `.claude/quality-code.json`.

**Which connectors.** Jira (Atlassian) and GitLab always. Figma only when the adapter is `playwright`: read `adapter` from `.claude/quality-code.json`; without a config, run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read `adapter` from its `SETUP_JSON:` line (`both` counts as `playwright`). For `vitest`, leave Figma off the card.

**Check each one with a single read-only call:**

| Connector | Check | ✅ when |
|---|---|---|
| Jira (Atlassian) | `getAccessibleAtlassianResources`, on whichever Atlassian connection is available (the plugin's `atlassian-rovo` or one connected in claude.ai) | it returns at least one site; show its host |
| GitLab | find the tools of the `gitlab` connector (browser sign-in) and of `gitlab-token` (token); make one read-only call with each that is present (the current user, or one project) | either connector answers |
| Figma | find the tools of the `figma` connector (browser sign-in) and of `figma-token` (token); make one read-only call with each that is present | either connector answers |

A connector whose tools are missing, that asks to sign in, or whose call errors is not ✅. Do not retry a failed call during this check. GitLab and Figma each have two ways in and need only one: the unused one stays disconnected, and that is fine; show the service as ✅ and do not mention the other.

**The card.** Show it and end the turn:

```
Connectors
  ✅ Jira (Atlassian)   <site host>
  ⚠️ GitLab             <one-line reason>; optional now, needed later for merge-request links
  ➖ Figma              <one-line reason>; optional, used for frontend design comparison
1. Continue
2. Fix one first
```

✅ connected, ⚠️ configured but failing, ➖ not set up or not available.

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
    1. **Browser sign-in.** Set `gitlab_oauth_client_id` from the `/plugin` menu (quality-code, configure): the Application ID of a public (not confidential) GitLab application with redirect URI `http://127.0.0.1:8888/callback` and the `read_api` scope, created under GitLab Settings > Applications (one person can create it and share the ID). Then type /mcp, choose `gitlab` and sign in in the browser.
    2. **Token.** Create a GitLab personal access token with only the `read_api` scope and set it as `gitlab_token` from the `/plugin` menu (quality-code, configure). Do not paste it here. Then type /mcp and reconnect `gitlab-token`.

    Both use `gitlab_api_url` (your GitLab's address ending in `/api/v4`); if the check failed with "not found", that setting is the first thing to check. Both connectors only read.
  - Figma, two ways; the user picks one:
    1. **Browser sign-in.** Type /mcp, choose `figma` and sign in in the browser.
    2. **Token.** Create a Figma personal access token and set it as `figma_api_key` from the `/plugin` menu (quality-code, configure). Do not paste it here. Then type /mcp and reconnect `figma-token`.

  Then show `1. Check again / 2. Continue without it` and end the turn. `1` runs the whole check again.
