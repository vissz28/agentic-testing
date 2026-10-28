---
description: Schedule a check that runs by itself, at a time you choose, for a period or once, with Claude's scheduler. It fetches what the others pushed, runs a task's tests or the whole suite, says when the result went from green to red (with the commits in between), and can run every test several times to watch stability (flaky tests, pass rate over time). Also lists, shows the stability of, and stops routines.
argument-hint: [KEY] [--cron "m h dom mon dow" | --at "<date time>"] [--until YYYY-MM-DD] [--stability N] [--branch REF] | status [KEY] | list | stop <name> | run …
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*) mcp__scheduled-tasks__create_scheduled_task mcp__scheduled-tasks__list_scheduled_tasks mcp__scheduled-tasks__update_scheduled_task mcp__scheduled-tasks__delete_scheduled_task CronCreate
model: sonnet
---

Makes a **routine**: a check that Claude runs on its own at the times you pick, so you learn when the tests stop passing after other people push, or when they stop being stable. The script decides every result (`routine.mjs`); you set up the schedule and relay what it prints. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/routine.mjs" …` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code.
- **The script decides.** Never compute, change or soften a verdict, a count, a flaky list or a regression. Never edit tests, source files or config, and never retry.
- **Nothing is scheduled without a yes.** Show what will run and when, and wait for the user to confirm.
- **Language.** Talk in the language of the user's messages. Script output stays as printed.

## Steps

0. **Which mode.** From `$ARGUMENTS`: `run …` is a scheduled run (step 4). `status [KEY]` is step 5. `list` is step 6. `stop <name>` is step 7. Anything else makes a routine (steps 1 to 3).
1. **What to check.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok (repo: …)`, show its lines and stop (a missing config means: run `/quality-code:setup`; a routine needs a repo). Take what is in `$ARGUMENTS`; ask only for what is missing, in one card each, ending the turn:

   ```
   What should the routine check?
   1. The whole suite, backend and frontend
   2. The tests of one ticket (type its key, for example ABC-123)
   ```

   ```
   When?
   1. Every weekday at 07:00
   2. Every day at 07:00
   3. Once, at a time you type
   4. Another schedule (type it, for example "every Monday at 9" or a cron)
   ```

   ```
   Until when?
   1. No end date
   2. Until a date you type
   ```
   (skip it for a single run)

   ```
   Look for flaky tests?
   1. No: one run each time
   2. Yes: run every test 5 times each time (slower)
   3. Another number of runs
   ```

   The schedule is a 5-field cron in the user's **local** time (`0 7 * * 1-5` for weekdays at 07:00), or one moment (`--at`, resolved to an ISO 8601 timestamp with the local offset, in the future). Pick a minute that is not 0 or 30 when the user says "around". The branch is `--branch`, else the project's base branch.
2. **Confirm.** Show the card and end the turn:

   ```
   Routine <name>
     Checks     <the whole suite | the tests of KEY> on <branch>
     When       <in words, local time> (<cron or the date>)
     Until      <date | no end date | single run>
     Stability  <each test N times | one run>
     Looks for  new commits since the last check, shared files that changed (package.json, a lockfile, a runner config), tests that went from green to red
   1. Schedule it
   2. Change something
   3. Cancel
   ```

   `<name>` is `quality-code-routine-<KEY or suite>`.
3. **Schedule it.** On `1`, create it with Claude's scheduler: `create_scheduled_task` (`mcp__scheduled-tasks__create_scheduled_task`) with `taskId` the name, `title` `Quality Code routine · <what>`, `description` one line, `cronExpression` (a recurring schedule) or `fireAt` (once), and this `prompt`, which must stand on its own because each run starts fresh:

   `In the project folder <absolute project path>, run /quality-code:routine run [--task KEY] [--branch REF] [--until YYYY-MM-DD] [--stability N] --since-last --id <name> and show its output exactly as printed. If the first line of the result says Result: FAILED or NOT VERIFIED, or it contains REGRESSION or Flaky, start your reply with one plain sentence saying what is wrong.`

   The scheduled run calls this command's `run` mode, so it keeps working after the plugin updates. If the scheduler tools are not available, use `CronCreate` instead (`recurring` false for a single run) and say plainly: `This lasts only while this Claude session is open, and a recurring one ends after 7 days.` Tell the user in one line: `Scheduled tasks run while the Claude app is open; a run missed while it was closed happens when it opens again.` and show the next run time the scheduler gives. Stop.
4. **A scheduled run (`run …`).** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/routine.mjs" run <the arguments without --id>` and show its output as printed. If the output starts with `routine ended on`, find the scheduled task named by `--id` with `list_scheduled_tasks` and remove it with `delete_scheduled_task`, then say `The routine reached its end date and was removed.` Stop.
5. **Stability.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/routine.mjs" status [--task KEY]` and show it as printed. Stop.
6. **List.** Call `list_scheduled_tasks` and show the tasks whose id starts with `quality-code-routine-`: name, schedule in words, next run, last run, on or off. None: `No routines yet. /quality-code:routine ABC-123 schedules one.` Stop.
7. **Stop.** Show the task (name, schedule) and ask `Remove <name>? 1. Yes / 2. No`. On `1`, `delete_scheduled_task`, and say `Removed. Its kept results stay: /quality-code:routine status still shows them.` Stop.

## Examples

- `/quality-code:routine`: asks what, when and for how long
- `/quality-code:routine ABC-123 --cron "7 7 * * 1-5" --until 2026-12-31`: the tests of ABC-123 on weekdays until the end of the year
- `/quality-code:routine --at "tomorrow 09:15" --stability 5`: once, the whole suite, every test 5 times
- `/quality-code:routine status`: the stability of the last runs (pass rate, flaky tests, green to red)
- `/quality-code:routine list`, `/quality-code:routine stop quality-code-routine-suite`
