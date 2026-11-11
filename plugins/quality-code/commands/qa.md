---
description: Run your Xray manual tests with an agent. Takes the key of a test execution assigned to you and runs it in the browser test by test, and drafts each defect for the developer. You give every verdict, and nothing is written to Jira without a preview and a yes.
argument-hint: <KEY> [--app <url>] [--resume] [--auto-pass] [--dry-run] | --watch | --watch-check
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/*) mcp__scheduled-tasks__create_scheduled_task mcp__scheduled-tasks__list_scheduled_tasks mcp__scheduled-tasks__update_scheduled_task mcp__scheduled-tasks__delete_scheduled_task CronCreate
---

For QA. Takes the key of a task (it shows what to test and how, from its subtasks, attachments and merge requests) or of an Xray test execution assigned to you, runs it in the browser one test at a time, and drafts a defect for each failed test. You see every result first, and you decide. The tests come from the Xray API when its key is set in the plugin settings; otherwise from an Xray export you attach to the message (CSV), or from the Jira page in the browser. Without the API, you set the run statuses in Xray yourself, and the command tells you which. Your answers are saved as you go, so a run can be resumed, and `--watch` tells you when a story you sent back is ready to retest. Plain English, short sentences, numbered cards. Show every card and output the way `${CLAUDE_PLUGIN_ROOT}/guides/display.md` says: a section per step, tables, colour marks, and the picker for questions. Every question is asked with the AskUserQuestion picker as display.md says, never as a numbered text card; the text card is only for a client without the tool. End your turn after every card and wait for the answer.

## Rules

- **Where files go.** When the command has ended (after its last card is answered, or its last step when it shows none), follow `${CLAUDE_PLUGIN_ROOT}/guides/save-place.md`: the first run of a project asks once where its files and logs are kept.
- **Run each plugin script exactly as written:** one `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` command per call, with nothing added before or after it (no `echo`, `;`, `&&`, `|` or redirection). The tool result already shows a non-zero exit code. Anything added stops the call from matching its pre-approval and costs a permission prompt.
- **The tester decides.** For each test you propose Passed, Failed or Blocked, with what you saw. The tester's answer is the verdict. Blocked means a step could not be done (an element not found, the page did not load, the sign-in failed, no test data, a step without an expected result). A browser problem is never a Failed result, and a step you did not see is never ✅. **Auto-pass** (`--auto-pass`, or `qa.autoPass` in the config): the tester chose beforehand that a Passed you propose is recorded without a card, one line `✅ <TEST> passed`. A Failed or a Blocked test always gets its card, and the run stops there. It changes the cards only: every write still waits for a preview and a yes, and a test you did not fully see is never proposed as Passed.
- **Jira is written only through the connector, after a yes.** Each write (defect, link, attachment, comment, status, Xray run status) is shown first, and sent only when the tester answers `1`. A defect description and a comment end with the line `Co-authored via Quality Code` (the "Co-author line" of `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`), shown in the preview. In the browser, Jira pages are read and nothing else: never click, type or change anything on a Jira page. **`--dry-run`:** no write at all. Every preview ends with `Not sent (--dry-run): copy it if you want it.` With `--dry-run`, do not save progress either (skip every `qa.mjs state` call). **One exception to "after a yes":** a test's own Xray status (with the Xray API) is covered by the test's card, which names it (`Xray: PASSED`): the tester's answer to that card is the yes.
- **The app.** Act only on the app address of this run. The tester signs in to the app in the browser. Never ask for a password, never type one, and never put a password, token or cookie in a defect, a comment or the chat.
- **Progress is saved.** After every answer, run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" state record …` (steps 4 to 6). A run is resumed from that file, and the script, not you, says what is still to do and when the environment looks down. Never edit the saved files.
- **Never invent.** An expected result comes from the test case's steps, or, on a retest, from the defect's expected result. If the test case does not give the steps or data, ask the tester, or mark the test Not verified.
- **Replies.** Answer a card with its number or in words: `yes`, `y`, `sì`, `si`, `ok` and `va bene` mean `1`; `stop` and `basta` mean the card's Stop option. Read only the first word for this; a sentence that says what happened is a typed answer.
- **Language.** Follow `${CLAUDE_PLUGIN_ROOT}/guides/language.md`: keep the person's language, also after a pick or a script's output. Write defects and comments in the language of the tester's last defect (step 5); without one, in the test case's language. Quote the app's texts exactly as the screen shows them.
- **Connector.** Refer to Jira tools by operation name on the Atlassian (Rovo) connector. On the claude.ai connector some operations have other names: use the table "Atlassian operation names" in `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md`. When a Jira tool needs a `cloudId`, pass the hostname of `jira.site` (no `https://`). Every key you show is a link: `[KEY](<jira.site>/browse/KEY)`.

## Steps

With `--watch` or `--watch-check` in `$ARGUMENTS`: run only `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check` (if it does not print `ok`, show its lines and stop), skip the rest of step 1 and go to step 9. No browser and no connectors card there.

1. **Check.** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" config check`. If it does not print `ok`, show its lines and stop (a missing config is never a dead end: show the **Not set up** card of the display guide; with no repo it offers a personal setup). Read `jira.site` from the config it names. Then read `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` and do only its Jira parts: the check, who is signed in (with `jira_email` = `${user_config.jira_email}`), and the Jira card. Leave GitLab, GitHub and Figma out of this check (the task flow checks the source code connector when a ticket has merge request links). Go on only when Jira is ✅. The line shows who the work is done as: `Connectors: ✅ Jira <email> on <site host>`. **Xray API:** when the plugin's `xray` connector offers `get_test_run`, the API is on: add `· ✅ Xray API` to the line. Without it, say nothing about Xray here.

   **Browser.** Use the first browser this session has: the built-in browser pane of the Claude desktop app (where the tester signs in once and stays signed in), Claude in Chrome, or a Playwright browser connector. If it has none, show this card and end the turn:

   ```
   No browser is connected. Open the browser pane in the Claude app, or run /chrome to connect Claude in Chrome, then run /quality-code:qa again.
   1. I test by hand and tell you what I saw
   2. Stop
   ```

   `1` is manual mode: step 4 asks the tester for each result instead of using the browser.
2. **The run.** The key is mandatory: the first `[A-Z][A-Z0-9_]*-\d+` in `$ARGUMENTS` is the test execution to run. No key: say `pass the test execution to run: /quality-code:qa <KEY>` and stop (`--watch` and `--watch-check` need none). The key may be a test execution (its issue type is one of the `qa.executionTypes` of the config, by default `Test Execution` and `Sub Test Execution`): go on to step 3. Any other key (a parent task, a story, a subtask) starts the **task flow** below.

   **The task flow** (a key that is not a test execution). Read-only on Jira; the browser is not used here.
   1. **The task.** `getJiraIssue` with `fields` `["*all"]`, `responseContentFormat` `markdown`, and `getJiraIssueRemoteIssueLinks`. Use what comes back: `summary`, `status`, `issuetype`, `description`, `comment`, `attachment` (a count and names; images are screenshots, `.csv` an Xray export), `issuelinks`, the components, the sprint, and any custom field with a value, such as test coverage or the Xray tests panel. Say in one line `Also on the task: <attachments, links, coverage>`, or `Nothing more on the task.` Never show a customfield id or an empty field.
   2. **What needs testing.** One `searchJiraIssuesUsingJql` with `parent = <KEY> OR issue in linkedIssues(<KEY>)`, fields `summary,status,issuetype,assignee,issuelinks,attachment`. Keep: the subtasks (children of the task), the linked test executions (type in `qa.executionTypes`), and the linked Test issues. A subtask that is itself a story or task of a parent is one item. With none, the task itself is the one item. A key that is a subtask: its parent is read for context and the subtask is the one item.
   3. **The card.** Show it and end the turn. The picker lists up to 4 items per page (`More…` pages), multiSelect on:

      ```
      [KEY](url) · <status> · <summary>
      Also on the task: <…>
      To test (<N>)
        1. [SUB](url) · <type> · <status> · <assignee> · <n> attachments · <m> links
        2. …
      Test coverage: <linked tests and executions with their status, or none found>
      1. Pick which to test (type their numbers)
      2. All of them, one after the other
      3. Stop
      ```
   4. **One item at a time.** For the item picked, read `getJiraIssue` with `["*all"]`, its remote links, and:
      - **Attachments and links.** Screenshots (images) are listed by name; for a Figma link, the design (the Figma connector, only when connected). Web links and addresses in the description or comments are sorted: app address, Figma, Confluence, GitLab or GitHub merge request, other.
      - **Merge requests.** A GitLab or GitHub merge request found in the remote links, the description or the comments: read it read-only with the source code connector when it is connected (title, description, changed files, branch); if it is not connected, do not skip it: follow the **Merge requests found in a ticket** section of `${CLAUDE_PLUGIN_ROOT}/guides/connectors.md` (it points to `/mcp` and `/quality-code:setup`, and offers `Signed in: read the merge requests`, `Continue without the code`, `Stop`). With no such link, say nothing about GitLab
      - **The summary: how to test it.** Written from what was read, never invented, in the item's language, as an end-to-end plan by best practice: Goal (one line); Preconditions (environment, user and role, test data); Scenarios, each as numbered steps with data and an expected result seen by the user (the happy path first, then the negative, boundary and permission cases the acceptance criteria and the merge request imply); What to check besides the screen (network calls and status codes, console errors, data saved, a reload and the persisted state); Out of scope; Risks seen in the merge request (files and areas it touches that need a regression pass). A part the ticket does not give is shown as `Not in the ticket: <what to ask the developer>`, not guessed.
   5. **Then.** Ask with the picker: `1. Next item / 2. Run these scenarios in the browser (a run needs an execution: pass its key) / 3. Save the plan as a comment on the item (preview first, sent only on a yes) / 4. Stop`. Nothing is written to Jira unless the tester picks `3` and confirms the preview. For `2`, with a linked test execution, offer to start step 3 with its key.
3. **Context.** Read, with `getJiraIssue`:
   - **The run:** all its fields (`getJiraIssue` with `fields` `["*all"]`, `responseContentFormat` `markdown`), plus `getJiraIssueRemoteIssueLinks`. Go through what comes back for more information, and use it: `summary`, `status`, `issuetype`, `parent`, `assignee`, `issuelinks`, `description`, `environment`, `comment`, `attachment`, the sprint, the components, and any custom field with a value (a test environment name, a link). An attached `.csv` is the run's Xray export (read it as the export below, when the tester attached none); an `http(s)` address in the description, the environment, a comment or a web link that is not Jira, Confluence or Figma is a candidate for the app address (offer it, never use it unasked). Show what you found in one line (`Also on the run: <attachments, environment, comments>`), or say `Nothing more on the run.` Never show a customfield id or an empty field.
   - **The story it tests:** the run's parent. With no parent, the issue the run links with `tests`. With neither, ask `Which story does this run test? (its key)` and end the turn. Read it with view `evidence` (which maps the Sprint field) and fields `summary,description,status,assignee,components,parent`.
   - **The story's flow:** the executions of the same story. Read the story's `issuelinks` (`getJiraIssue` with field `issuelinks`): every linked issue of link type `Test` whose issue type is one of the `qa.executionTypes` is a run of this story. For each, one `searchJiraIssuesUsingJql` with `key in (<those keys>)` and fields `summary,status,assignee,resolutiondate,issuelinks` gives its status, tester, date and the bugs linked to it by a `Defect` link (a count, and each bug's summary). This is the template for every task: the run you were given is one row of it. With no other run, leave the block out.
   - **Open defects:** the bugs of earlier runs, whose status category is not Done: issues linked to the run, or to its tests, by a link type named `Defect`, and the children of the story (`searchJiraIssuesUsingJql` with `parent = <STORY> AND statusCategory != Done`), keeping those whose issue type name contains `bug` or `defect`, ignoring case. Each defect once.
   - **Test cases.** First from the Xray API, when it is on: `get_test_run` with the run's key gives each test's run id, status and steps (action, data, expected result), and Xray's run statuses. If it answers with an error, say `Xray API: <the error>. Reading the tests another way.` and go on. Next, from an Xray export, when the user's message carries one: a file attached in the app, or a file path in the message (a dropped file shows up as its path). Read each test's key, summary, steps (action, data, expected result) and, when the file has it, its status. Column names vary between exports: go by what each column means. For an `.xlsx`, ask `Save it as CSV (in Excel: File, Save as, CSV UTF-8) and attach that.` and end the turn. Without a file, use the browser: open `<jira.site>/browse/<KEY>` and read the Xray tests panel (each test's key, summary and status), then open each test (`<jira.site>/browse/<TEST KEY>`) and read its steps. Only read these pages. If Jira is not signed in in this browser (the page is the Atlassian login), show the picker `Jira is not signed in in the browser pane.` with `Signed in: read the tests`, `I'll attach the Xray export or paste the test cases` and `Stop`, and end the turn; on the first, open the page again and read it. If you cannot read the tests otherwise (the panel does not load, or manual mode), ask `Attach this run's Xray export (CSV), or paste the test cases (key, steps and expected results), then send.` and end the turn. The Xray API key (plugin settings) makes all of this automatic: say so once, as `Tip: with the Xray API key set (/plugin, the xray connector) the tests are read with no browser.`
   - **App address:** `--app <url>` from `$ARGUMENTS`; it must start with `http://` or `https://`. Without one, run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" app get`: it gives `qa.app` of the config, else the address of the last run. With neither, look for an `http(s)` link to the app (not Jira, Confluence, Figma, GitLab or GitHub) in every field of the run, the story and its parent that you already read: description, environment, comments, web links and any custom field with a value. With one or more found, show the picker `Is this the app to test?` with each address as an option, `Type another address` and `Stop`, and end the turn; a typed address must start with `http://` or `https://`. With none found, say `No app address in the Jira fields.` and ask with the picker `Which app address do I test on?` (`Type the address` and `Stop`); you sign in there in the browser yourself. Whichever address you end up with, unless it came from the config, save it with `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" app set <url>`, so the next run does not ask.
   - **Saved progress:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" state show <RUN> --tests <the test keys, comma-separated>`. When `exists` is true, show its counts in the card (`Saved progress: <k> of <N> answered: <ok> passed, <ko> failed, <blocked> blocked`) and its `pending` tests are the ones option 1 runs; the tests already answered stay as they are. `--resume` takes option 1 without asking. If the tester asks to start over, run `qa.mjs state reset <RUN>` first. With `--dry-run`, skip this call.

   **A run that is not yours to run.** When the run's status category is Done, or its assignee is not the person signed in to Jira, add this line under the card's first line, `⚠️ This run is <Done | assigned to <name>>: new verdicts would change a finished run.`, and make the card's first option `1. Dry run: show every verdict and defect, send nothing` (the others follow, and `--dry-run` is then on for the whole run). The tester can still pick the real run.

   Show this card and end the turn:

   ```
   [RUN](url) · <status> · <summary>
   For [STORY](url) · <story status> · developer <story assignee, or none>
   App <address>
   Tests (<N>)
     1. [TEST](url) <summary> · <Xray status> · <n> steps
   Story flow (<R> runs)
     [RUN](url) <what it covers> · <status> · <tester> · <date> · <b> bugs
   Open defects (<M>)
     [BUG](url) · <status> · <summary>
   1. Run the tests still To Do, in order (with saved progress: Resume with the <m> tests left)
   2. Retest the open defects first
   3. Pick tests (type their numbers)
   4. Stop
   ```

   With no open defects, leave out that block and option 2. Bugs whose status is `NON RISOLVIBILE` or `DONE (RIFIUTATO)`, or any other Done-category status that means not fixable or rejected, are shown but never retested.
4. **Run, one test at a time.** **Sign-in first (the sandbox).** The test runs in the browser pane of the Claude app, which the tester watches live: it is the sandbox, apart from the tester's own Chrome and kept between sessions. Before the first test, open the app address in the pane (`preview_start` with `url`, or `navigate`), then show the picker `The app is open in the browser pane. Sign in there yourself.` with `Signed in: start the tests`, `I need a different user for these tests` and `Stop`, and end the turn. Never ask for a password, never type one, never read one from the chat or the page. When a test needs another user or role (the test names it, or its steps say a user without a permission, view-only, or full access), stop before that test with the same picker, naming the role (`Sign in as a user with <role>`), and wait for `Signed in`. A sign-in page that appears in the middle of a test is not a Failed result: it is Blocked until the tester signs in. A tester without a browser pane is in manual mode.
   Then, at the app address,  do the test's steps in order, with their data. After each step, compare what the screen shows with the step's expected result. Keep the URL path, a short note of what the screen showed, any browser console errors, and the evidence of the failing step (or the last one): run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" evidence <RUN> <TEST KEY> --step <n>`, which prints the file path for it, and save the screenshot there with the browser tool when it can save a file. If it cannot, say `Evidence: this browser tool cannot save a screenshot to a file.` in the card, and keep the page text and the console errors in the note. Then show this card, end the turn, and never start the next test before an answer:

   ```
   Test <i>/<N> [TEST](url) <summary>
   Proposed: Failed. Step 3: expected "<expected>", the screen shows "<what it showed>"
     ✅ 1. <step>
     ✅ 2. <step>
     ❌ 3. <step>
   Console: <errors, or none>
   Evidence: <file path, or why there is none>
   Xray: <status it will set, with the Xray API; leave the line out without it>
   1. Failed: draft the defect
   2. Passed
   3. Run it again
   4. Blocked: a step could not be done
   5. Skip it (leave it To Do)
   6. Stop
   ```

   `Proposed:` is `Passed`, `Failed` with the first failing step (expected, then what the screen shows), or `Blocked` with the reason. The `Xray:` line names the status the answer sets, from `qa.mjs pick ok|ko|blocked --from "<the status names of get_test_run>"` (`ask` in its result: ask the tester which one, once). Record every answer: `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" state record <RUN> <TEST KEY> ok|ko|blocked|skipped --story <STORY KEY> [--step <n>] [--note "<one line>"] [--evidence <path>] [--run-id <id>]`.
   - `1` goes to step 5, then the next test.
   - `2`: record `ok`; with the Xray API, set the status with `set_test_run_status` (it is on the card) and record it with `--xray set`. Go on with the next test.
   - `4`: record `blocked` with the reason as the note; with the Xray API, set the BLOCKED (or ABORTED) status the same way. The script's answer says when the environment looks down (`blockedInARow`, `stopSuggested`): then show `<n> tests blocked in a row: the environment looks down. 1. Stop the run / 2. Keep going`, and end the turn. `1` goes to step 7.
   - `5`: record `skipped`. Nothing is set in Xray.
   - `3` runs the test again. `6` goes to step 7.

   **Auto-pass:** when it is on, a test you propose as Passed is recorded with no card: show one line `✅ <TEST> passed` and go on to the next test, with no answer needed. A Failed or Blocked test shows its card as above. With auto-pass, the Xray statuses of the Passed tests are set at the close (step 7), on the close card's yes, not one by one.

   **Manual mode:** do not use the browser. Show the test's steps and expected results, ask `What happened? (passed, or what you saw instead)` and end the turn. The reply is the verdict, and its text is the actual result. Record it the same way.
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
   3. Attach the evidence file of the test (`qa.mjs state show` has its path; the one step 4 saved) with `uploadAttachmentToJiraIssue`. If there is none, say `Attach the screenshot by hand.` The description's Actual result says which file is attached.
   4. With the Xray API: `add_defect_to_test_run` with the test's run id and the defect key, then `set_test_run_status` with the FAILED status (`qa.mjs pick ko`).
   5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <DEFECT KEY> defect`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" state record <RUN> <TEST KEY> ko --defect <DEFECT KEY> [--xray set]` (`--xray set` when the status was set).

   Say `Filed [BUG](url), assigned to <developer>.` and go on with the next test.
6. **Retest** (option 2 of step 3). For each open defect, follow its steps to reproduce at the app address and compare the result with its expected result. Show this card and end the turn:

   ```
   Retest [BUG](url) <summary>
   Proposed: NOT FIXED. <what the screen shows>
   1. Not fixed: comment on the defect
   2. Not fixed: file a new defect, linked to this one
   3. Fixed: draft the comment
   4. Run it again
   5. Skip
   ```

   `Proposed:` is `FIXED`, `NOT FIXED` or `Blocked`, with the reason. The comment follows the tester's last comment on the defect that starts with `Retest`. Without one, use:

   ```
   Retest - <FIXED | NOT FIXED>
   <what was done, one line per step>
   Improved: <what now works, if anything>
   Still open: <what still fails>
   Path: <URL path>
   ```

   Show it with `1. Post it / 2. Change something / 3. Don't post`. On `1`, post it with `addCommentToJiraIssue`, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <BUG KEY> retest`. After `Fixed`, list the defect's transitions (`getTransitionsForJiraIssue`) as a numbered card of the statuses they lead to, plus `Leave it`. Apply the one picked with `transitionJiraIssue`, then run `ticket.mjs jira-posted <BUG KEY> status`.

   **A new defect** (option 2): file it as step 5 does, pre-filled in the tester's usual structure (type, style, parent, components, sprint and assignee as there), with `Re-found after [BUG](url): <what still fails>` under Notes and the old bug's steps and expected result as its steps and expected result. Link it to the old one with a link type named `Relates` (ignoring case) from `listJiraIssueLinkTypes`; with none, skip the link and say so. Then go on with the tests (step 4).
7. **Close.** Show:

   ```
   [RUN](url): <k> failed · <o> passed · <b> blocked · <s> skipped · <r> not run
   Defects filed: [BUG](url), …
   In Xray, set these by hand (no Xray API key here):
     [TEST](url) FAILED, and add [BUG](url) under Findings
     [TEST](url) PASSED
   ```

   The Xray lines are each test answered Passed, Failed or Blocked, plus the test of each retested defect (FIXED is PASSED, NOT FIXED is FAILED). Take the counts from `qa.mjs state show <RUN>`: a test whose status was already set in the run (`xraySet`) is left out of the list below. **With the Xray API**, these are a write instead of a by-hand list (and the defects are already on their runs, from step 5). Take the status names from `get_test_run` and pick each with `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" pick ok|ko|blocked --from "<the names, comma-separated>"`: it gives one name, or `ask` with the candidates: then ask the tester once. Only the tests not yet set are listed. Show this card and end the turn:

   ```
   Set in Xray:
     [TEST](url) PASSED
     [TEST](url) FAILED
   1. Set them
   2. Leave them
   ```

   On `1`, call `set_test_run_status` for each test, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <TEST KEY> status` for each status set.

   Save the outcome: `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" state close <RUN> ko` when any test is Failed, `ok` when every test is Passed, else `open`.

   If every test of the run is now Passed or Failed, offer the status change. Read the run's and the story's transitions (`getTransitionsForJiraIssue`) and pick with `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" pick run-ko|run-done --from "<the transition names>"`: if any test is Failed, `run-ko` for the run and for the story (the `qa.statuses.ko` of the config, else the one name with `KO` or `fail`); if all are Passed, `run-done` for the run (the `qa.statuses.done`, else ask which Done-category status), and the story is not changed. `ask` in a result: list the transitions and let the tester pick one or leave it. Show the proposal and end the turn:

   ```
   Move [RUN](url) to <status> and [STORY](url) to <status>?
   1. Yes
   2. Only the run
   3. Leave both
   ```

   Apply with `transitionJiraIssue`, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/ticket.mjs" jira-posted <KEY> status` for each issue moved. If any test is not run, blocked or skipped, there is no status card: say `Blocked and skipped tests stay To Do or Blocked: run /quality-code:qa <RUN> --resume when the environment is back.`

8. **Next.** After step 7, name the next run of the story's flow that is not Done (from the story flow block of step 3): `Next in this story: [KEY](url) · <status> · <what it covers>. Run /quality-code:qa <KEY>.` With none left, say `Every run of this story is done.` Stop: each run needs its key.
9. **Watch** (`--watch`). The stories you sent back, and when they are ready to retest. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" jql watch`: exit 2 shows its message (it asks for `qa.statuses.ready`, the name of your "ready to test" status) and stops; with no story (`jql` is null) say `Nothing to watch yet: no closed run with a failed test.` and stop. Otherwise show the stories and the JQL, and ask when to look, with a numbered card: `1. Every weekday at 09:00 / 2. Every 2 hours on weekdays / 3. Type a cron`, then end the turn. Nothing is scheduled without a yes. With Claude's scheduler, `create_scheduled_task` with `taskId` `quality-code-qa-watch`, `title` `Quality Code QA watch`, `cronExpression` in the user's local time, and this `prompt`, which must stand on its own: `In the project folder <absolute project path>, run /quality-code:qa --watch-check and show its output exactly as printed.` If the scheduler tools are not available, use `CronCreate` and say `This lasts only while this Claude session is open.` Say in one line when it looks next.
   **`--watch-check`** (what each scheduled run does): run `qa.mjs jql watch`; with no `jql`, stop silently. Call `searchJiraIssuesUsingJql` with that JQL and fields `summary,status`. No hit: say `Nothing is ready to retest.` and stop. Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/bin/qa.mjs" watch fresh --found <the keys found, comma-separated>`; for each key in `fresh`, say `[STORY](url) is ready to retest. Run /quality-code:qa <RUN from the watch> and pick "Retest the open defects first".` Nothing fresh: `Nothing new.` Never retest, post or move anything here: it only tells.

## Examples

- `/quality-code:qa ABC-123 --app https://app-test.example.com`: run that one on that app
- `/quality-code:qa ABC-123` with the run's Xray export (CSV) attached: the tests come from the file, not the Jira page
- `/quality-code:qa ABC-123 --auto-pass`: record the tests that pass without a card, stop at the first failure
- `/quality-code:qa ABC-123 --resume`: go on from the saved answers of that run
- `/quality-code:qa --watch`: tell me when a story I sent back is ready to retest
- `/quality-code:qa ABC-123 --dry-run`: the whole run, with every defect and comment shown and nothing sent
