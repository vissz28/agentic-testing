# Where you stopped

Shared by `setup` and `spec` (the same three calls fit every command that asks questions). A command keeps the step it reached and the answers it has, so a person who stops (a closed window, a break, a connector that needed a sign-in) goes on from there instead of answering everything again. It is one small file per project, command and ticket, on this machine under the Claude folder: never in the repo, never sent anywhere, gone after 7 days. `progress.mjs` is the only way to read or write it.

Cards follow `${CLAUDE_PLUGIN_ROOT}/guides/display.md`. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool.

**Never save a token, key, password or ticket text.** Save answers only (a pick, a site, a project key, a path). The script refuses anything that looks like a secret.

**1. At the start.** After the command's own check step (and not with `--ci` or `--yes`: those never ask, never resume and never save), run `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" get <command>` (add `--key <KEY>` for a ticket) and read its `PROGRESS_JSON:` line. `found` false: go on as the command says, with nothing to ask. `found` true: show this card in the picker and end the turn, `<label>` and `<age>` from the line (`ageMinutes` as `12 minutes`, `3 hours` or `2 days`):

```
You stopped at step <step> (<label>), <age> ago.
1. Go on from there
2. Start over
3. Stop
```

- **Go on from there:** read `data`, treat every step before `step` as answered with those values (do not ask them again), and go on at the step after it. Say in one line what you took from it (`Using your earlier answers: repo, Jira teamsystem.atlassian.net, project AGT.`).
- **Start over:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" clear <command>` (with `--key` when it has one) and begin at the first step.
- **Stop:** stop.

**2. After a step that took an answer.** One call, with nothing shown: `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" set <command> --step <N> --label "<the step's name>" --data '<JSON of the answers so far from this step>'` (add `--key <KEY>` for a ticket). Each call keeps the earlier answers and adds the new ones. Not `ok`: say nothing and go on; the cache is a help, never a blocker.

**3. At the end.** When the command finishes (its Done text, or its last card answered), run `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" clear <command>` (with `--key` when it has one), so the next run starts clean.

`node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" list` shows every saved stop of the project, for a person who asks where they left off.

## Project context: what the plugin already knows

Besides where a command stopped, the same local store keeps what was learned about this project, so every command starts knowing it and a rerun does not read everything again: the **flow** (the project's own or Quality Code's, and why), the **tests** (naming, folders, per-unit files or a central file, base classes, annotations, assertion library), the **style** of the nearest specs, the **stack**, the **base** branch, the **connectors**, the Jira project and the **features**. Each fact is saved with the source it came from; when that source changed, the script says the fact is stale and you read it again. The person's language and last picks are kept the same way (`guides/language.md`). A fact is never a token, key, password or ticket text, and a file is kept as a path and a hash, never as a copy: the code stays in the repo.

**Read first.** At the start (after the stop check above, never with `--ci` or `--yes`, and never when `$ARGUMENTS` has `--fresh`), for each fact the command needs run `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" context get <fact> --head` (`--current <token>` for a `hash` or `ticket` fact) and read its `CONTEXT_JSON:` line. `fresh` true: use `value` and say so in one line at the end of the step (`Reusing from your last run: flow, tests, style.`); do not read it again. Stale or not found: read it as the command says (the scripts: `ticket.mjs config flow`, `setup.mjs --detect`, the connector check) and save it. With `--fresh`, read everything again and save it.

**Save what you read.** One call per fact, nothing shown: `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" context set <fact> --data '<JSON>' --source <rule>`. The rule says when it goes stale: `head` (the git commit: flow, tests, style, stack, base), `ticket:<updated>` (the Jira ticket's `updated` time), `hash:<token>` (a config or lockfile hash), `ttl:86400000` (connectors: 24 hours), `none` (the person's own picks). Not `ok`: say nothing and go on; the context is a help, never a blocker.

**Files.** The target the tests check and the specs a run wrote: `node "${CLAUDE_PLUGIN_ROOT}/bin/progress.mjs" context file <path> --role target|spec`. On a rerun for the same ticket, `context changed <path>` says if the file changed: unchanged, the plan and the written tests stand; changed, read the file again and say what changed.

**See and clear.** `context list` shows everything saved for this project. `context clear` forgets it all, `context clear <fact>` one fact.

`/quality-code:clean-cache` deletes this cache (this project, or every project with `--all`) through `bin/clean-cache.mjs`, and nothing else.
