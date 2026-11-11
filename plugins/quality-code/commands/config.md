---
description: 'See and change Quality Code''s settings, one at a time: the project config (the repo''s, or your personal one), where your files and logs are kept (the project repo, this machine, or only the chat), your own plugin settings (Jira email, GitLab, Xray address), and whether each token and key is set (GitLab, Figma, Xray, GitHub), with the steps to set one in /plugin. Every change is checked by a script before it is saved.'
argument-hint: '[get <key> | set <key> <value> | keys] [--personal|--project] [--yes]'
model: sonnet
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

Shows Quality Code's settings and changes the one you pick. It never reads, scores or comments on a ticket. Plain English, short sentences, numbered cards. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a section per step, tables, colour marks, and the picker for questions. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **Scripts write, never you.** The project config is written only by `setup.mjs` or `ticket.mjs config set`, and the plugin settings only by `connector-settings.mjs`. Both check the value first. Never edit the project config (`config.json`), the personal config or a settings file yourself.
- **Never ask for a token**, key or password in the chat, and never show one. If the user pastes one anyway, do not use it, do not repeat it and do not save it: say `Please don't paste tokens here. Revoke that one and set a new one from /plugin.` and go on.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option.
- **Language.** Follow `${CLAUDE_PLUGIN_ROOT}/guides/language.md`: keep the person's language, also after a pick or a script's output.

## The quick way: set or get one setting directly

When the person gives `set <key> <value>`, `get <key>` or `keys` (for example `/quality-code:config set jira.projects ABC,DEF`, `config set git.base develop`, `config set ticketsDir .qc/tickets`, `config get jira.site`), skip the cards and do only this:

