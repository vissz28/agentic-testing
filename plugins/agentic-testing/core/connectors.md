# Connectors check

Shared by `/agentic-testing:setup` (step 0) and `/agentic-testing:start` (step 1). Check, show one card, fix what the user picks. Never ask for a token, key or password in the chat, and never repeat one: personal values live in the plugin settings, which keep secrets in the system keychain. Nothing here is written to `.claude/agentic-testing.json`.

**Which connectors.** Jira (Atlassian) and GitLab always. Figma only when the adapter is `playwright`: read `adapter` from `.claude/agentic-testing.json`; without a config, run `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect` and read `adapter` from its `SETUP_JSON:` line (`both` counts as `playwright`). For `vitest`, leave Figma off the card.

**Check each one with a single read-only call:**

| Connector | Check | ✅ when |
|---|---|---|
| Jira (Atlassian) | `getAccessibleAtlassianResources`, on whichever Atlassian connection is available (the plugin's `atlassian-rovo` or one connected in claude.ai) | it returns at least one site; show its host |
| GitLab | find a GitLab connector tool in this session and make one read-only call with it (the current user, or one project) | the call answers |
| Figma | find a Figma connector tool in this session and make one read-only call with it | the call answers |

A connector whose tools are missing, that asks to sign in, or whose call errors is not ✅. Do not retry a failed call during this check.

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
  - GitLab: "The GitLab address is the `gitlab_mcp_url` plugin setting. Change it from the `/plugin` menu (agentic-testing, configure), then type /mcp to reconnect gitlab." If you know the address the check tried, show it; never show a token.
  - Figma: "The Figma key is the `figma_api_key` plugin setting. Set it from the `/plugin` menu (agentic-testing, configure). Do not paste it here."

  Then show `1. Check again / 2. Continue without it` and end the turn. `1` runs the whole check again.
