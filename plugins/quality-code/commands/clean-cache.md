---
description: Delete the plugin's local cache on this machine (the saved "where I stopped" answers, the reused project facts and the saved language) for this project, or for every project with --all. Never touches your config, tickets or specs.
argument-hint: [--all] [--yes]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Clears the plugin's own cache. You relay; the script lists and deletes. Plain English, short sentences. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a section per step, tables, colour marks, and the picker for questions. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer. Keep the person's language as `${CLAUDE_PLUGIN_ROOT}/guides/language.md` says (the saved language is read with `progress.mjs get session`, which this command never clears).

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `clean-cache.mjs` finds and deletes. It only ever touches files inside the plugin's cache folder (`<Claude folder>/quality-code/progress/`), and never a link. Never delete, move or read a file yourself, and never use `rm`.
- **Only the cache.** Your config (`.claude/quality-code.json`), tickets, specs, tests and the audit log are never touched. The cache is recreatable: the next run asks or reads again.
- **Local only.** Nothing is sent anywhere. Run only the script below; no other tool except the picker.
- **Never ask for a token**, key or password in the chat.

## Steps

1. **List.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean-cache.mjs" list` and add `--all` when `$ARGUMENTS` has it. Read its `CACHE_JSON:` line and drop it from what you show.
   - Exit 2: show its lines as they are and stop.
   - `files` is 0: say the cache is already empty, in one line, and stop.
2. **Ask.** With `--yes` in `$ARGUMENTS`, skip to step 3. Otherwise show a short card (what the script printed: scope, number of files, size, and for `--all` one row per project folder), then ask with the picker and end the turn:

   ```
   Delete the plugin's cache?
   1. Delete
   2. Cancel
   ```

   `2`, or anything else: say nothing was deleted and stop.
3. **Delete.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean-cache.mjs" delete` with `--all` when `$ARGUMENTS` has it. Exit 2: show its lines and stop. Show what it printed (how many files and how much space), drop the `CACHE_JSON:` line, and add: `Your config, tickets and specs were not touched.`

## Examples

- `/quality-code:clean-cache` lists this project's cache, asks, then deletes it.
- `/quality-code:clean-cache --all --yes` deletes the cache of every project, without asking.