- **get:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config get <key>` (add `--personal` or `--project` when asked) and show its first line as a headline, `**<key>: <value>**`, then the Next line from display.md (`/quality-code:config set <key> <value>`).
- **keys:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config keys`, drop its `CONFIG_KEYS_JSON:` line, and show `### ⚙️ Settable keys`, the headline `**N settings**` and a table `| Key | Takes | Example |` (at most 8 rows in view, the rest in a `<details>` block as display.md says). Then `> 💡 Tokens, keys and passwords are not set here: /plugin configure quality-code@teamsystem` and the Next line `/quality-code:config set git.base develop`. Stop.
- **set:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config set <key> <value>` (same scope flags) without `--yes`. It prints `<key>: <old> -> <new>` and writes nothing. Show `### ⚙️ Config`, a short bold headline (`**<key> would change**`) and a table `| Setting | Old | New |` from that line, no code block. Ask `Change it?` with the picker (`Yes` / `No`, as display.md says), and on yes run the same command again with `--yes`; on no say `**Nothing was changed**`. If the script says `Nothing to change: already set.`, say `**✅ <key> is already <value>**` and stop. When the person already wrote `--yes`, pass it at once and skip the question.
- **Keys:** dotted, lists with commas, `true`/`false` and numbers typed: `jira.site`, `jira.projects`, `jira.trackingProjects`, `jira.bugTypes`, `jira.doneStatuses`, `jira.acceptanceCriteriaField`, `git.base`, `root`, `ticketsDir`, `testStyle`, `languages`, `titlePrefixes`, `qa.app`, `qa.sprint`, `qa.executionTypes`, `qa.statuses.ko|ready|done`, `qa.blockedStop`, `qa.autoPass`, and `place` (files and logs: `repo`, `local` or `chat`). `none` removes an optional one. The script checks the value with the rules the setup writers use and prints a clear error, with nothing written, for an unknown key, a bad value, or anything that looks like a token or key; show the error as it is and stop.
- **Scope:** `--personal` or `--project`; with neither, the config that exists (the repo's first).
- **Not here:** tokens, keys, passwords and the plugin settings (Jira email, GitLab address and username, Xray address) are never set this way. For those say `Set it in /plugin, never in the chat: type /plugin, choose quality-code, Configure options, then /reload-plugins.`
- End with the headline `**✅ <key> changed**` and the step 4 line for what changed (commit the repo config), then the Next line from display.md (`/quality-code:config get <key>`, or the command the change makes likely). Do not show the card again.

## Steps

1. **Read.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. It prints `ok (<repo|personal>: <path>)`, or the problems. If the config is missing, show the **Not set up** card of the display guide. If the config is broken, show the problems; the plugin settings (items 8 to 10 below) can still be changed. Read the config at that path. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save get` and read its `SAVE_JSON:` line: `place`, `ticketsDir` and `options` (where this person keeps the project's files and logs; see `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`). The plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`, `gitlab_username` is `${user_config.gitlab_username}`, `xray_api_url` is `${user_config.xray_api_url}`.

   **Tokens and keys, without reading them.** A token connector offers tools only when its token is set, so look at which tools this session has. GitLab token: the plugin's `gitlab-token` connector has tools. Figma key: `figma-token` has tools. Xray API key: `xray` offers `get_test_run`. Each one is `✅ set` or `not set`. GitHub: run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --detect` and read `here.github` in its `SETUP_JSON:` line: `✅ <login> (gh)`, or `<reason>`. Leave GitHub off the card when `here.github` is not set (the repo is not on GitHub). For a repo config, run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --style` and read `report` in its `CONNECTOR_SETTINGS_JSON:` line.
2. **The card.** Start with a short summary and end the turn: one line per section with only what is worth a glance (stack, Jira projects, base branch, where files are kept, which tokens are not set), then this line: `Type a number or the name of a setting, "all" for every setting, or stop. The quick way: /quality-code:config set <key> <value>, for example set git.base develop.` The full card below is shown when the person types `all` or asks for a section. The full card: show `not set` for an empty value, and leave out items 4 and 15 (and the Replies line) for a personal config:

   ```
   Quality Code settings
   Project · <path> (<repo: shared with your team, commit it | personal: only you, no repo>)
     1. Stack           <adapter and backend: frontend (Playwright) | backend (<Runner>: Vitest, pytest, JUnit, Go or .NET) | fullstack (<Runner> and Playwright); a runner of `runners` in place of its default, for example backend (Jest, generic checks)>
     2. Jira site       <jira.site host>
     3. Jira projects   <jira.projects>
     4. Base branch     <git.base, or "detected">
     5. Tickets folder  <ticketsDir in the config file, or the default; only used when files are kept in the project repo>
     6. Test style       <like your existing tests (<pattern>) | the Quality Code way>
   Your files · saved on this computer only, not shared with the team
     7. Files and logs  <in the project repo | on this machine: <ticketsDir> | only in this chat>
   Your accounts · saved on this computer only, not shared with the team
     8. Jira email      <jira_email>
     9. GitLab          <gitlab_api_url host> · <gitlab_username>
     10. Xray address    <xray_api_url>
   Tokens and keys · kept in your keychain, set in /plugin
    11. GitLab token    <✅ set | not set>
    12. Figma key       <✅ set | not set>
    13. Xray API key    <✅ set | not set>
    14. GitHub          <✅ login (gh) | reason>
   Replies · in .claude/settings.json, shared with your team, commit it
    15. Reply style     <report: results only, no step-by-step lines | Claude Code's default>
   QA runs · in the project config (/quality-code:qa)
    16. QA runs         <qa.app, or "asked each run"> · failed status <qa.statuses.ko, or "detected"> · ready <qa.statuses.ready, or "not set"> · <qa.executionTypes, or "Xray's"> · <open sprint | any sprint><, auto-pass when on>
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
   - **6 (test style).** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config flow` and say its first line. Show this card and end the turn, `(now)` after the one in force:

     ```
     Where should new tests go, and how should they be named?
     1. Like your existing tests: same folders, names and tools (recommended)
     2. The Quality Code way: its own folders, the ticket key in each file name
     3. Both: every test is written twice
     ```

     Build the proposal `{ "config": <the config file exactly as it is, with only testStyle set to "project", "quality-code" or "both"> }` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'` (`--write-personal` for a personal config). A personal config has no tests of its own: say `Tests are written from a repo: set this there.` and stop. For one run only, `/quality-code:spec <KEY> --style project|quality-code|both`.
   - **7 (files and logs).** Show the card of `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md` (one line per entry of `options`, `(now)` after the current one) and end the turn. On a pick, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save set <repo|local|chat>` and show its `ok:` line as printed: it also moves the files already saved to the new place. Nothing in the project config changes.
   - **8.** Ask `Your Atlassian email?` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --jira-save "<email>"`.
   - **9.** Ask `Your GitLab address? (for example gitlab.example.com)`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --gitlab-check "<address>"`, then ask `Your GitLab username or email?` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --gitlab-save "<address>" "<username or email>"`.
   - **10.** Ask `Xray Cloud's address? (https://xray.cloud.getxray.app, or a regional one like https://eu.xray.cloud.getxray.app)` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --xray-save "<address>"`.

   For 8 to 10, read the `CONNECTOR_SETTINGS_JSON:` line. If it is not `ok`, show its `reason` and ask again.
   - **16 (QA runs).** Ask which one, and end the turn:

     ```
     Which QA setting?
     1. The app address to test
     2. The names of your statuses (failed, ready to test, done)
     3. The issue types of a test execution, and the sprint
     4. Auto-pass and when to stop
     ```

     Then ask for the value: `1` an address starting with `http://` or `https://` (`none` removes it); `2` the status names `TEST KO`, `Ready to test` and `Done` as they are in Jira (any of them can be left empty); `3` the issue types of your test execution separated by commas (like `Test Execution, Sub Test Execution`), then `open sprint or any?`; `4` `Record a test the agent finds passing without asking? yes or no`, then `Stop after how many blocked tests in a row? (0 never, 2 is the default)`. Build the proposal `{ "config": <the config file exactly as it is, with only its qa block changed> }` and run `node "${CLAUDE_PLUGIN_ROOT}/bin/setup.mjs" --write '<proposal JSON>'` (`--write-personal` for a personal config). If it does not print `ok`, show its errors and ask again. Nothing else in the file changes.
   - **11 to 13 (tokens and keys).** Never ask for one here: what is typed in the chat is kept in the conversation. Show these steps, with the item's settings and where to get the token, and end the turn:

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
     | 11 | `gitlab_token` | a GitLab personal access token with only the `read_api` scope (avatar, Edit profile, Access tokens) |
     | 12 | `figma_api_key` | Figma, Settings, Security, Personal access tokens |
     | 13 | `xray_client_id` and `xray_client_secret` | Xray, API Keys: the Client ID and Client Secret of a key a Jira admin creates |

     `1` looks at that connector's tools again (step 1) and says `✅ set` or `Still not set: did you run /reload-plugins?`. `2` shows the card.
   - **15 (reply style).** Show this card and end the turn, `(now)` after the one in force:

     ```
     How should Claude write while Quality Code runs?
     1. Report: results only, no step-by-step lines
     2. Claude Code's default
     ```

     Run `node "${CLAUDE_PLUGIN_ROOT}/bin/connector-settings.mjs" --style on` (`1`) or `--style off` (`2`) and read its `CONNECTOR_SETTINGS_JSON:` line. If it is not `ok`, show its `reason` and stop. When `local` is set and `report` does not match the pick, add `Your own choice on this computer (<local>, in .claude/settings.local.json) still wins here: run /output-style to change it.`
   - **14 (GitHub).** The plugin has no GitHub token: it uses the `gh` sign-in. Say `In a terminal, run gh auth login --hostname <host>, then come back.` with the host from `here.remote.host`, then show `1. Check again / 2. Back` and end the turn. `1` runs `setup.mjs --detect` again.
4. **Done.** Say what changed, in one line, plus:
   - after a repo config change: `The config stays on this machine, outside git. To share it with your team, copy `config.json` into the repo yourself.`
   - after a plugin setting: `Type /reload-plugins for it to take effect.`
   - after item 6 or 7: nothing more; it takes effect on the next run.
   - after item 15: `Commit .claude/settings.json so your team gets it too. It applies from your next message.`
   - after item 16: the repo config line above; it applies from the next `/quality-code:qa` run.

   Then show the short summary again (step 2) with the new value, and the full card only if the person asked for `all`.

## Examples

- `/quality-code:config`: see the settings, then change one
