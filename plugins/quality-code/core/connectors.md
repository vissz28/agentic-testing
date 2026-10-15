# Connectors check

Shared by `/quality-code:setup` (step 0) and `/quality-code:start` (step 1). Check, show one card, fix what the user picks. Never ask for a token, key or password in the chat, and never repeat one: personal values live in the plugin settings, which keep secrets in the system keychain. Nothing here is written to `.claude/quality-code.json`.

**What may be asked in the chat.** Only what is not secret: your Jira email, your GitLab address, your GitLab username or email. Save them with `node "${CLAUDE_PLUGIN_ROOT}/core/connector-settings.mjs"` (below), never by editing a settings file yourself. A token is set only in the `/plugin` dialog (quality-code, configure), which hides it and stores it in the keychain. If the user pastes a token in the chat anyway, do not use it, do not repeat it and do not save it: say `Please don't paste tokens here. Revoke that one and set a new one from /plugin.` and go on.

**Values from the plugin settings.** The command that sent you here gives `jira_email`, `gitlab_username` and `gitlab_api_url` (each empty when not set).

**Which connectors.** Jira (Atlassian) and GitLab always. Figma only when the adapter is `playwright`: read `adapter` from `.claude/quality-code.json`; without a config, run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read `adapter` from its `SETUP_JSON:` line (`both` counts as `playwright`). For `vitest`, leave Figma off the card.

**Check each one with read-only calls:**

