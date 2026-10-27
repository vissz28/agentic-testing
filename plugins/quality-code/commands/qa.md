---
description: Run your Xray manual tests with an agent. Lists the test executions assigned to you, runs one in the browser test by test, and drafts each defect for the developer. You give every verdict, and nothing is written to Jira without a preview and a yes.
argument-hint: [<KEY>] [--app <url>] [--dry-run]
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*)
---

For QA. Lists the Xray test executions assigned to you, runs the one you pick in the browser one test at a time, and drafts a defect for each KO. You see every result first, and you decide. The tests come from the Xray API when its key is set in the plugin settings; otherwise from an Xray export you attach to the message (CSV), or from the Jira page in the browser. Without the API, you set the run statuses in Xray yourself, and the command tells you which. Plain English, short sentences, numbered cards. End your turn after every card and wait for the answer.

## Rules

- **Where files go.** When the command has ended (after its last card is answered, or its last step when it shows none), follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`: the first run of a project asks once where its files and logs are kept.
- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The tester decides.** For each test you propose OK, KO or Not verified, with what you saw. The tester's answer is the verdict. Not verified means a step could not be done (an element not found, the page did not load, a step without an expected result). A browser problem is never a KO, and a step you did not see is never ✅.
- **Jira is written only through the connector, after a yes.** Each write (defect, link, attachment, comment, status, Xray run status) is shown first, and sent only when the tester answers `1`. In the browser, Jira pages are read and nothing else: never click, type or change anything on a Jira page. **`--dry-run`:** no write at all. Every preview ends with `Not sent (--dry-run): copy it if you want it.`
- **The app.** Act only on the app address of this run. The tester signs in to the app in the browser. Never ask for a password, never type one, and never put a password, token or cookie in a defect, a comment or the chat.
- **Never invent.** An expected result comes from the test case's steps, or, on a retest, from the defect's expected result. If the test case does not give the steps or data, ask the tester, or mark the test Not verified.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option. Read only the first word for this; a sentence that says what happened is a typed answer.
- **Language.** Talk in the language of the user's messages. Write defects and comments in the language of the tester's last defect (step 5); without one, in the test case's language. Quote the app's texts exactly as the screen shows them.
- **Connector.** Refer to Jira tools by operation name on the Atlassian (Rovo) connector. On the claude.ai connector some operations have other names: use the table "Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`. When a Jira tool needs a `cloudId`, pass the hostname of `jira.site` (no `https://`). Every key you show is a link: `[KEY](<jira.site>/browse/KEY)`.

## Steps

1. **Check.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config means: run `/quality-code:setup`; with no repo it offers a personal setup). Read `jira.site` from the config it names. Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and do only its Jira parts: the check, who is signed in (with `jira_email` = `${user_config.jira_email}`), and the Jira card. Leave GitLab, GitHub and Figma out. Go on only when Jira is ✅. The line shows who the work is done as: `Connectors: ✅ Jira <email> on <site host>`. **Xray API:** when the plugin's `xray` connector offers `get_test_run`, the API is on: add `· ✅ Xray API` to the line. Without it, say nothing about Xray here.

   **Browser.** If this session has no browser tools (Claude in Chrome, or a Playwright browser connector), show this card and end the turn:

   ```
   No browser is connected. Run /chrome to connect Claude in Chrome, then run /quality-code:qa again.
   1. I test by hand and tell you what I saw
   2. Stop
   ```

   `1` is manual mode: step 4 asks the tester for each result instead of using the browser.
