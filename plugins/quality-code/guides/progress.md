# Where you stopped

Shared by `setup` and `spec` (the same three calls fit every command that asks questions). A command keeps the step it reached and the answers it has, so a person who stops (a closed window, a break, a connector that needed a sign-in) goes on from there instead of answering everything again. It is one small file per project, command and ticket, on this machine under the Claude folder: never in the repo, never sent anywhere, gone after 7 days. `progress.mjs` is the only way to read or write it.

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
