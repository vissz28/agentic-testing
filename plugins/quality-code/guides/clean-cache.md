# The cache only: `/quality-code:clean --cache`

From the arguments of `/quality-code:clean` (without `--cache`). Clears the plugin's own cache. You relay; the script lists and deletes. Plain English, short sentences. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a live checklist, a `###` section with an emoji and the headline row first, tables for lists (at most 8 rows), status marks, and never a code-block card. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer. Keep the person's language as `${CLAUDE_PLUGIN_ROOT}/guides/language.md` says (the saved language is read with `progress.mjs get session`, which this command never clears).

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The script decides.** `clean-cache.mjs` finds and deletes. It only ever touches files inside the plugin's cache folder (`<Claude folder>/quality-code/progress/`), and never a link. Never delete, move or read a file yourself, and never use `rm`.
- **Only the cache.** Your config (`config.json`, or the older `.claude/quality-code.json`), tickets, specs, tests and the audit log are never touched. The cache is recreatable: the next run asks or reads again.
- **Local only.** Nothing is sent anywhere. Run only the script below; no other tool except the picker.
- **The Next line.** The command ends with the Next line from display.md, the one or two likeliest next commands, as code.
- **Never ask for a token**, key or password in the chat.

## Steps

1. **List.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean-cache.mjs" list` and add `--all` when `$ARGUMENTS` has it. Read its `CACHE_JSON:` line and drop it from what you show.
   - Exit 2: show its lines as they are and stop.
   - `files` is 0: `### 🧹 Clean cache` with the headline `**✅ The cache is already empty**`, then the Next line (`/quality-code:clean` for the rest), and stop.
2. **Ask.** With `--yes` in `$ARGUMENTS`, skip to step 3. Otherwise show `### 🧹 Clean cache` with the headline `**N files · X KB to delete**` and a table of what the script printed (scope, files, size; for `--all` one row per project folder, at most 8, then `… and N more`), no code block. Then ask with the picker (`Delete` / `Cancel`, question `Delete the plugin's cache?`) and end the turn.

   `Cancel`, or anything else: `**Nothing was deleted**` and the Next line (`/quality-code:clean --cache`), then stop.
3. **Delete.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean-cache.mjs" delete` with `--all` when `$ARGUMENTS` has it. Exit 2: show its lines and stop. Show `### 🏁 Result` with the headline `**✅ Deleted N files, X KB freed**` (the script's numbers), drop the `CACHE_JSON:` line, add `Your config, tickets and specs were not touched.` in a quote, and the Next line: `/quality-code:clean` or `/quality-code:spec <KEY>`.

## Examples

- `/quality-code:clean --cache` lists this project's cache, asks, then deletes it.
- `/quality-code:clean --cache --all --yes` deletes the cache of every project, without asking.
