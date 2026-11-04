---
description: Read one Quality Code setting, `/quality-code:config-get <key>`: shows its value and which config it comes from. Read-only. A token shows only whether it is set, never the value.
argument-hint: <key> [--personal|--project]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Reads one setting, the same way as `/quality-code:config get <key>`. You relay; the script reads. Plain English, short sentences. Show the result the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a `###` section with an emoji, the bold headline first, the Next line, never a code-block card. Every question is asked with the AskUserQuestion picker as `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says, never as a numbered text card; the text card is only for a client without the tool. Keep the person's language as `${CLAUDE_PLUGIN_ROOT}/guides/language.md` says.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it.
- **Read-only.** Nothing is written. Never read a config or settings file yourself.
- **Never show a token.** For a token or key (`gitlab_token`, `figma_api_key`, `xray_client_id`, `xray_client_secret`, `jira_api_token`) say it is a protected plugin setting, that `/quality-code:config` shows only `set` or `not set`, and that it is changed in `/plugin configure quality-code@teamsystem` (the field name, for GitLab the `read_api` scope, then `/reload-plugins`). Never repeat a value the person typed.

## Steps

1. **With no key,** run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config keys`, drop its `CONFIG_KEYS_JSON:` line, and show the keys in a table `| Key | Takes | Example |` as `/quality-code:config-set` does. Next line: `/quality-code:config-get git.base`. Stop.
2. **Read.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config get <key>` (add `--personal` or `--project` when `$ARGUMENTS` has it). Exit 2: show its error as it is and stop. Otherwise show `### ⚙️ Config`, the headline `**<key>: <value>**` (`not set` when empty) and the source (project or personal) in one line. Drop the `CONFIG_GET_JSON:` line.
3. **Next line:** `/quality-code:config-set <key> <value>`.

## Examples

- `/quality-code:config-get jira.site`
- `/quality-code:config-get git.base --personal`
