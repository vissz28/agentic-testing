# Where files and logs go

Shared by the commands that save files: `spec`, `ticket-eval`, `tickets-eval`, `xray`, `seed`, `qa` and the run commands (`run-frontend`, `run-backend`, `run-pipeline`, through `guides/run.md`). It also covers `/quality-code:config`, which shows the same choice and changes it. The files are the ticket copies, the run logs (`run.md`) and the Xray files in the tickets folder, plus the local audit log `/quality-code:kpi` reads. Each person picks once per project; the pick is kept on this computer, never in the repo.

**After the command's last step,** run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save get` and read its `SAVE_JSON:` line. When `asked` is `true`, say nothing and stop. When it is `false` (the first run of this project here), show this card and end the turn, with one line per entry of `options`, in that order:

```
Where should Quality Code keep this project's files and logs?
1. In the project repo: <ticketsDir>/ (git-ignored)
2. On this machine, outside the repo: <ticketsDir>/
3. Only in this chat: nothing is kept
```

`repo` is the project repo line, `local` the machine line and `chat` the chat line, numbered in the order they come. A setup with no repo has only `local` and `chat`: its card has two lines. Show each `ticketsDir` as given (with `~` for the home folder).

On a pick, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" save set <repo|local|chat>` and show its `ok:` line as printed. It remembers the pick and moves what this run saved (and the audit log) to the new place. Then stop.

With `--ci` or `--json`, never show the card: the place stays as it is.

**What each place means.**

- **In the project repo.** The files sit in the project's tickets folder, and the audit log in `.claude/quality-code/audit/`. Both are git-ignored. This is the default in a repo.
- **On this machine.** The same files, in a folder under your Claude folder, one per project, outside the repo. This is the default with no repo.
- **Only in this chat.** Results are shown in the chat only. The files a run needs between steps go to a temp folder, and no audit log is kept, so `/quality-code:kpi` has nothing to count.

To change it later: `/quality-code:config`, item 7.
