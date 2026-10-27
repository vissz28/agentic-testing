---
description: See and change Quality Code's settings, one at a time: the project config (the repo's, or your personal one), where your files and logs are kept (the project repo, this machine, or only the chat), your own plugin settings (Jira email, GitLab, Xray address), and whether each token and key is set (GitLab, Figma, Xray, GitHub), with the steps to set one in /plugin. Every change is checked by a script before it is saved.
model: sonnet
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Shows Quality Code's settings and changes the one you pick. It never reads, scores or comments on a ticket. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Scripts write, never you.** The project config is written only by `setup.mjs`, and the plugin settings only by `connector-settings.mjs`. Both check the value first. Never edit `.claude/quality-code.json`, the personal config or a settings file yourself.
- **Never ask for a token**, key or password in the chat, and never show one. If the user pastes one anyway, do not use it, do not repeat it and do not save it: say `Please don't paste tokens here. Revoke that one and set a new one from /plugin.` and go on.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option.
- **Language.** Talk in the language of the user's messages.

## Steps

1. **Read.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. It prints `ok (<repo|personal>: <path>)`, or the problems. If the config is missing, say `Quality Code is not set up here yet: run /quality-code:setup.` and stop. If the config is broken, show the problems; the plugin settings (items 7 to 9 below) can still be changed. Read the config at that path. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save get` and read its `SAVE_JSON:` line: `place`, `ticketsDir` and `options` (where this person keeps the project's files and logs; see `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`). The plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`, `gitlab_username` is `${user_config.gitlab_username}`, `xray_api_url` is `${user_config.xray_api_url}`.

   **Tokens and keys, without reading them.** A token connector offers tools only when its token is set, so look at which tools this session has. GitLab token: the plugin's `gitlab-token` connector has tools. Figma key: `figma-token` has tools. Xray API key: `xray` offers `get_test_run`. Each one is `✅ set` or `not set`. GitHub: run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --detect` and read `here.github` in its `SETUP_JSON:` line: `✅ <login> (gh)`, or `<reason>`. Leave GitHub off the card when `here.github` is not set (the repo is not on GitHub).
2. **The card.** Show it and end the turn. Show `not set` for an empty value, and leave out item 4 for a personal config:

   ```
   Quality Code settings
   Project · <path> (<repo: shared with your team, commit it | personal: only you, no repo>)
     1. Stack           <adapter and backend: frontend (Playwright) | backend (<Runner>: Vitest, pytest, JUnit, Go or .NET) | fullstack (<Runner> and Playwright); a runner of `runners` in place of its default, for example backend (Jest, generic checks)>
     2. Jira site       <jira.site host>
     3. Jira projects   <jira.projects>
     4. Base branch     <git.base, or "detected">
     5. Tickets folder  <ticketsDir in the config file, or the default; only used when files are kept in the project repo>
   Your files · saved on this computer only, not shared with the team
     6. Files and logs  <in the project repo | on this machine: <ticketsDir> | only in this chat>
   Your accounts · saved on this computer only, not shared with the team
     7. Jira email      <jira_email>
     8. GitLab          <gitlab_api_url host> · <gitlab_username>
     9. Xray address    <xray_api_url>
   Tokens and keys · kept in your keychain, set in /plugin
    10. GitLab token    <✅ set | not set>
    11. Figma key       <✅ set | not set>
    12. Xray API key    <✅ set | not set>
    13. GitHub          <✅ login (gh) | reason>
   Feature labels, QA plans, title prefixes, templates, redaction, test folders: /quality-code:setup advanced.
   Type a number to change it, or stop.
   ```

3. **Change one.** Ask for the new value as below and end the turn. Then write it:
   - **1 to 5 (project).** Ask:
     - Stack: `1. Frontend (Playwright) / 2. Backend (<Runner>) / 3. Fullstack`, `<Runner>` being the backend runner the config already names (`backend` on fullstack, else the adapter; Vitest when there is none); Backend writes that runner's adapter (`vitest`, `pytest`, `junit`, `go` or `dotnet`), Fullstack keeps `backend`.
     - Jira site: an address like `acme.atlassian.net`.
     - Jira projects: keys separated by commas.
     - Base branch: a branch name.
     - Tickets folder: a folder inside the project.

     Build the proposal `{ "config": <the config file exactly as it is, with only that value changed> }`. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'` for a repo config, or `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write-personal '<proposal JSON>'` for a personal one. If it does not print `ok`, show its lines as they are and ask again. If they name a field this card does not set (a stack change can need a `vitest`, `pytest`, `junit`, `go`, `dotnet` or `playwright` block), say `That needs more answers: run /quality-code:setup advanced.` and stop.
   - **6 (files and logs).** Show the card of `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md` (one line per entry of `options`, `(now)` after the current one) and end the turn. On a pick, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save set <repo|local|chat>` and show its `ok:` line as printed: it also moves the files already saved to the new place. Nothing in the project config changes.
   - **7.** Ask `Your Atlassian email?` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --jira-save "<email>"`.
   - **8.** Ask `Your GitLab address? (for example gitlab.example.com)`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --gitlab-check "<address>"`, then ask `Your GitLab username or email?` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --gitlab-save "<address>" "<username or email>"`.
   - **9.** Ask `Xray Cloud's address? (https://xray.cloud.getxray.app, or a regional one like https://eu.xray.cloud.getxray.app)` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --xray-save "<address>"`.

   For 7 to 9, read the `CONNECTOR_SETTINGS_JSON:` line. If it is not `ok`, show its `reason` and ask again.
   - **10 to 12 (tokens and keys).** Never ask for one here: what is typed in the chat is kept in the conversation. Show these steps, with the item's settings and where to get the token, and end the turn:

     ```
     Set it in /plugin, never in the chat (it goes to your keychain):
       1. Type /plugin, choose quality-code, Configure options
       2. Set <settings>: <where to get it>
       3. Type /reload-plugins
     1. Check again
     2. Back
     ```

     | Item | Settings | Where to get it |
     |---|---|---|
     | 10 | `gitlab_token` | a GitLab personal access token with only the `read_api` scope (avatar, Edit profile, Access tokens) |
     | 11 | `figma_api_key` | Figma, Settings, Security, Personal access tokens |
     | 12 | `xray_client_id` and `xray_client_secret` | Xray, API Keys: the Client ID and Client Secret of a key a Jira admin creates |

     `1` looks at that connector's tools again (step 1) and says `✅ set` or `Still not set: did you run /reload-plugins?`. `2` shows the card.
   - **13 (GitHub).** The plugin has no GitHub token: it uses the `gh` sign-in. Say `In a terminal, run gh auth login --hostname <host>, then come back.` with the host from `here.remote.host`, then show `1. Check again / 2. Back` and end the turn. `1` runs `setup.mjs --detect` again.
4. **Done.** Say what changed, in one line, plus:
   - after a repo config change: `Commit .claude/quality-code.json so your team gets it too.`
   - after a plugin setting: `Type /reload-plugins for it to take effect.`
   - after item 6: nothing more; it takes effect on the next run.

   Then show the card again (step 2), with the new value.

## Examples

- `/quality-code:config`: see the settings, then change one
