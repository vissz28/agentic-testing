# `/quality-code:start`: from the developer's branch to the ticket

Status: draft for review · Date: 2026-10-14 · Owner: Elvis Zefaj · Jira: AGT-43 · Builds on:
[part 1](2026-10-12-part-1-core-config-design.md)

## 1. Goal

One command for daily use that starts where the developer is: their repo and their feature branch.
It checks the connectors, confirms the local repo, reads what the branch changed, finds the ticket
from the branch, and evaluates it. When part 4 ships, the same command runs the full pipeline.
Setup gets the same connectors check as its first step.

`setup` stays a once-per-repo command; `start` is what people type every day.

## 2. Decisions already taken

| Decision | Value |
|---|---|
| Entry point | A new command, `/quality-code:start`. Not inside setup (once per repo) or ticket-eval (needs a key). |
| Connectors | Jira is required; GitLab and Figma are optional and never block. Figma only matters for Playwright repos. |
| Diff role | A target hint only. It never changes the ticket score; generated tests are graded against the ticket's criteria, never against the diff. |
| Diff exposure | Paths and counts only in this version. No hunks reach the model; part 4 adds a redacted hunk reader if the pipeline needs one. |
| Secrets | Never asked for or shown in the chat. Keys go through the plugin settings (system keychain). |
| Release | v0.2.1, before part 2. |

## 3. The flow

```
/quality-code:start
 0. Config?        none → "This repo is not set up yet." 1. Run setup now / 2. Stop
 1. Connectors     status card (core/connectors.md)
 2. Repo card      local repo, branch, base, change counts → confirm
 3. Ticket key     from the branch name, confirmed
 4. Action card    1. Evaluate the ticket / 2. Run the full pipeline (with part 4)
```

Every card is numbered, the user answers by typing a number, and the command ends its turn after
each card, as setup and ticket-eval do.

### 3.1 Step 0: no config

`core/config.mjs` finds no `.claude/quality-code.json`, or a wrong one: show the card
`1. Run setup now / 2. Stop`. On 1, run the setup flow; when it finishes, continue at step 2 (setup
has just shown the connectors).

### 3.2 Step 1: connectors

Written once in `core/connectors.md`; both `setup` (as its step 0) and `start` read and follow it.

```
Connectors
  ✅ Jira (Atlassian)   example.atlassian.net
  ⚠️ GitLab             not reachable at <gitlab_mcp_url>
                         optional now; needed later for merge-request links
  ➖ Figma              no key set; optional, used for frontend design comparison
1. Continue
2. Fix one first
```

| Connector | Required | Check (one read-only call) | When missing or broken |
|---|---|---|---|
| Jira (Atlassian) | yes | `getAccessibleAtlassianResources` on whichever Atlassian connection is available (the plugin's or the user's claude.ai one) | Show: type `/mcp`, choose `atlassian-rovo`, sign in. Card `1. Check again / 2. Stop`. Never continue without it. |
| GitLab | no | a GitLab connector tool is available and answers one read call | Show the URL tried and that it is changed in the plugin settings (`gitlab_mcp_url`). Continue. |
| Figma | no; `playwright` only, not shown for `vitest` | a Figma connector tool is available and answers one read call | Say the key is set in the plugin settings (`figma_api_key`). Continue. |

`2. Fix one first` lists the non-green connectors as a numbered card and shows the fix for the
picked one, then re-checks all three. Connector status is personal; nothing about it is written to
the config.

### 3.3 Step 2: repo card

From `core/branch.mjs --detect` (section 4):

```
Work on this repo?
  Repo      <folder name>   (origin: <remote url without credentials>)
  Branch    FIC-14333-fe-smart-component-products-stock-main-page
  Base      develop   (14 commits ahead, 3 behind)
  Changes   9 files: 6 code, 2 tests, 1 other   + 2 not committed yet
1. Yes, use this
2. Use a different base branch
3. Stop
```

Base branch, the first that applies:

1. The target branch of an open GitLab merge request for this branch, when GitLab is connected:
   the model asks the GitLab connector and passes it to the script as `--base`.
2. `origin/HEAD`.
3. The first of `develop`, `main`, `master` that exists, locally or on `origin`.

`2. Use a different base branch` lists the local and `origin` branches as a numbered card and
re-runs detect with `--base`. The changes are those between the merge base of base and `HEAD`,
plus uncommitted ones (staged, unstaged, untracked and not ignored).

### 3.4 Step 3: ticket key

The first of `keys` from detect (branch name first, then commit subjects on the branch), filtered
to `jira.projects` ∪ `jira.trackingProjects`. When GitLab gave a merge request, its title is
searched before the commit subjects. Shown as `1. Use FIC-14333 / 2. A different ticket`. No
candidate: ask for the key. A key from a project not in the config gets ticket-eval's usual
project-mismatch card.

### 3.5 Step 4: action

```
FIC-14333 on FIC-14333-fe-smart-component-… (9 files changed against develop)
1. Evaluate the ticket
2. Run the full pipeline (available with part 4)
3. Stop
```

- **1** runs the `/quality-code:ticket-eval` flow for that key, unchanged: gate, refuse options,
  fill-in, Jira push. Under the result, one line repeats the change counts. The score never uses
  the diff.
- **2** says, until part 4 ships: "Writing and grading tests for any project comes with part 4. For
  now you can evaluate the ticket." and shows the card again without option 2. Part 4 replaces this
  with the pipeline and passes it the changed code files as the target hint.

