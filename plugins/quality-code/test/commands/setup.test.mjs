// The setup command is a prompt, not code: these pin the instructions that keep it usable on a
// large Jira project shared by many teams.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../../commands/setup.md', import.meta.url), 'utf8')
// Steps are "0." to "4." for the short setup and "A1." to "A5." for the advanced one.
const step = id => {
  const from = doc.indexOf(`\n${id}. **`)
  const rest = doc.slice(from + 1)
  const next = rest.slice(1).search(/\n(?:\d+|A\d+)\. \*\*/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

test('A2: the label search can be narrowed before counting', () => {
  const s = step('A2')
  for (const option of ['1. All recent tickets of the project', '2. Only tickets with a word in the title', '3. Only one component', "4. I'll type my labels"]) {
    assert.ok(s.includes(option), option)
  }
  assert.ok(s.includes('summary ~ "<word>"'))
  assert.ok(s.includes('component = "<component>"'))
  assert.ok(s.includes('labels = "<label>"'))
  assert.match(s, /searchResultMode`? `?count/)
  assert.match(s, /fields `labels,summary`/)
  assert.match(s, /`maxResults` 100/)
  assert.match(s, /unknown/i)
  assert.match(s, /Title prefixes[\s\S]*narrowed/)
})
test('Jira tools are named by operation, never by an mcp__ tool name', () => {
  assert.doesNotMatch(doc, /mcp__/)
})
test('A2 (playwright): qaPlanSearch from the label, and the Confluence spaces offered', () => {
  const s = step('A2')
  assert.match(s, /`_` and `-` replaced by spaces/)
  assert.match(s, /searchConfluenceUsingCql/)
  assert.match(s, /distinct spaces/)
  assert.match(s, /key and name/)
  assert.ok(s.includes('<n>. All spaces'))
  assert.match(s, /`confluenceSpaces`/)
  assert.match(step('A5'), /confluenceSpaces/)
  assert.match(step('A5'), /qaPlanSearch/)
})
test('A2: every typed value is escaped for JQL; the title word keeps letters, digits and spaces', () => {
  const s = step('A2')
  assert.match(s, /escape `\\` as `\\\\` and `"` as `\\"`/)
  assert.match(s, /title word, a component name, a label/)
  assert.match(s, /letters, digits and spaces only/)
  assert.doesNotMatch(s, /drop any `"` from it/)
})
test('A2: the component card ends with a way to type a component name', () => {
  assert.ok(step('A2').includes('`<n>. Type a component name`'))
})
test('A2 (playwright): each feature\'s QA-plan search is tried once, and a title mismatch offers the hits', () => {
  const s = step('A2')
  assert.match(s, /ONE `searchConfluenceUsingCql` per feature/)
  assert.match(s, /scoped to the picked spaces/)
  assert.match(s, /no hit's title contains all the words/)
  assert.match(s, /up to 5 hit titles/)
  assert.ok(s.includes('`<n>. Type other search words`'))
  assert.ok(s.includes('`<n>. No QA plan for this feature`'))
  assert.match(s, /search words taken from that title/)
})

test('the short setup asks only for connectors, the project here and the Jira project', () => {
  const short = doc.slice(0, doc.indexOf('## Advanced'))
  assert.ok(step(0).includes('guides/connectors.md'))
  assert.ok(step(2).includes('This project'))
  assert.ok(step(2).includes('here.gitlab'))
  assert.match(step(2), /check gitlab_api_url/)
  assert.ok(step(3).includes('getVisibleJiraProjects'))
  assert.match(step(3), /Ask nothing else/)
  for (const w of ['getJiraIssueTypeMetaWithFields', 'labels,summary', 'titlePrefixes', 'searchConfluenceUsingCql', 'Templates.']) assert.ok(!short.includes(w), w)
  assert.ok(step(4).includes('jira { site, projects }'))
  assert.ok(step(4).includes('git { base }'))
  assert.match(step(4), /keep every other field of `existing` unchanged/)
  assert.ok(step(5).startsWith('5. **Done.**'))
  assert.match(step(5), /Do not read, score or comment on any ticket/)
  assert.doesNotMatch(step(5), /ticket-eval\.md|searchJiraIssuesUsingJql|getJiraIssue/)
  for (const c of ['/quality-code:spec.', '/quality-code:spec <KEY>', '--gate-only', '/quality-code:setup advanced']) assert.ok(step(5).includes(c), c)
})
test('advanced keeps the full questions and needs a config', () => {
  assert.match(doc, /If `\$ARGUMENTS` contains `advanced`, go to \*\*Advanced\*\*/)
  assert.match(step('A1'), /trackingProjects/)
  assert.match(step('A3'), /Language and redaction/)
  assert.match(step('A4'), /Templates/)
  assert.match(doc.slice(doc.indexOf('## Advanced')), /without one, run steps 0 to 4 first/)
})

test('A4: the boundaries card (advanced setup; the short setup uses the defaults)', () => {
  const s = step('A4')
  assert.match(s, /Paths a test run must never change/)
  for (const o of ['1. Keep this list', '2. Add a path', '3. Remove a path']) assert.ok(s.includes(o), o)
  assert.match(s, /specsBesideCode/)
  assert.ok(s.includes('src/**/*.spec.ts'))
  assert.match(step('A5'), /boundaries/)
})
test('A4: the Vitest configs card (only for vitest with more than one config)', () => {
  const s = step('A4')
  assert.match(s, /Which Vitest config runs which tests/)
  assert.match(s, /vitestConfigs/)
  assert.match(s, /more than one/)
  assert.ok(s.includes('vitest: { configs: [{ match, config }'))
  assert.match(s, /existing `vitest` block/)
  assert.ok(s.indexOf('Which Vitest config runs which tests') > s.indexOf('Paths a test run must never change'))
  assert.match(step('A5'), /`vitest`[^.]*configs|configs[^.]*`vitest`/)
})
test('the short setup does not mention Vitest configs', () => {
  const short = doc.slice(0, doc.indexOf('## Advanced'))
  assert.doesNotMatch(short, /vitestConfigs|Vitest config/i)
})
test('A4: a rerun keeps existing.boundaries and offers the candidates only as additions', () => {
  const s = step('A4')
  assert.match(s, /existing\.boundaries/)
  assert.match(s, /keep/i)
  assert.match(s, /additions/)
  assert.match(s, /`why`/)
  assert.match(s, /`allow`/)
})
test('A4: the Test folders card proposes vitest.layers from specFolders (only for vitest)', () => {
  const s = step('A4')
  assert.match(s, /\*\*Test folders\.\*\* Only for `vitest`/)
  assert.match(s, /`specFolders`/)
  assert.ok(s.includes('`test/unit/` becomes `unit`'))
  assert.ok(s.includes('[{ "name": "unit", "folder": "test/" }]'))
  for (const o of ['1. Use these test folders', '2. Change a test folder', '3. Skip']) assert.ok(s.includes(o), o)
  assert.ok(s.includes('vitest: { layers: [{ "name", "folder" }'))
  assert.match(s, /inside a forbidden boundary[^.]*refused by `setup\.mjs --write`/)
  assert.match(s, /existing\.vitest\.layers/)
  assert.ok(s.indexOf('**Test folders.**') > s.indexOf('Which Vitest config runs which tests'))
  assert.match(step('A5'), /`vitest` `layers`/)
})
test('the short setup does not mention test folders', () => {
  const short = doc.slice(0, doc.indexOf('## Advanced'))
  assert.doesNotMatch(short, /specFolders|Test folders|layers/)
})

test('fullstack: a repo with both asks what the project is; sides, Playwright configs in a subfolder', () => {
  assert.ok(doc.includes('This repo has both Vitest and Playwright.\n     1. Fullstack: backend tests with Vitest, frontend tests with Playwright\n     2. Frontend only: Playwright\n     3. Backend only: Vitest'))
  assert.match(doc, /`1` gives `adapter: "fullstack"`, `2` `"playwright"`, `3` `"vitest"`/)
  assert.match(doc, /\*\*Ticket sides\*\* \(only for `fullstack`\)/)
  assert.match(doc, /\*\*Where Playwright runs\.\*\* Only for `playwright` and `fullstack`, and only when `playwrightConfigs`/)
  assert.match(doc, /For `fullstack`, leave out the e2e folder/)
  assert.ok(doc.includes('With no config at all (`playwrightConfigs` is empty), say once and go on: `No Playwright config found. The tests need one with a baseURL, and a webServer or the app already running: npm init playwright@latest creates it.`'))
  assert.match(doc, /the path the app's router uses \(for example `\/orderHistory`\), not a folder name/)
})
test('no Atlassian connection: setup defers to the Jira card, it has no ticket to paste', () => {
  assert.ok(!doc.includes('Or paste the ticket text'))
  assert.match(doc, /If none is connected, step 0's Jira card \(in `connectors\.md`\) says what to do/)
})
test('setup says plainly that Jira Server and Data Center sites cannot be used', () => {
  assert.match(doc, /Only Atlassian Cloud sites work/)
  assert.ok(doc.includes('`quality-code needs Jira Cloud: the Atlassian connector cannot reach <site>.`'))
})

// AGT-112: a clean setup (Jira connected, one site, git history naming one project) takes two answers.
test('a clean setup takes two answers: the Where card and the Confirm card', () => {
  const short = doc.slice(0, doc.indexOf('## Advanced'))
  assert.match(short, /A clean setup takes two answers: the \*\*Where\*\* card and the \*\*Confirm\*\* card/)
  assert.match(step(0), /every connector is ✅, it shows one line and no card: go on to step 1 in the same turn/)
  assert.match(step(2), /No card here/)
  assert.match(step(3), /No card when the values are clear/)
  assert.match(short, /Run `setup\.mjs --detect` once/)
  assert.match(short, /without calling them again/)
})
test('the Confirm card shows the folder, stack, Jira, base and the config, then write / change / cancel', () => {
  const s = step(4)
  for (const l of ['Quality Code setup', 'Folder   <here.folder>', 'Remote   <here.remote.path>', 'Stack    <frontend (Playwright)', 'Jira     <site host>, project(s) <keys>', 'Base     <branch>', 'Writes .claude/quality-code.json:', '<the config JSON>', '1. Write it', '2. Change something', '3. Cancel']) assert.ok(s.includes(l), l)
  assert.ok(s.includes('Remote   none'))
})
test('Change something asks only for the value to change, then shows the Confirm card again', () => {
  const s = step(4)
  assert.ok(s.includes('Change what?\n     1. Stack\n     2. Jira site\n     3. Jira project\n     4. Base branch'))
  assert.match(s, /ask only which value to change/)
  assert.match(s, /type the new value with the number \(for example `4 main`\)/)
  assert.match(s, /show the Confirm card again with the new value/)
  assert.match(s, /Stack only when `adapter` is `both`/)
})
test('both runners: fullstack is proposed and the both card is shown only to change it', () => {
  const s = step(2)
  assert.match(s, /`both` \(the repo has Vitest and Playwright\): propose `fullstack`/)
  assert.match(s, /Ask nothing now; to change it from the Confirm card/)
})
test('the site is not asked when there is exactly one', () => {
  assert.match(step(3), /exactly one site, use it and ask nothing/)
  assert.match(step(3), /With several, show them as a numbered list/)
})
// AGT-110: the project from the history, a typed key checked, the full list only for 20 projects or fewer.
test('the Jira project is proposed from branch names and commits, and checked with one call', () => {
  const s = step(3)
  assert.match(s, /`projectCandidates`/)
  assert.match(s, /branch names and recent commit subjects, most frequent first/)
  assert.ok(s.includes('`getVisibleJiraProjects` call with `searchString` `<KEY>`'))
  assert.match(s, /key is exactly `<KEY>`/)
  assert.match(s, /at most 3 calls/)
})
test('a typed key that does not exist is refused and asked again', () => {
  const s = step(3)
  assert.ok(s.includes('`<KEY> does not exist on <site host>, or this account cannot see it.`'))
  assert.match(s, /ask for the key again and end the turn/)
})
test('the numbered project list only for 20 projects or fewer', () => {
  const s = step(3)
  assert.match(s, /`maxResults` 21/)
  assert.match(s, /20 projects or fewer: show them as a numbered list/)
  assert.match(s, /More than 20[^:]*: never list them/)
  assert.ok(s.includes('`Which Jira project? Type its key (for example ABC).`'))
})
// AGT-111: the base branch is proposed, shown and written.
test('the base branch: merge requests, else develop or origin/HEAD from detect; written as git.base', () => {
  const s = step(2)
  assert.match(s, /\*\*Base branch\*\* \(`git\.base`/)
  assert.match(s, /keep `existing\.git\.base`/)
  assert.match(s, /one read-only GitLab call for its 20 most recently merged merge requests/)
  assert.match(s, /most common target branch/)
  assert.match(s, /`base\.proposed`/)
  assert.match(s, /`base\.source` `develop`/)
  assert.match(s, /`origin-head`/)
  assert.match(step(4), /`git \{ base \}` \(left out when no base was found\)/)
  assert.match(step(5), /base <branch>/)
})
