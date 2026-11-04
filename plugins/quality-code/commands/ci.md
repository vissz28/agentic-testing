---
description: Writes the CI file for GitHub Actions or GitLab CI with two jobs for each pull or merge request. test_quality_gate (git and node only, seconds) checks the changed specs for honesty, assertions and the frozen evals. test_quality_tests installs the project and runs types, tests and mutation on the changed specs (a code-only change runs its side's whole suite without mutation), with Docker for Testcontainers and JUnit in the merge request. Toolchain and install are guessed from the repo; the provider too when not given.
argument-hint: [github|gitlab] [--smoke] [--print]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*) mcp__plugin_quality-code_central-context__search_knowledge mcp__plugin_quality-code_central-context__get_knowledge_document
model: haiku
effort: low
---

Writes the plugin's checks into the project's CI, so every pull request (GitHub) or merge request (GitLab) runs them. Two jobs, both fetching the plugin at this version and running `bin/ci.mjs`; no model is involved:

- **test_quality_gate** (git and node only, seconds): on the specs the request changed, honesty (no assertion or test removed, a deleted or renamed spec included; no skip without a ticket), assertions (every test asserts something) and the frozen evals.
- **test_quality_tests** (installs the project): the changed specs through the pipeline, one run per module, with types, tests and mutation. A side whose code changed but no spec did runs its whole suite without mutation, as does a push to the default branch. The toolchain and install lines are guessed from the repo (lockfile, Prisma, Playwright, pytest, Maven or Gradle, Go, .NET); Testcontainers gets Docker; a dead runner is retried, a red test never is.
- **smoke_post_deploy** (only with `--smoke`, optional): after a deploy, the smoke suite (the tests tagged `@smoke`, read-only) against the address in the `SMOKE_URL` variable of the repo (GitHub: a repository variable; GitLab: a CI/CD variable). It runs on the default branch when the variable is set, and by hand. The address is never written into the file; ask the person to set the variable in the CI settings, never to paste it in the chat if it holds a secret.

Plain English, short lines. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a section per step, tables, colour marks, and the picker for questions. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool.

## Rules

- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" …` command, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code.
- **The script decides.** Never write, edit or merge a CI file yourself, and never retry.
- **Language.** Follow `${CLAUDE_PLUGIN_ROOT}/guides/language.md`: keep the person's language, also after a pick or a script's output. Script output keeps its fixed words.

## Steps

1. **Write.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ci.mjs" --init $ARGUMENTS`.
   - Exit 0 with `--print`: show the file in a code block, then step 2, and stop.
   - Exit 0: show its lines as printed. If they include an `include:` block, say to add it to `.gitlab-ci.yml` (into its `include:` list if it has one).
   - Exit 2 because neither provider could be guessed: ask `GitHub or GitLab?` and run step 1 again with the answer.
   - Exit 2 because the file is there already: show the line and stop.
2. **Central Context.** Check the file against TeamSystem's rules for CI with the `central-context` connector: `search_knowledge` with the query `CI/CD pipeline stages and job names`, `domain` `quality`, `max_results` 5, and `client_context` the project folder's name and `#ci`, with no space (`shop#ci`: Central Context refuses spaces), which Central Context records. Read each hit's summary. A hit about the CI file itself (its stage or job names, the reports it produces, what it runs) applies: read it with `get_knowledge_document` (the same `client_context`) and compare the file the script wrote with it. Show it as one completed step, `Searched Central Context · "CI/CD pipeline stages and job names" · 5 rules, 1 applies ✅`, and under it one line per rule that applies: `✅ <rule id>: met` or `⚠️ <rule id>: <what differs, in a few words>`. A rule never changes the file: never edit it to meet one; a difference is the person's call. Without the connector: `Searched Central Context · not connected ⚠️`, and go on.
3. **Next.** Say: `Check the install lines in test_quality_tests (a private registry, a generated file, the variables your tests need), then commit the file with .claude/quality-code.json (the jobs read it). It runs on the next pull or merge request; run /quality-code:ci again after a plugin update to move the version (it rewrites the file).`

## Examples

- `/quality-code:ci`: write the two jobs for the CI this repo uses
- `/quality-code:ci gitlab`: write the GitLab jobs (in `.gitlab/quality-code.gitlab-ci.yml` when `.gitlab-ci.yml` exists, with the `include` line to add)
- `/quality-code:ci --smoke`: the two jobs plus the optional post-deploy smoke job
- `/quality-code:ci github --print`: show the GitHub Actions file without writing it