2. **Pick a run.** If `$ARGUMENTS` contains a key (`[A-Z][A-Z0-9_]*-\d+`), use it. Otherwise call `searchJiraIssuesUsingJql` with `assignee = currentUser() AND issuetype in ("Test Execution", "Sub Test Execution") AND statusCategory != Done ORDER BY updated DESC`, `maxResults` 20 and fields `summary,status,issuetype,parent`. No hit: say `No open test executions assigned to you.` and stop. Otherwise show one line per run, `<n>. [KEY](url) · <status> · <summary> · for [PARENT](url)` (no parent: leave out the `for` part), then `Which one? Type its number, or stop.` and end the turn.
3. **Context.** Read, with `getJiraIssue`:
   - **The run:** fields `summary,status,issuetype,parent,assignee,issuelinks`.
   - **The story it tests:** the run's parent. With no parent, the issue the run links with `tests`. With neither, ask `Which story does this run test? (its key)` and end the turn. Read it with view `evidence` (which maps the Sprint field) and fields `summary,description,status,assignee,components,parent`.
   - **Open defects:** issues linked to the run, or to its tests, by a link type named `Defect`, whose status category is not Done.
   - **Test cases.** First from the Xray API, when it is on: `get_test_run` with the run's key gives each test's run id, status and steps (action, data, expected result), and Xray's run statuses. If it answers with an error, say `Xray API: <the error>. Reading the tests another way.` and go on. Next, from an Xray export, when the user's message carries one: a file attached in the app, or a file path in the message (a dropped file shows up as its path). Read each test's key, summary, steps (action, data, expected result) and, when the file has it, its status. Column names vary between exports: go by what each column means. For an `.xlsx`, ask `Save it as CSV (in Excel: File, Save as, CSV UTF-8) and attach that.` and end the turn. Without a file, use the browser: open `<jira.site>/browse/<KEY>` and read the Xray tests panel (each test's key, summary and status), then open each test (`<jira.site>/browse/<TEST KEY>`) and read its steps. Only read these pages. If you cannot read them (Jira is not signed in in this browser, the panel does not load, or manual mode), ask `Attach this run's Xray export (CSV), or paste the test cases (key, steps and expected results), then send.` and end the turn.
   - **App address:** `--app <url>` from `$ARGUMENTS`; it must start with `http://` or `https://`. Without one, ask `Which app address do I test on? Sign in there in the browser first.` and end the turn.

   Show this card and end the turn:

   ```
   [RUN](url) · <status> · <summary>
   For [STORY](url) · <story status> · developer <story assignee, or none>
   App <address>
   Tests (<N>)
     1. [TEST](url) <summary> · <Xray status> · <n> steps
   Open defects (<M>)
     [BUG](url) · <status> · <summary>
   1. Run the tests still To Do, in order
   2. Retest the open defects first
   3. Pick tests (type their numbers)
   4. Stop
   ```

   With no open defects, leave out that block and option 2.
4. **Run, one test at a time.** At the app address, do the test's steps in order, with their data. After each step, compare what the screen shows with the step's expected result. Keep the URL path, a short note of what the screen showed, any browser console errors, and a screenshot of the failing step (or the last one). Then show this card, end the turn, and never start the next test before an answer:

   ```
   Test <i>/<N> [TEST](url) <summary>
   Proposed: KO. Step 3: expected "<expected>", the screen shows "<what it showed>"
     ✅ 1. <step>
     ✅ 2. <step>
     ❌ 3. <step>
   Console: <errors, or none>
   1. KO: draft the defect
   2. OK
   3. Run it again
   4. Not verified: skip it
   5. Stop
   ```

   `Proposed:` is `OK`, `KO` with the first failing step (expected, then what the screen shows), or `Not verified` with the reason. `1` goes to step 5, then the next test. `2` and `4` record the answer and go to the next test. `3` runs the test again. `5` goes to step 7.

   **Manual mode:** do not use the browser. Show the test's steps and expected results, ask `What happened? (OK, or what you saw instead)` and end the turn. The reply is the verdict, and its text is the actual result.
