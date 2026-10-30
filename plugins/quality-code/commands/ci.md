---
description: Writes the CI file for GitHub Actions or GitLab CI with two jobs for each pull or merge request. quality-gate (git and node only, seconds) checks the changed specs for honesty, assertions and the frozen evals. quality-tests installs the project and runs types, tests and mutation on the changed specs (a code-only change runs its side's whole suite without mutation), with Docker for Testcontainers and JUnit in the merge request. Toolchain and install are guessed from the repo; the provider too when not given.
argument-hint: [github|gitlab] [--print]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
model: haiku
effort: low
---

Writes the plugin's checks into the project's CI, so every pull request (GitHub) or merge request (GitLab) runs them. Two jobs, both fetching the plugin at this version and running `bin/ci.mjs`; no model is involved:

- **quality-gate** (git and node only, seconds): on the specs the request changed, honesty (no assertion or test removed, a deleted or renamed spec included; no skip without a ticket), assertions (every test asserts something) and the frozen evals.
- **quality-tests** (installs the project): the changed specs through the pipeline, one run per module, with types, tests and mutation. A side whose code changed but no spec did runs its whole suite without mutation, as does a push to the default branch. The toolchain and install lines are guessed from the repo (lockfile, Prisma, Playwright, pytest, Maven or Gradle, Go, .NET); Testcontainers gets Docker; a dead runner is retried, a red test never is.

Plain English, short lines.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" …` command, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code.
- **The script decides.** Never write, edit or merge a CI file yourself, and never retry.
- **Language.** Talk in the language of the user's messages. Script output stays as printed.

## Steps

1. **Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" --init $ARGUMENTS`.
   - Exit 0 with `--print`: show the file in a code block and stop.
   - Exit 0: show its lines as printed. If they include an `include:` block, say to add it to `.gitlab-ci.yml` (into its `include:` list if it has one).
   - Exit 2 because neither provider could be guessed: ask `GitHub or GitLab?` and run step 1 again with the answer.
   - Exit 2 because the file is there already: show the line and stop.
2. **Next.** Say: `Check the install lines in quality-tests (a private registry, a generated file, the variables your tests need), then commit the file with .claude/quality-code.json (the jobs read it). It runs on the next pull or merge request; run /quality-code:ci again after a plugin update to move the version (it rewrites the file).`

## Examples

- `/quality-code:ci`: write the two jobs for the CI this repo uses
- `/quality-code:ci gitlab`: write the GitLab jobs (in `.gitlab/quality-code.gitlab-ci.yml` when `.gitlab-ci.yml` exists, with the `include` line to add)
- `/quality-code:ci github --print`: show the GitHub Actions file without writing it
