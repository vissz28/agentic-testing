---
description: Start from your feature branch. Checks the connectors, confirms the repo and what your branch changed, finds the Jira ticket from the branch name, and evaluates it.
argument-hint: [--base <branch>]
---

Daily entry point. You ask and relay; the scripts detect and score. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Scripts decide.** `branch.mjs` reads git; `cli.mjs` scores. Never compute a count, a base or a score yourself.
- **Never read or show diff contents**, file contents of the change or commit subjects. Use only what `BRANCH_JSON` gives: paths, statuses, kinds and counts. The change never changes the score.
- **Never ask for a token**, key or password in the chat.
- Refer to Jira tools by operation name on the Atlassian connector; GitLab tools by what they do.
- Every script call runs from the project root: `node "${CLAUDE_PLUGIN_ROOT}/core/<script>" …`. Drop the machine lines (`BRANCH_JSON:`, `TICKET_EVAL_JSON:`) when you show output.

## Steps

0. **Config.** Run `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" config check`. If it prints `ok`, go to step 1. Otherwise show its lines, then this card and end the turn:

   ```
   This repo is not set up yet.
   1. Run setup now
   2. Stop
   ```

   On `1`, read `${CLAUDE_PLUGIN_ROOT}/commands/setup.md` and follow it. When setup is done, continue at step 2 (setup has just checked the connectors). On `2`, stop.
1. **Connectors.** Read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it. From the plugin settings (each empty when not set): `jira_email` is `${user_config.jira_email}`, `gitlab_username` is `${user_config.gitlab_username}`, `gitlab_api_url` is `${user_config.gitlab_api_url}`. Go on only when its card lets you continue.
2. **Repo.** If GitLab is connected, look for an open merge request whose source branch is the current branch (`git branch --show-current`). If there is exactly one, its target branch is the base: remember the merge request's title for step 3 and pass `--base <target branch>`. A `--base` in `$ARGUMENTS` wins over it. Run `node "${CLAUDE_PLUGIN_ROOT}/core/branch.mjs" --detect [--base <name>]` and read the `BRANCH_JSON:` line. Then the first case that applies, each as a card, ending the turn:
   - `isRepo` is false: `This folder is not a git repo.` then `1. Evaluate a ticket by key / 2. Stop`.
   - `detached` is true: `No branch is checked out (at <head>).` then `1. Evaluate a ticket by key / 2. Stop`.
   - `base` is null: `No base branch found.` then the `branches` as a numbered list. Run detect again with `--base <picked>`.
   - `mergeBase` is null and `shallow` is true: show `History is too short to compare. Run git fetch --unshallow, then start again.` and stop. Do not run it yourself.
   - `mergeBase` is null: `This branch shares no history with <base>.` then `1. Pick another base / 2. Evaluate a ticket by key / 3. Stop`.
   - `onBase` is true, or `files` is empty: `No feature-branch changes against <base>.` then `1. Evaluate a ticket by key / 2. Pick another base / 3. Stop`.
   - Otherwise the repo card (leave out the `(origin: …)` part when `remote` is null, and the `+ … not committed yet` part when `counts.uncommitted` is 0):

     ```
     Work on this repo?
       Repo      <repo>   (origin: <remote>)
       Branch    <branch>
       Base      <base>   (<ahead> commits ahead, <behind> behind)
       Changes   <files.length> files: <counts.code> code, <counts.test> tests, <counts.other> other   + <counts.uncommitted> not committed yet
     1. Yes, use this
     2. Use a different base branch
     3. Stop
     ```

   "Pick another base" and `2. Use a different base branch` show `branches` as a numbered list and run detect again with `--base <picked>`. "Evaluate a ticket by key" asks `Which ticket? Type its key, for example ABC-123.` and goes to step 4, option 1, with that key.
3. **Ticket.** Propose one key, the first that applies: `keys[0]` when it appears in the branch name (ignoring case); else the first key in the merge request title from step 2 whose project is in `jira.projects` or `jira.trackingProjects`; else `keys[0]`. When that key is in the branch name, use it without a card: say one line, `Ticket <KEY> (from the branch name)`, and go on. Otherwise show `1. Use <KEY>` / `2. A different ticket` and end the turn. With no key at all, ask `Which ticket? Type its key, for example ABC-123.` A key from a project not in the config is handled by ticket-eval's project check.
4. **Action.** Show this card and end the turn:

   ```
   <KEY> on <branch> (<files.length> files changed against <base>)
   1. Evaluate the ticket
   2. Check the tests on this branch
   3. Write and check tests
   4. Stop
   ```

   Offer option 2 only when `files` has at least one entry with `kind` `test` and `status` other than `D`. Options 2 and 3 work for every adapter, `vitest`, `playwright` and `fullstack`: the scripts pick the test runner (on a fullstack project, per spec), and `write.md` writes unit tests for Vitest, e2e tests for Playwright, and both for a fullstack ticket. Leave out an option that is not offered and number the rest in order: without option 2 the card shows `1. Evaluate the ticket / 2. Write and check tests / 3. Stop`.

   - **1:** read `${CLAUDE_PLUGIN_ROOT}/commands/ticket-eval.md` and follow it with `<KEY>` as `$ARGUMENTS`, no flags. After its result, add one line: `Branch <branch>: <files.length> files changed against <base> (<counts.code> code, <counts.test> tests, <counts.other> other).` The branch never changes the score.
   - **Check the tests (2, when offered):** read `${CLAUDE_PLUGIN_ROOT}/commands/check.md` and follow it with the branch's files of kind `test`, leaving out deleted ones (status `D`), as the spec paths and `--key <KEY>` with the confirmed key. The key is already confirmed in step 3, so do not ask again. Show its card as it prints.
   - **Write and check tests (3, or 2 when option 2 is not offered):** read `${CLAUDE_PLUGIN_ROOT}/commands/write.md` and follow it with the confirmed key `<KEY>` as `$ARGUMENTS`. The key is already confirmed in step 3, so do not ask again; the connectors were checked in step 1, so skip that part of its step 1. Show its cards as it prints them.
   - **Stop (last option):** stop.
