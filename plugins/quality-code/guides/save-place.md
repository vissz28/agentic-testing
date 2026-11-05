# Where files and logs go

Shared by the commands that save files: `spec`, `ticket-eval`, `tickets-eval`, `transcript-goal`, `xray`, `seed`, `qa` and the run commands (`run-frontend`, `run-backend`, `run-pipeline`, `run-smoke`, through `guides/run.md`). It also covers `/quality-code:config`, which shows the same choice and changes it. The files are the setup config (`config.json`), the ticket copies, the run logs (`run.md`) and the Xray files in the tickets folder, plus the local audit log `/quality-code:kpi` reads. Until a person picks, everything stays in the session (a temp folder). `/quality-code:setup` asks as its last step; each person picks once per project, and the pick is kept on this computer, never in the repo. Every question is asked with the AskUserQuestion picker as `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says, never as a numbered text card; the text card is only for a client without the tool.

**Setup asks as its last step** (see its step 5). Any other command, after its last step, only asks when the project was set up before this existed. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save get` and read its `SAVE_JSON:` line. When `asked` is `true`, say nothing and stop. When it is `false` (never asked for this project here), show this card and end the turn, with one line per entry of `options`, in that order:

```
Where should Quality Code keep this project's files and audit log?
1. In the project repo: <ticketsDir>/ (git-ignored)
2. On this machine, outside the repo: <ticketsDir>/
3. Only in this session: <ticketsDir>/ (a temp folder, the default)
```

`repo` is the project repo line, `local` the machine line and `chat` the chat line, numbered in the order they come. A setup with no repo has only `local` and `chat`: its card has two lines. Show each `ticketsDir` as given (with `~` for the home folder).

On a pick, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save set <repo|local|chat>` and show its `ok:` line as printed. It remembers the pick and moves what this run saved, the setup config (`config.json`, written first in the session folder by setup) and the audit log to the new place. Then stop.

With `--ci` or `--json`, never show the card: the place stays as it is.

**What each place means.**

- **In the project repo.** The files sit in the project's tickets folder, the config in `.quality-code/config.json`, and the audit log in `.claude/quality-code/audit/`. Each folder ignores itself (a `.gitignore` with `*` inside it): nothing is added to the project's own `.gitignore`.
- **On this machine.** The same files, `config.json` included, in a folder under your Claude folder, one per project, outside the repo. It lasts across sessions.
- **Only in this session.** The default. The files a run needs between steps, the setup config and the audit log, go to a temp folder outside the repo. `/quality-code:kpi` counts what was logged there, until the machine clears the folder.

To change it later: `/quality-code:config`, item 7.