## 4. `core/branch.mjs`

Local git only: no network, no dependencies, Node 18+. Root from `$CLAUDE_PROJECT_DIR`, else the
git top level, as in part 1.

```
node core/branch.mjs --detect [--base <name>]
```

Prints one line `BRANCH_JSON:<json>`, exit 0, or exit 2 with one plain error line for usage and
config errors. Git situations (not a repo, detached, shallow) are reported in the JSON, not as
errors, so the command can show the right card.

```js
{
  repo: 'warehouse-frontend',            // folder name
  remote: 'https://gitlab.example/…',    // origin URL with any user:password@ removed; null if none
  isRepo: true,
  branch: 'FIC-14333-fe-…',              // null when detached
  detached: false, head: 'a1b2c3d',
  base: 'develop', baseSource: 'flag' | 'origin-head' | 'fallback' | null,
  onBase: false, shallow: false,
  ahead: 14, behind: 3,
  files: [{ path, status: 'A' | 'M' | 'D' | 'R', kind: 'code' | 'test' | 'other', committed: true }],
  counts: { code: 6, test: 2, other: 1, uncommitted: 2 },
  keys: ['FIC-14333'],                   // in config projects only, branch name first, deduplicated
  branches: ['develop', 'main', 'origin/develop']   // for the base card
}
```

- **`kind`:** `test` when the path matches `*.spec.*` / `*.test.*` or, for `playwright`, sits under
  the Playwright `testDir` (read from `playwright.config.*` when it is a plain string, else `e2e/`
  and `tests/`); `code` for `.ts .tsx .js .jsx .mjs .cjs .vue` that are not tests; `other`
  otherwise.
- **Redaction:** every path and commit subject read goes through the config's `redact` patterns
  before it is used or printed.
- **Renames** count once, under the new path. **Deletes** are listed with status `D`.
- Commit subjects are read only for key candidates and never printed.

## 5. Errors

| Situation | What start shows |
|---|---|
| Not a git repo | "This folder is not a git repo." `1. Evaluate a ticket by key / 2. Stop` |
| Detached HEAD | "No branch is checked out (at `<head>`)." `1. Evaluate a ticket by key / 2. Stop` |
| On the base branch, or no changes | "No feature-branch changes against `<base>`." `1. Evaluate a ticket by key / 2. Pick another base / 3. Stop` |
| No base found | the base card with the branch list |
| Shallow clone (no merge base) | "History is too short to compare. Run `git fetch --unshallow`, then start again." |
| Jira not connected | the connectors card; no further step |
| Key's project not in config | ticket-eval's project-mismatch card |

"Evaluate a ticket by key" asks for the key and continues at step 4 option 1.

## 6. Files

| File | Change |
|---|---|
| `commands/start.md` | new: the flow above |
| `core/connectors.md` | new: the connectors check, shared |
| `core/branch.mjs` | new |
| `commands/setup.md` | new step 0: "Read `${CLAUDE_PLUGIN_ROOT}/core/connectors.md` and follow it." Steps 1–7 keep their numbers. |
| `test/branch.test.mjs` | new |
| `test/start-command.test.mjs` | new |
| `test/setup-command.test.mjs` | step 0 pinned |
| `.claude-plugin/plugin.json` | version 0.2.1, description mentions `start` |
| `README.md`, `docs/GETTING_STARTED.md` | Quick start: install, setup once, then `start` daily; the connectors card in "Set up your project" |

## 7. Testing

- **`branch.test.mjs`** builds real temporary repos with `git init` inside the test (no fixtures on
  disk, no network): base from `--base`, from `origin/HEAD` (a local bare repo as `origin`), from
  the fallback; ahead and behind; kinds for both adapters, including a Playwright `testDir`;
  renames and deletes; staged, unstaged and untracked files; key candidates in config, outside it,
  none, from a commit subject; detached HEAD; on base; shallow clone (`git clone --depth 1` of the
  temp repo); not a repo; a remote URL with credentials stripped; a redact pattern applied to a
  path.
- **`start-command.test.mjs`** pins: the step order; the card texts; Jira blocks, GitLab and Figma
  never block; Figma skipped for `vitest`; no token asked for in the chat; the diff never feeds
  the score; option 2 marked as coming with part 4; Jira tools named by operation, never by
  `mcp__` name (as for setup).
- **`setup-command.test.mjs`** pins step 0 reading `core/connectors.md`; the existing step tests
  stay unchanged.
- CI as today: `npm test`, `claude plugin validate`.

## 8. Out of scope

Running the pipeline (part 4), reading diff hunks, changed-function detection, creating branches or
merge requests, posting anything to GitLab, Bitbucket or GitHub merge-request lookups (GitLab only;
others fall back to `origin/HEAD`), setting plugin settings for the user.

## 9. Acceptance criteria

1. In a set-up repo on a feature branch named with a configured key, `start` shows the connectors
   card, the repo card with correct base and counts, proposes the key, and option 1 gives the same
   result as `/quality-code:ticket-eval <KEY>`.
2. With Jira not connected, `start` and `setup` stop at the connectors card with the sign-in steps;
   with GitLab or Figma broken, they continue.
3. No token or key is ever asked for in the chat.
4. Every situation in section 5 shows its card, never a stack trace.
5. All tests pass; `claude plugin validate` passes; v0.2.1 tagged.
