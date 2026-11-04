---
description: Change one Quality Code setting directly, `/quality-code:config-set <key> <value>`: shows `old -> new`, asks one yes, then a script checks and saves it. With no arguments it lists the settable keys with an example each. Tokens are never set here.
argument-hint: <key> <value> [--personal|--project] [--yes]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: sonnet
---

Changes one setting, the same way as `/quality-code:config set <key> <value>`. You relay; the script checks and writes. Plain English, short sentences. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a `###` section with an emoji, the bold headline first, a table, the Next line, never a code-block card. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every question and wait for the answer. Keep the person's language as `${CLAUDE_PLUGIN_ROOT}/guides/language.md` says, also after a pick or a script's output.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code.
- **Scripts write, never you.** Only `ticket.mjs config set` writes. Never edit `.claude/quality-code.json`, the personal config or a settings file yourself.
- **Never ask for a token**, key or password, and never show one. If the person pastes one anyway, do not use it, do not repeat it and do not save it: say `Please don't paste tokens here. Revoke that one and set a new one from /plugin.` and go on.
- **An error writes nothing.** The script prints a clear error for an unknown key, a bad value, a token, or anything that looks like a secret: show it as it is, as a short `**❌ Not changed**` section, and stop. Never retry with another value yourself.

## Steps

1. **No arguments.** When `$ARGUMENTS` is empty, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config keys`, read its `CONFIG_KEYS_JSON:` line and drop it from what you show. Show `### ⚙️ Settable keys`, the headline `**N settings**`, and a table `| Key | Takes | Example |` with one row per key (at most 8 rows in view, the rest in a `<details>` block as display.md says, `All N keys`). Then a quote: `> 💡 Tokens, keys and passwords are not set here: /plugin configure quality-code@teamsystem`. End with the Next line: `/quality-code:config-set git.base develop`. Stop.
2. **A token or plugin setting.** When the key is a token or a plugin setting (`gitlab_token`, `figma_api_key`, `xray_client_id`, `xray_client_secret`, `jira_api_token`, `jira_email`, `gitlab_username`, `gitlab_api_url`, `xray_api_url`, or any key with `token`, `secret`, `password` or `key` in its name), never run `config set` with the value and never repeat a value the person typed. Say it yourself. Show `### 🔒 Protected setting` and the headline `**<key> is a protected plugin setting**`, then the exact steps as a numbered list:
   1. Type `/plugin configure quality-code@teamsystem`
   2. Set the field `<field>`: where to get it (GitLab: `gitlab_token`, a personal access token with only the `read_api` scope: avatar, Edit profile, Access tokens; Figma: `figma_api_key`, Settings, Security, Personal access tokens; Xray: `xray_client_id` and `xray_client_secret`, Xray, API Keys; Jira email, GitLab username and address, Xray address: `jira_email`, `gitlab_username`, `gitlab_api_url`, `xray_api_url`, not secret; GitHub has no field, run `gh auth login`)
   3. Type `/reload-plugins`

   Then a quote: `> 💡 /quality-code:config shows only set or not set for a token, never the value.` The Next line: `/quality-code:config`. Stop.
3. **Preview.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config set <key> <value>` with `--personal` or `--project` when `$ARGUMENTS` has it, and without `--yes`. It prints `<key>: <old> -> <new>` and writes nothing. Exit 2: show its error and stop (rule above). Otherwise show `### ⚙️ Config`, the headline `**<key> would change**` and a table `| Setting | Old | New |` from that line. If the script says `Nothing to change: already set.`, the headline is `**✅ <key> is already <value>**`, then the Next line, and stop.
4. **Ask.** With `--yes` in `$ARGUMENTS`, pass `--yes` at step 3 and skip to step 5. Otherwise ask `Change it?` with the picker (`Yes` / `No`) and end the turn. `No`, or anything else: `**Nothing was changed**` and the Next line (`/quality-code:config-set`), then stop.
5. **Write.** Run the same command again with `--yes`. Exit 2: show its error, `**❌ Not saved**`, and stop. Otherwise show `**✅ <key> changed**`, then one line: after a repo config change `Commit .claude/quality-code.json so your team gets it too.`; after `place` nothing more. The Next line: `/quality-code:config-get <key>`.

## Examples

- `/quality-code:config-set git.base develop`: preview, one yes, saved.
- `/quality-code:config-set jira.projects ABC,DEF --yes`: saved without asking.
- `/quality-code:config-set ticketsDir none --personal`: removes the optional setting from your personal config.
- `/quality-code:config-set gitlab_token`: shows the `/plugin` steps; the token is never typed here.
- `/quality-code:config-set`: lists the settable keys.
