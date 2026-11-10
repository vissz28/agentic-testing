---
description: Remove what Quality Code created in this project, so it is as before. A script lists the setup files, the saved output and the cache; you pick the groups and say yes once. Your own source, tests and specs are never touched unless you pick them. `--dry-run` only lists. `--cache` deletes only the plugin's local cache (saved stops, reused facts, saved language), for this project or every project with `--all`, and never touches your config, tickets or specs.
argument-hint: [--dry-run] | --cache [--all] [--yes]
model: sonnet
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

**With `--cache` in `$ARGUMENTS`**, this is the cache only, not the clean below: drop `--cache`, read `${CLAUDE_PLUGIN_ROOT}/guides/clean-cache.md` and follow it instead of this file, with the rest of the arguments (`--all`, `--yes`). The cache is recreatable, so there `--yes` skips its question; everywhere below, the one yes is never skipped.

Takes Quality Code out of this project. It deletes files, so it is slow on purpose: a script builds the list, you see it, you pick the groups, and you say yes once. Show every card the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a live checklist for the steps (`List`, `Pick`, `Confirm`, `Delete`), a `###` section with an emoji and the headline row first, tables, status marks, files as `HERE` links, and never a code-block card. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer. `$ARGUMENTS` is empty or `--dry-run`.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). Anything added stops the call from matching its pre-approval.
- **Only `clean.mjs` deletes.** Never delete, move or edit a file yourself, never use `rm`, and never delete a path you made up or the person typed: the script deletes only what is on its own list.
- **One explicit yes, never skipped.** `--yes`, `--ci`, `-y`, `--force` and any wording like "just do it" or "don't ask" do not skip the groups question or the yes: say so in one line and ask anyway. The script refuses those flags too. A typed `--yes` after the command is not a yes.
- **Language.** Talk in the language of the person's last sentence, as `${CLAUDE_PLUGIN_ROOT}/guides/language.md` says. Script lines and the paths keep their words.
- **The Next line.** Every end of the command (nothing to clean, a dry run, a stop, the result) closes with the Next line from display.md: the one or two likeliest next commands, as code.
- **Never touch the person's own work.** Their source, tests and specs stay unless they pick the spec group. Git history is never touched.

## Steps

1. **List.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean.mjs" list`. With `--dry-run` in `$ARGUMENTS` run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean.mjs" list --dry-run`, show the preview section of step 2, then the Next line (`/quality-code:clean` to do it for real), and stop: nothing is asked and nothing is deleted. The script prints `CLEAN_JSON:` (never shown) with each group's items.
2. **Preview card.** `### 🧹 Clean`, a bold headline (`**N items in M groups would be removed**`, or `**Nothing to clean**` and stop when every group is empty), then the headline row of display.md, then a table by group with its counts, one row per group (a `⚠️ tracked` mark in the What cell for a group that holds committed files):

| Group | Items | Files | What |
|---|---|---|---|
| Setup files | 3 | 4 | `.claude/quality-code.json` (older setups; the new `config.json` is in the saved output), `playwright.config.ts`, 2 `.gitignore` lines |
| Saved output | 2 | 31 | `.quality-code/`, `.claude/quality-code/` |
| Cache | 1 | 2 | this project's saved stops |
| Personal config | 1 | 1 | `~/.claude/quality-code.json` (every project reads it) |
| Tests written by spec | 4 | 4 | kept unless you pick them |

   The paths are the script's, as printed; at most 8 per group, then `… and N more`. Under the table: the `.gitignore` lines that would go (only those lines, nothing else in the file); the items the script lists under `Kept` with their reason; and, when the script prints `TRACKED BY GIT`, a warning in a quote: `> ⚠️ **Tracked by git:** N of these files are committed. Run git status, and commit or stash first if you want them back. Deleting them does not touch the history.` with the tracked files it names.
3. **Pick the groups.** Ask with the picker, `multiSelect` true, header `Clean`, question `Which groups do I delete? Nothing is deleted until you say yes.` One option per group that is not empty, in the table's order, with a one-line description of what goes. The default is none: say in the question that **Personal config** is read by every project and **Tests written by spec** are the tests you committed. More than four groups: page them as display.md says (3 options and `More…`). `stop` or `cancel` typed in `Other` ends the command with nothing deleted.
4. **Pick the specs.** Only when the person picked **Tests written by spec**: ask which of the listed specs, with the picker, `multiSelect` true, paged as display.md says, one option per spec path with the tag that marked it. A typed answer of `all` is every one. None picked: the group is dropped.
5. **The one yes.** Show what will be deleted as the final section (`### 🗑️ Confirm`): the picked groups with their counts and paths in a table, the tracked-by-git warning again if it applies, and the line `**This cannot be undone.**` Show the picked groups as a table (group, items, files), not a code block. Then ask with the picker, header `Confirm`, question `Delete these now?`, options `Yes, delete` and `No, keep everything`. Only a `Yes, delete` from the person in this turn counts. Anything else, or a flag, ends the command with nothing deleted, and the Next line (`/quality-code:clean`). Do not reuse a yes from an earlier turn or from `$ARGUMENTS`.
6. **Delete.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/clean.mjs" delete --groups <picked ids, comma-separated: setup,output,cache,personal,specs> --confirmed`, adding `--specs all` or `--specs <the picked paths, comma-separated>` when the spec group is picked. `--confirmed` is passed only after the yes of step 5.
7. **Report.** `### 🏁 Result`, one bold line (`**✅ Deleted N items, kept M**`), then a table of what was deleted by group and a table of what was kept with the reason the script printed (a group not picked, a path the script refused, a tracked file the person decided on). Name the groups left alone. Closing hint in a quote: `> 💡 To set the project up again: /quality-code:setup.` Tell the person that the script kept the history: files that were committed can be restored with git. Then the wrap-up of display.md in at most 400 words (the verdict, `### What we made` for what was removed by group, `### Needs you` only if a step is left, `### Notes`), and the Next line: `/quality-code:setup`.