| Connector | Check | ✅ when |
|---|---|---|
| Jira (Atlassian) | `getAccessibleAtlassianResources`, then `atlassianUserInfo`, on whichever Atlassian connection is available (the plugin's `atlassian-rovo` or one connected in claude.ai) | it returns at least one site |
| GitLab | find the tools of the `gitlab` connector (browser sign-in, GitLab's own MCP server at `<gitlab_api_url>/mcp`) and of `gitlab-token` (token); make one read-only call with each that is present: the current user | either connector answers |
| Figma | find the tools of the `figma` connector (browser sign-in) and of `figma-token` (token); make one read-only call with each that is present: the current user (whoami) | either connector answers |

A connector whose tools are missing, that asks to sign in, or whose call errors is not ✅. Do not retry a failed call during this check. GitLab and Figma each have two ways in and need only one: the unused one stays disconnected, and that is fine; show the service as ✅ and do not mention the other.

**Who is signed in.** Each line shows the account, so nobody works under someone else's sign-in by mistake.

- **Jira.** The site is the project's `jira.site` from `.claude/quality-code.json` (without a config: the first accessible site). Not among the accessible sites: ⚠️ `this account cannot see <site host>`. Compare `jira_email` with the email `atlassianUserInfo` returned, ignoring case. Same, or no `jira_email`: the line shows `<email> on <site host>`. Different: ⚠️ `signed in as <actual>, not <jira_email>`.
- **GitLab.** Compare `gitlab_username` (a username, with or without `@`, or an email) with the username and the email the current-user call returned, ignoring case. Same, or no `gitlab_username`: the line shows `<username> on <host>`. Different: ⚠️ `signed in as <actual>, not <gitlab_username>`. A token that belongs to <actual>, not <gitlab_username> is never used silently.
- **Figma.** Show the handle or email the current-user call returned. Nothing to compare.

**When everything is set up, say so in one line.** Every service ✅: show only that line and go on, with no card:

```
Connectors: ✅ Jira <email> on <site host> · ✅ GitLab <username> on <host>
```

(plus `· ✅ Figma <account>` when Figma is on the card). From `start`, `write` and `seed`, an optional service that is not ✅ does not stop either: add it to the line as `· ⚠️ GitLab <one-line reason> (fix: /quality-code:setup)` and go on. Only Jira not ✅ stops the command (the Jira card below). `setup` is where connectors are fixed: there, whenever a service is not ✅, show the card.

**The card.** Show it and end the turn:

```
Connectors
  ✅ Jira (Atlassian)   <email> on <site host>
  ✅ GitLab             <username> on <host>
  ⚠️ GitLab             <one-line reason>; optional now, needed later for merge-request links
  ➖ Figma              <one-line reason>; optional, used for frontend design comparison
1. Continue
2. Fix one first
```

✅ connected, ⚠️ configured but failing, ➖ not set up or not available. Each service gets one line: the ✅ form or the ⚠️ / ➖ form.

- **Jira not ✅** (no site, or the account check failed). Show this card instead, with no way to continue, and end the turn:

  ```
  Jira is required. Type /mcp, choose atlassian-rovo and sign in (or connect Atlassian in claude.ai).
  1. Check again
  2. Set my Jira email
  3. Stop
  ```

  `1` runs this check again. `2` runs the Jira fix below. `3` stops the command. Never go past this card without Jira.
- **1. Continue:** go on. GitLab and Figma never block.
- **2. Fix one first:** list the connectors that are not ✅ as a numbered card, end the turn, and run the fix for the one picked. Each fix asks one question per turn and ends the turn after it.

**Jira fix.**
1. Ask: `Your Atlassian email? (the one you sign in to Jira with)` and end the turn.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/core/connector-settings.mjs" --jira-save "<email>"` and read its `CONNECTOR_SETTINGS_JSON:` line. Not `ok`: show its `reason` and ask again.
3. Say: `Saved. Type /reload-plugins, then /mcp, choose atlassian-rovo and sign in with <email> (or connect Atlassian in claude.ai).` Then show `1. Check again / 2. Stop` and end the turn.

**GitLab fix.** Two ways; ask which first (`1. Browser sign-in / 2. Token`) and end the turn.

1. **Browser sign-in**, like Jira: type /mcp, choose `gitlab` and sign in in the browser. There is no application to create and nothing to set: the connector is GitLab's own MCP server at `<gitlab_api_url>/mcp` (for example `https://gitlab.example.com/api/v4/mcp`), and it registers itself when you sign in. If the check says the server was not found (a 404, or `gitlab` never offers a sign-in), your GitLab does not have its MCP server switched on yet: ask a GitLab admin to allow MCP server access (GitLab 19.5 or later, any tier), and use the token way until then.
2. **Token.**
   1. Ask: `Your GitLab address? (for example gitlab.example.com)`; when `gitlab_api_url` is set, offer it as `1. <its host>` and `2. Another address`. End the turn.
   2. Run `node "${CLAUDE_PLUGIN_ROOT}/core/connector-settings.mjs" --gitlab-check "<address>"`. Not `ok`: show its `reason` and ask again.
   3. Ask: `Your GitLab username or email?` and end the turn.
   4. Run `node "${CLAUDE_PLUGIN_ROOT}/core/connector-settings.mjs" --gitlab-save "<address>" "<username or email>"`. Not `ok`: show its `reason` and ask again.
   5. Say, as one block: `Saved <apiUrl> and <username>. Now the token, the only step outside the chat: create a GitLab personal access token with only the read_api scope (avatar, Edit profile, Access tokens). Type /plugin, choose quality-code, Configure options, and set `gitlab_token`. Do not paste it here. Then type /reload-plugins, then /mcp and reconnect gitlab-token.` Then show `1. Check again / 2. Continue without it` and end the turn.

The plugin only ever calls GitLab's read operations.

**Figma fix.** Two ways; ask which first (`1. Browser sign-in / 2. Token`) and end the turn.

1. **Browser sign-in.** Type /mcp, choose `figma` and sign in in the browser.
2. **Token.** Nothing to ask in the chat. Say: `Create a Figma personal access token (Figma, Settings, Security, Personal access tokens). Type /plugin, choose quality-code, Configure options, and set `figma_api_key`. Do not paste it here. Then type /reload-plugins, then /mcp and reconnect figma-token.`

Then show `1. Check again / 2. Continue without it` and end the turn. `1` runs the whole check again.