5. **Defect.** Once per run, before the first defect:
   - **Type.** From `getJiraProjectIssueTypesMetadata` for the run's project, take the types that are not subtasks and whose name contains `bug` or `defect`, ignoring case. If more than one, keep those that also contain `QA` or `test`. If there is still more than one, or none, ask with a numbered card.
   - **Style.** The tester's last defect: `searchJiraIssuesUsingJql` with `project = <PROJECT> AND reporter = currentUser() AND issuetype = "<type>" ORDER BY created DESC`, `maxResults` 1, fields `summary,description`. Follow its summary pattern, its headings and its language. With none, use the default below.

   The defect:
   - **Summary:** in the style of the last defect. Default: `<AREA> | <what goes wrong, in a few words>`, with the area from the test's summary.
   - **Description:** in the style of the last defect. Default:

     ```
     **Environment:** <app address> · <the user and tenant the app shows as signed in, when it shows them> · <date, dd/mm/yyyy>

     **Steps to reproduce:**
     1. <step>

     **Actual result:**
     - <what the screen showed, quoted as shown>
     - Console: <errors>
     - Path: <URL path>

     **Expected result:**
     - <the test case's expected result>

     **Notes:**
     - Found by [TEST](url) in [RUN](url).
     ```

   - **Parent:** the story's parent (its epic), since a bug cannot go under a story. With none, no parent.
   - **Components:** the story's. **Sprint:** the story's sprint whose state is `active`, by its id. With none, no sprint. **Assignee:** the story's assignee, the developer. With none, unassigned.

   Show the fields and the description (with the Xray API, add `It is also added to the run of [TEST](url) in Xray.`), then:

   ```
   1. Create it
   2. Change something (say what)
   3. Don't file it
   ```

   End the turn. On `1`:
   1. `createJiraIssue` with the type, summary, description, parent, components, assignee and sprint. If the parent is rejected, retry once without it and say so.
   2. Links: from `listJiraIssueLinkTypes`, a type named `Defect` (ignoring case). `createJiraIssueLink` from the run to the defect and from the test to the defect (`inwardIssue` the run or the test, `outwardIssue` the defect). With no such type, skip the links and say `No Defect link type on this site: link it by hand if your team does.`
   3. Attach the screenshot with `uploadAttachmentToJiraIssue`, if the browser saved one to a file (run its upload command in the shell). If not, say `Attach the screenshot by hand.`
   4. With the Xray API: `add_defect_to_test_run` with the test's run id and the defect key.
   5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <DEFECT KEY> defect`.

   Say `Filed [BUG](url), assigned to <developer>.` and go on with the next test.
6. **Retest** (option 2 of step 3). For each open defect, follow its steps to reproduce at the app address and compare the result with its expected result. Show this card and end the turn:

   ```
   Retest [BUG](url) <summary>
   Proposed: NOT FIXED. <what the screen shows>
   1. Not fixed: draft the comment
   2. Fixed: draft the comment
   3. Run it again
   4. Skip
   ```

   `Proposed:` is `FIXED`, `NOT FIXED` or `Not verified`, with the reason. The comment follows the tester's last comment on the defect that starts with `Retest`. Without one, use:

   ```
   Retest - <FIXED | NOT FIXED>
   <what was done, one line per step>
   Improved: <what now works, if anything>
   Still open: <what still fails>
   Path: <URL path>
   ```

   Show it with `1. Post it / 2. Change something / 3. Don't post`. On `1`, post it with `addCommentToJiraIssue`, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <BUG KEY> retest`. After `Fixed`, list the defect's transitions (`getTransitionsForJiraIssue`) as a numbered card of the statuses they lead to, plus `Leave it`. Apply the one picked with `transitionJiraIssue`, then run `ticket.mjs jira-posted <BUG KEY> status`. Then go on with the tests (step 4).
7. **Close.** Show:

   ```
   [RUN](url): <k> KO · <o> OK · <v> not verified · <r> not run
   Defects filed: [BUG](url), …
   In Xray, set these by hand (no Xray API key here):
     [TEST](url) FAIL, and add [BUG](url) under Findings
     [TEST](url) PASS
   ```

   The Xray lines are each test answered OK or KO, plus the test of each retested defect (FIXED is PASS, NOT FIXED is FAIL). **With the Xray API**, these are a write instead of a by-hand list (and the defects are already on their runs, from step 5). Take the statuses from `get_test_run`: for OK, the final status whose name starts with `PASS`; for KO, the one that starts with `FAIL`, ignoring case. If none matches, or more than one, ask once. Show this card and end the turn:

   ```
   Set in Xray:
     [TEST](url) PASSED
     [TEST](url) FAILED
   1. Set them
   2. Leave them
   ```

   On `1`, call `set_test_run_status` for each test, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <TEST KEY> status` for each status set.

   If every test of the run is now OK or KO, offer the status change. If any test is KO: the run, and the story, go to the status whose name contains `KO` or `fail` (ignoring case) among their transitions (`getTransitionsForJiraIssue`). If all are OK: the run goes to a status in the Done category, and the story is not changed. Show the proposal and end the turn:

   ```
   Move [RUN](url) to <status> and [STORY](url) to <status>?
   1. Yes
   2. Only the run
   3. Leave both
   ```

   If no transition matches, list the transitions and let the tester pick one or leave it. Apply with `transitionJiraIssue`, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <KEY> status` for each issue moved. If any test is not run or not verified, there is no status card: stop after the summary.

## Examples

- `/quality-code:qa`: list my test executions, then pick one
- `/quality-code:qa ABC-123 --app https://app-test.example.com`: run that one on that app
- `/quality-code:qa ABC-123` with the run's Xray export (CSV) attached: the tests come from the file, not the Jira page
- `/quality-code:qa ABC-123 --dry-run`: the whole run, with every defect and comment shown and nothing sent
