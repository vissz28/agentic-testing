# Part 1: Core and configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-contained `agentic-testing` Claude Code plugin whose core (config, languages, criteria, rubrics, score, sanitize, fill-in, Jira, CLI, setup) contains no warehouse value and reproduces today's warehouse readiness gate exactly from configuration.

**Architecture:** Plain Node ES modules under `plugins/agentic-testing/core/`, no npm dependencies. A project file `.claude/agentic-testing.json` (written by `setup`) supplies team values; Claude Code `userConfig` supplies personal values. Two rubric modules carry the per-stack weights and detectors. Behaviour is ported from today's scripts and proven identical by a parity suite that runs the old scripts and the new core side by side.

**Tech Stack:** Node ≥ 18 (built-ins only), `node --test`, Claude Code plugin manifest, GitHub Actions.

**Spec:** `docs/specs/2026-10-12-part-1-core-config-design.md` (read it first; this plan argues from it).

## Global Constraints

- No npm dependencies in `plugins/agentic-testing/core/` or its tests: imports are `node:*` or relative only.
- Pass bar is the constant `70`; it must not be read from config or flags.
- Plain-language criteria minimum: `MIN_NATURAL_AC = 150` characters of criteria text (bullets stripped).
- No warehouse value in `core/`: none of `FIC`, the 8 warehouse labels, `teamsystem.atlassian.net`, `customfield_11707`, `warehouse` may appear in `plugins/agentic-testing/core/**` (tests and fixtures excepted).
- Config file path: `.claude/agentic-testing.json` relative to the project root; project root = `$CLAUDE_PROJECT_DIR` if set, else `process.cwd()`.
- stdout contract kept: `TICKET_EVAL_JSON:`, `FILL_JSON:`, `JIRA_UPDATE_JSON:` line prefixes; exit codes as in spec §6.
- Connector names fixed: `atlassian-rovo`, `figma`, `gitlab`.
- Fixtures entering the repo must not match `U\d{5,}` or contain real e-mail addresses.
- Style: 2-space indent, single quotes, no semicolons (the frontend harness style).

## Review Focus

1. **A config that is valid JSON but semantically wrong** (duplicate feature labels, a route without a leading `/`, `languages: []`) must fail `config check` with the field named — not score with a silently empty vocabulary. → tests in Task 1.
2. **A ticket whose key belongs to a project not in `jira.projects`** must be reported, not scored as if it belonged. → test in Task 8 (`score` prints a `PROJECT_MISMATCH` warning line and exits 2 under `--ci`).
3. **Windows line endings (`\r\n`) in Jira text** must not break heading/section detection (today's regexes are `\n`-based). → test in Task 3 (normalise `\r\n` → `\n` at the entry of every text function).
4. **`$CLAUDE_PROJECT_DIR` unset** (running the CLI by hand) must fall back to `cwd`, and a `--in @file` relative path must resolve against the project root, not the plugin folder. → test in Task 8.
5. **A config written by an older plugin version** (`version` missing or `0`) must give "re-run setup", not a stack trace. → test in Task 1.

---

## File Structure

```
plugins/agentic-testing/
├─ .claude-plugin/plugin.json          Task 11  manifest + userConfig
├─ .mcp.json                           Task 11  connectors using ${user_config.*}
├─ commands/setup.md                   Task 11  /agentic-testing:setup
├─ commands/ticket-eval.md             Task 11  /agentic-testing:ticket-eval
├─ schema/agentic-testing.schema.json  Task 1   format documentation
├─ package.json                        Task 1   {"type":"module"} + test script (no deps)
├─ core/
│  ├─ config.mjs                       Task 1   find, load, validate
│  ├─ text.mjs                         Task 2   normalise text, regex helpers
│  ├─ languages/en.mjs, it.mjs, index.mjs   Task 2   keyword packs + combinator
│  ├─ criteria.mjs                     Task 3   criteria reader, vague, derivable
│  ├─ rubrics/playwright.mjs, vitest.mjs    Task 4   weights + detectors + brief extras
│  ├─ score.mjs                        Task 4   rubric pick, score, gate 70, brief, report
│  ├─ messages.mjs                     Task 5   default texts + merge with config.messages
│  ├─ jira.mjs                         Task 5   refuse comment, template line, browse URL, push payload
│  ├─ sanitize.mjs                     Task 6   redaction
│  ├─ fill.mjs                         Task 7   menu, pick, add, filled record
│  ├─ cli.mjs                          Task 8   commands + exit codes
│  └─ setup.mjs                        Task 10  --detect / --write
└─ test/
   ├─ *.test.mjs                       one per module
   ├─ parity/configs/warehouse-frontend.json, warehouse-backend.json   Task 9
   ├─ parity/fixtures/*.json           Task 9   redacted inputs
   ├─ parity/expected/*.json           Task 9   outputs captured from today's scripts
   └─ parity.test.mjs                  Task 9
scripts/capture-parity.mjs             Task 9   runs today's scripts, writes parity/expected
.github/workflows/test.yml             Task 12
.claude-plugin/marketplace.json        Task 11  add the agentic-testing entry
```

Source of today's behaviour (read-only, referenced by task):
- **FE scorer**: `git -C ../warehouse-frontend show origin/agentic-testing-fe:.claude/harness/score-ticket.mjs`
- **BE scorer**: `git -C ../warehouse-backend show origin/agt-34-remove-audit-logs:.claude/harness/score-ticket.mjs`
- **BE criteria/derivable**: same ref, `.claude/harness/expected-check.mjs`
- **BE sanitizer**: same ref, `.claude/harness/sanitize-ticket.mjs`

Line numbers below are from those refs.

---

### Task 1: Plugin skeleton and `config.mjs`

**Files:**
- Create: `plugins/agentic-testing/package.json`
- Create: `plugins/agentic-testing/core/config.mjs`
- Create: `plugins/agentic-testing/schema/agentic-testing.schema.json`
- Test: `plugins/agentic-testing/test/config.test.mjs`

**Interfaces:**
- Produces:
  - `projectRoot(env = process.env, cwd = process.cwd()) → string`
  - `configPath(root) → string` (`<root>/.claude/agentic-testing.json`)
  - `validateConfig(obj) → { ok: true, config } | { ok: false, errors: string[] }` — `config` has defaults filled
  - `loadConfig(root) → { ok, config?, errors?, missing?: true }`
  - `DEFAULTS` (frozen): `titlePrefixes`, `ticketsDir`, `redact`, `messages`, `ticketTemplates`, `jira.trackingProjects`

- [ ] **Step 1: Create the package file**

```json
{
  "name": "agentic-testing-core",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/" }
}
```

- [ ] **Step 2: Write the failing tests**

```js
// test/config.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig, loadConfig, projectRoot, configPath } from '../core/config.mjs'

const good = {
  version: 1,
  adapter: 'playwright',
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en'],
  features: [{ label: 'Orders', route: '/orders' }],
}

test('a minimal valid config passes and gets defaults', () => {
  const r = validateConfig(good)
  assert.equal(r.ok, true)
  assert.deepEqual(r.config.titlePrefixes, ['FE', 'BE', 'FS'])
  assert.equal(r.config.ticketsDir, '.claude/agentic-testing/tickets')
  assert.deepEqual(r.config.redact, { customerId: 'U\\d{5,}' })
  assert.deepEqual(r.config.jira.trackingProjects, [])
})

const bad = (patch, field) =>
  test(`invalid: ${field}`, () => {
    const r = validateConfig(structuredClone({ ...good, ...patch }))
    assert.equal(r.ok, false)
    assert.ok(r.errors.some(e => e.startsWith(field)), `${field} not named in: ${r.errors.join(' | ')}`)
  })

bad({ version: 2 }, 'version')
bad({ version: undefined }, 'version')
bad({ adapter: 'jest' }, 'adapter')
bad({ jira: { ...good.jira, site: 'example.atlassian.net' } }, 'jira.site')
bad({ jira: { ...good.jira, projects: [] } }, 'jira.projects')
bad({ jira: { ...good.jira, projects: ['fic'] } }, 'jira.projects[0]')
bad({ jira: { ...good.jira, acceptanceCriteriaField: '11707' } }, 'jira.acceptanceCriteriaField')
bad({ languages: [] }, 'languages')
bad({ languages: ['fr'] }, 'languages[0]')
bad({ features: [{ label: 'A' }, { label: 'A' }] }, 'features[1].label')
bad({ features: [{ label: 'A', route: 'orders' }] }, 'features[0].route')
bad({ redact: { x: '(' } }, 'redact.x')
bad({ surprise: true }, 'surprise')

test('the old-version message tells you to re-run setup', () => {
  const r = validateConfig({ ...good, version: undefined })
  assert.match(r.errors.join(' '), /re-run \/agentic-testing:setup/)
})

test('loadConfig reports a missing file distinctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  assert.deepEqual(loadConfig(dir), { ok: false, missing: true, errors: ['This repo is not set up. Run /agentic-testing:setup.'] })
})

test('loadConfig reads and validates the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude/agentic-testing.json'), JSON.stringify(good))
  assert.equal(loadConfig(dir).ok, true)
})

test('loadConfig names a JSON syntax error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude/agentic-testing.json'), '{ "version": 1, ')
  const r = loadConfig(dir)
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /not valid JSON/)
})

test('projectRoot prefers CLAUDE_PROJECT_DIR, else cwd', () => {
  assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: '/p' }, '/c'), '/p')
  assert.equal(projectRoot({}, '/c'), '/c')
  assert.equal(configPath('/p'), '/p/.claude/agentic-testing.json')
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd plugins/agentic-testing && node --test test/config.test.mjs`
Expected: FAIL — `Cannot find module '../core/config.mjs'`.

- [ ] **Step 4: Implement `core/config.mjs`**

```js
// Find, load and validate the team config. The only module that knows where it lives.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_REL = '.claude/agentic-testing.json'
const SETUP = 'Run /agentic-testing:setup.'
const KEY = /^[A-Z][A-Z0-9]+$/
const FIELDS = new Set(['version', 'adapter', 'jira', 'languages', 'features', 'titlePrefixes', 'ticketTemplates', 'ticketsDir', 'redact', 'messages'])
const LANGS = new Set(['en', 'it'])

export const DEFAULTS = Object.freeze({
  titlePrefixes: ['FE', 'BE', 'FS'],
  ticketsDir: '.claude/agentic-testing/tickets',
  redact: { customerId: 'U\\d{5,}' },
  messages: {},
  ticketTemplates: { bug: null, story: null },
})

export const projectRoot = (env = process.env, cwd = process.cwd()) => env.CLAUDE_PROJECT_DIR || cwd
export const configPath = root => join(root, CONFIG_REL)

export function validateConfig(input) {
  const e = []
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /agentic-testing:setup)`)
  if (c.version !== 1) e.push(`version: must be 1 (found ${JSON.stringify(c.version)}); re-run /agentic-testing:setup`)
  if (!['playwright', 'vitest'].includes(c.adapter)) e.push(`adapter: must be "playwright" or "vitest" (found ${JSON.stringify(c.adapter)})`)
  const j = c.jira ?? {}
  if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
  if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "FIC"')
  else j.projects.forEach((p, i) => { if (!KEY.test(p)) e.push(`jira.projects[${i}] "${p}" must be upper-case letters and digits, like "FIC"`) })
  if (!('acceptanceCriteriaField' in j) || !(j.acceptanceCriteriaField === null || /^customfield_\d+$/.test(j.acceptanceCriteriaField)))
    e.push('jira.acceptanceCriteriaField: must be null or like "customfield_11707"')
  ;(j.trackingProjects ?? []).forEach((p, i) => { if (!KEY.test(p)) e.push(`jira.trackingProjects[${i}] "${p}" must be upper-case letters and digits`) })
  if (!Array.isArray(c.languages) || c.languages.length === 0) e.push('languages: must list at least one of "en", "it"')
  else c.languages.forEach((l, i) => { if (!LANGS.has(l)) e.push(`languages[${i}] "${l}" is not supported (supported: en, it)`) })
  if (!Array.isArray(c.features)) e.push('features: must be a list (it may be empty)')
  else {
    const seen = new Set()
    c.features.forEach((f, i) => {
      if (!f || typeof f.label !== 'string' || !f.label.trim()) e.push(`features[${i}].label: must be a non-empty text`)
      else if (seen.has(f.label)) e.push(`features[${i}].label "${f.label}" appears twice`)
      else seen.add(f.label)
      if (f?.route != null && !/^\//.test(f.route)) e.push(`features[${i}].route "${f.route}" must start with "/"`)
    })
  }
  for (const [name, src] of Object.entries(c.redact ?? {})) {
    try { new RegExp(src) } catch { e.push(`redact.${name}: not a valid regular expression`) }
  }
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      jira: { trackingProjects: [], ...j },
      titlePrefixes: c.titlePrefixes ?? DEFAULTS.titlePrefixes,
      ticketsDir: c.ticketsDir ?? DEFAULTS.ticketsDir,
      redact: c.redact ?? DEFAULTS.redact,
      messages: c.messages ?? DEFAULTS.messages,
      ticketTemplates: { ...DEFAULTS.ticketTemplates, ...(c.ticketTemplates ?? {}) },
    },
  }
}

export function loadConfig(root) {
  const p = configPath(root)
  if (!existsSync(p)) return { ok: false, missing: true, errors: [`This repo is not set up. ${SETUP}`] }
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, errors: [`${CONFIG_REL} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  return validateConfig(obj)
}
```

- [ ] **Step 5: Write the schema file** (documentation of the same rules)

`schema/agentic-testing.schema.json`: JSON Schema draft 2020-12 with `additionalProperties: false`, the required list `["version","adapter","jira","languages","features"]`, and one property per field of spec §4.2 with the same patterns (`^[A-Z][A-Z0-9]+$`, `^customfield_\\d+$`, `^https://`, route `^/`).

- [ ] **Step 6: Run the tests and verify they pass**

Run: `node --test test/config.test.mjs` → Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/agentic-testing/package.json plugins/agentic-testing/core/config.mjs plugins/agentic-testing/schema plugins/agentic-testing/test/config.test.mjs
git commit -m "feat(core): project config loading and validation"
```

---

### Task 2: Text helpers and language packs

**Files:**
- Create: `core/text.mjs`, `core/languages/en.mjs`, `core/languages/it.mjs`, `core/languages/index.mjs`
- Test: `test/languages.test.mjs`

**Interfaces:**
- Produces:
  - `normalise(text) → string` (`\r\n`/`\r` → `\n`; `null`/`undefined` → `''`)
  - `alt(words) → string` (regex alternation of escaped-as-given sources, joined by `|`)
  - `buildVocabulary(langs: string[]) → Vocab` where `Vocab` has regexes:
    `gherkinStep`, `thenLine`, `thenLineCapture`, `thenAndLines`, `acHeading`, `listItem`, `thenStep`, `setupStep`, `continuation`, `sectionEnd`, `vague`,
    `stepsHeading`, `userStoryHeading`, `userStoryLine`, `expectedHeading`, `actualHeading`, `environmentHeading`, `contextHeadingFE`, `contextHeadingBE`,
    `expectedPhrase`, `actualPhrase` (backend question forms), `listOrStep` (fill-in bullet test)

Each pack is data only (strings that are regex sources). `buildVocabulary(['en','it'])` must reproduce today's regexes **behaviourally**. The current sources to copy word lists from:
- `hasGherkin` steps and `hasThen`: FE `score-ticket.mjs:188-196,288-292`
- `AC_HEADING`, `LIST_ITEM`, `THEN_STEP`, `SETUP_STEP`, `CONTINUATION`, `SECTION_END`: FE `score-ticket.mjs:198-214`
- `VAGUE`: FE `:294-295`
- headings and phrases in `deriveSignals`: FE `:314-353`, BE `:260-302`
- `LIST_OR_STEP`: FE `:538`

- [ ] **Step 1: Write the failing tests** — behavioural equivalence on fixed strings

```js
// test/languages.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVocabulary } from '../core/languages/index.mjs'
import { normalise } from '../core/text.mjs'

const v = buildVocabulary(['en', 'it'])
const yes = (re, s) => assert.ok(re.test(s), `${re} should match ${JSON.stringify(s)}`)
const no = (re, s) => assert.ok(!re.test(s), `${re} should not match ${JSON.stringify(s)}`)

test('gherkin steps EN+IT', () => {
  for (const s of ['Given a', '  When b', 'Then c', 'Dato a', 'Quando b', 'Allora c']) yes(v.gherkinStep, s)
  no(v.gherkinStep, 'Thenceforth')
})
test('criteria headings', () => {
  for (const s of ['## Acceptance criteria', '**Criteri di accettazione:**', 'AC:', 'Acceptance criteria']) yes(v.acHeading, s)
  no(v.acHeading, '## Actual')
})
test('section end', () => {
  for (const s of ['## Notes', '**Expected**', 'Expected result', 'Steps to reproduce', 'Risultato atteso', 'Short label:']) yes(v.sectionEnd, s)
  no(v.sectionEnd, 'The total is 150.')
})
test('vague words', () => {
  for (const s of ['it works correctly', 'working correctly', 'as expected', 'is fine', 'funziona correttamente', 'come previsto', 'come atteso']) yes(v.vague, s)
  no(v.vague, 'the total is 150')
})
test('english only drops Italian', () => {
  const en = buildVocabulary(['en'])
  no(en.gherkinStep, 'Dato a')
  no(en.vague, 'funziona correttamente')
  yes(en.gherkinStep, 'Given a')
})
test('backend question forms', () => {
  yes(v.expectedPhrase, 'What is the expected behavior?')
  yes(v.actualPhrase, 'Cosa succede?')
})
test('normalise CRLF', () => {
  assert.equal(normalise('a\r\nb\rc'), 'a\nb\nc')
  assert.equal(normalise(null), '')
})
test('unknown language throws', () => {
  assert.throws(() => buildVocabulary(['fr']), /not supported/)
})
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/languages.test.mjs` → FAIL (missing module).

- [ ] **Step 3: Implement**

`core/text.mjs`:

```js
export const normalise = t => String(t ?? '').replace(/\r\n?/g, '\n')
export const alt = words => words.join('|')
```

`core/languages/en.mjs` (Italian pack `it.mjs` has the same keys with the Italian words from the sources listed above):

```js
export default {
  steps: ['given', 'when', 'then'],
  then: ['then'],
  continuation: ['and', 'but'],
  setup: ['scenario(?: outline)?', 'feature', 'background', 'examples', 'given', 'when'],
  acHeading: ['acceptance\\s+criteria', 'AC'],
  sectionNames: ['summary', 'context', 'steps to reproduce', 'expected(?: result| behaviou?r)?', 'actual(?: result)?', 'environment', 'notes?', 'impact', 'user story', 'out of scope'],
  vague: ['works?\\s+correctly', 'working\\s+correctly', 'as\\s+expected', 'is\\s+fine'],
  stepsHeading: ['steps to reproduce'],
  userStoryHeading: ['user story'],
  userStoryLine: '\\bas an?\\b[^\\n]*\\bi want\\b',
  expectedHeading: ['expected'],
  actualHeading: ['actual'],
  environmentHeading: ['environment'],
  contextHeadingFE: ['context', 'summary', 'impact'],
  contextHeadingBE: ['context', 'summary'],
  expectedPhrase: ['\\bexpected\\s+(?:behavio(?:u)?r|result|outcome|value)\\b', 'what is the expected behavio(?:u)?r\\??'],
  actualPhrase: ['\\bwhat\\s+happens\\b', '\\bcurrent\\s+behavio(?:u)?r\\b'],
}
```

`core/languages/it.mjs` — the Italian words, copied from the source lines above:
`steps ['dato','quando','allora']`, `then ['allora']`, `continuation ['e','ma']`, `setup ['esempi','dato','quando']`,
`acHeading ['criteri\\s+di\\s+accettazione']`, `sectionNames ['contesto','sommario','passi per riprodurre','risultato atteso','risultato effettivo','comportamento attuale','ambiente','impatto','storia utente','fuori ambito']`,
`vague ['funziona\\s+correttamente','come\\s+previsto','come\\s+atteso']`, `stepsHeading ['passi per riprod\\w*']`, `userStoryHeading ['storia utente']`, `userStoryLine '\\bcome\\b[^\\n]*\\bvoglio\\b'`,
`expectedHeading ['risultato atteso']`, `actualHeading ['risultato effettivo','comportamento attuale']`, `environmentHeading ['ambiente']`,
`contextHeadingFE ['contesto','impatto']`, `contextHeadingBE ['contesto','sommario']`,
`expectedPhrase ['\\bcomportamento\\s+atteso\\b','\\brisultato\\s+atteso\\b','qual è il comportamento atteso\\??']`, `actualPhrase ['\\bcosa\\s+succede\\b']`.

`core/languages/index.mjs`:

```js
import en from './en.mjs'
import it from './it.mjs'
import { alt } from '../text.mjs'

const PACKS = { en, it }
const merge = (langs, k) => langs.flatMap(l => PACKS[l][k])

export function buildVocabulary(langs) {
  for (const l of langs) if (!PACKS[l]) throw new Error(`language "${l}" is not supported`)
  const m = k => alt(merge(langs, k))
  return {
    gherkinStep: new RegExp(`^\\s*(?:${m('steps')})\\b`, 'im'),
    gherkinStepAll: new RegExp(`^\\s*(?:${m('steps')})\\b`, 'gim'),
    thenLine: new RegExp(`^\\s*(?:${m('then')})\\b`, 'im'),
    thenLineCapture: new RegExp(`^\\s*(?:${m('then')})\\b(.*)$`, 'im'),
    thenAndLines: new RegExp(`^\\s*(?:${alt([...merge(langs, 'then'), 'and'])})\\b.*`, 'gim'),
    acHeading: new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:\\*\\*\\s*)?(?:${m('acHeading')})\\b\\s*:?\\s*(?:\\*\\*)?\\s*:?\\s*$`, 'i'),
    listItem: /^\s*(?:[-*•]|\d+[.)])\s+/,
    thenStep: new RegExp(`^\\s*(?:${m('then')})\\b\\s*(.*)$`, 'i'),
    setupStep: new RegExp(`^\\s*(?:${m('setup')})\\b`, 'i'),
    continuation: new RegExp(`^\\s*(?:${m('continuation')})\\b\\s*(.*)$`, 'i'),
    sectionEnd: new RegExp(`^\\s*(?:#{1,6}\\s|\\*\\*[^*]+\\*\\*\\s*:?\\s*$|[^\\s:][^:]{0,40}:\\s*$|(?:${m('sectionNames')})\\s*$)`, 'i'),
    vague: new RegExp(`\\b(${m('vague')})\\b`, 'i'),
    stepsHeading: m('stepsHeading'),
    userStoryHeading: m('userStoryHeading'),
    userStoryLine: merge(langs, 'userStoryLine').map(s => new RegExp(s, 'i')),
    expectedHeading: m('expectedHeading'),
    actualHeading: m('actualHeading'),
    environmentHeading: m('environmentHeading'),
    contextHeadingFE: m('contextHeadingFE'),
    contextHeadingBE: m('contextHeadingBE'),
    expectedPhrase: new RegExp(m('expectedPhrase'), 'i'),
    actualPhrase: new RegExp(m('actualPhrase'), 'i'),
    listOrStep: new RegExp(`^(?:[-*•]\\s|\\d+[.)]\\s|(?:${alt(['scenario', ...merge(langs, 'steps'), ...merge(langs, 'continuation')])})\\b)`, 'i'),
  }
}
```

Heading strings (`stepsHeading` …) stay as alternation sources because `hasHeading(text, wordsRe)` in Task 3 builds two regexes from a source, exactly as today (FE `:301-312`).

- [ ] **Step 4: Run the tests** → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): English and Italian language packs"`

---

### Task 3: `criteria.mjs`

**Files:**
- Create: `core/criteria.mjs`
- Test: `test/criteria.test.mjs`

**Interfaces:**
- Consumes: `buildVocabulary`, `normalise`
- Produces (every function takes the `Vocab` as first argument, so language is never global):
  - `hasHeading(v, text, wordsSrc) → boolean`
  - `hasGherkin(v, text) → boolean`, `hasThen(v, text) → boolean`, `hasVaguePhrase(v, text) → boolean`
  - `extractNaturalAC(v, text, { headingless }) → string[]`, `stripVagueCriteria(v, text, { headingless }) → string`
  - `naturalLength(items) → number`, `hasNaturalAC(items) → boolean`, `MIN_NATURAL_AC = 150`
  - `hasConcreteThen(v, scenario) → boolean`, `countDerivable(v, scenarios) → number`
  - `extractExpectedChunks(v, text) → string[]`, `countDerivableFromText(v, text) → number`

Port, adding the `v` parameter and replacing each module-level regex with the `v.*` equivalent, and calling `normalise()` on every text input:
- `hasHeading` FE `:301-312`; `hasGherkin` FE `:188-196`; `hasThen` FE `:288-292`; `hasVaguePhrase` FE `:296-299`
- `extractNaturalAC` FE `:216-254`; `stripVagueCriteria` FE `:256-274`; `naturalLength`/`hasNaturalAC` FE `:276-286`
- `hasConcreteThen` FE `:355-373`; `countDerivable` FE `:375-378`
- `extractExpectedChunks` BE `expected-check.mjs:28-54`; `countDerivableFromText` BE `expected-check.mjs:152-157`

- [ ] **Step 1: Write the failing tests** — the shared-rule cases of the alignment check, as a table

```js
// test/criteria.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVocabulary } from '../core/languages/index.mjs'
import * as C from '../core/criteria.mjs'

const v = buildVocabulary(['en', 'it'])
const L = 'The last cost is 0 after a movement with cost 0. The KPI row for that product shows 0 as its last unit cost, and the previous value of 50 is not shown anymore.'

test('150 rule: 149 no, 150 yes', () => {
  assert.equal(C.hasNaturalAC(C.extractNaturalAC(v, `## Acceptance criteria\n${'x'.repeat(149)}.`)), true)
  assert.equal(C.hasNaturalAC(C.extractNaturalAC(v, `## Acceptance criteria\n${'x'.repeat(148)}.`)), false)
})
test('mixed section reads prose and each Then with its And', () => {
  const items = C.extractNaturalAC(v, '## Acceptance criteria\nThe report title is in Italian.\nScenario: z\n  Given a\n  When b\n  Then the last cost is 0\n  And the KPI is updated\nAllora il costo è 0')
  assert.deepEqual(items, ['The report title is in Italian.', 'the last cost is 0', 'the KPI is updated', 'il costo è 0'])
})
test('HTML comments are not criteria', () => {
  assert.deepEqual(C.extractNaturalAC(v, '## Acceptance criteria\n<!--\n"Then it works correctly" fails.\n-->\nThe total is 150.'), ['The total is 150.'])
})
test('section ends at a bare section name', () => {
  assert.equal(C.extractNaturalAC(v, `## Acceptance criteria\n${L}\n\nSteps to reproduce\n1. open`).length, 2)
})
test('AC field needs no heading; prose without heading is nothing', () => {
  assert.equal(C.extractNaturalAC(v, `- ${L}`, { headingless: true }).length, 2)
  assert.equal(C.extractNaturalAC(v, L).length, 0)
})
test('stripVagueCriteria keeps prose outside the section', () => {
  assert.equal(
    C.stripVagueCriteria(v, '## Acceptance criteria\n- The list works correctly\n- The total is 150\nThen it works as expected\n## Notes\nThe old page works correctly'),
    '## Acceptance criteria\n- The total is 150\n## Notes\nThe old page works correctly')
})
test('CRLF text reads the same as LF', () => {
  assert.deepEqual(
    C.extractNaturalAC(v, `## Acceptance criteria\r\n- ${L}\r\n`),
    C.extractNaturalAC(v, `## Acceptance criteria\n- ${L}\n`))
})
test('gherkin needs a Then and two steps', () => {
  assert.equal(C.hasGherkin(v, 'Given a\nWhen b\nThen c'), true)
  assert.equal(C.hasGherkin(v, 'Scenario: x'), false)
})
test('derivable from text counts a Then under the heading once', () => {
  assert.equal(C.countDerivableFromText(v, '## Acceptance criteria\nGiven a product\nWhen I save cost 0\nThen the last cost is 0'), 1)
})
test('derivable from scenarios ignores vague and stub Thens', () => {
  assert.equal(C.countDerivable(v, [{ then: 'shows exactly 5 rows' }, { then: 'as expected' }, { then: 'ok' }]), 1)
})
```

- [ ] **Step 2: Run to verify failure** → missing module.
- [ ] **Step 3: Port the functions** as listed above (copy the bodies; replace `AC_HEADING`→`v.acHeading`, `LIST_ITEM`→`v.listItem`, `THEN_STEP`→`v.thenStep`, `SETUP_STEP`→`v.setupStep`, `CONTINUATION`→`v.continuation`, `SECTION_END`→`v.sectionEnd`, `VAGUE`→`v.vague`, the step regex in `hasGherkin`→`v.gherkinStepAll`/`v.thenLine`, the Then capture in `hasConcreteThen`→`v.thenLineCapture`; in `extractExpectedChunks` (BE `expected-check.mjs:28-54`) replace the inline `then|allora` with a global Then-capture built from `v`, and move its three other word lists into the packs as new keys, added in this same commit to `en.mjs`/`it.mjs`, to `buildVocabulary` and to the Task 2 test: `expectedQuestion` (en `what is the expected behavio(?:u)?r\\??`, it `qual è il comportamento atteso\\??`) → `v.expectedQuestion` with flags `gim`; `expectedSection` (en `expected`, it `risultato atteso`) → `v.expectedSection` heading regex `^(?:#{1,6}\\s*|\\*\\*\\s*)(?:<words>)\\b[^\\n]*$` flags `gim`; `insteadOf` (en `instead of`, it `invece di`) → `v.insteadOf` = `(?:<words>)\\s+([+\\u2212-]?\\d+(?:[.,]\\d+)?)` flags `gi`).
- [ ] **Step 4: Run** → pass. Also `grep -n "allora\|dato\|quando" core/criteria.mjs` must print nothing (all words come from packs).
- [ ] **Step 5: Commit** — `git commit -m "feat(core): one criteria reader for both stacks"`

---

### Task 4: Rubrics and `score.mjs`

**Files:**
- Create: `core/rubrics/playwright.mjs`, `core/rubrics/vitest.mjs`, `core/score.mjs`
- Test: `test/score.test.mjs`

**Interfaces:**
- Consumes: `Vocab`, criteria functions, validated `config`
- Produces:
  - each rubric: `{ id, weights: Record<key, [points, label]>, deriveSignals(v, config, ticket) → signals, derivable(v, ticket) → number, briefExtras(config, ticket, signals) → object }`
  - `THRESHOLD = 70` (constant, not exported to config)
  - `rubricFor(config) → rubric`
  - `scoreTicket(rubric, signals) → { score, missing: [{key, weight, label}] }` (port FE `:380-394`)
  - `decideGate(score) → 'pass' | 'refuse'`
  - `buildBrief(config, ticket) → brief` (merge of FE `:474-516` and BE `:399-430`, fields: `key, browse, issuetype, status, score, threshold, gate, legacy, feature, scenarios, derivable, missing, flags, signals` plus `briefExtras`)
  - `formatReport(brief) → string` (port BE `:380-397`, threshold text from `brief.threshold`)

Signal keys (the same names in both rubrics where the concept is the same):
- playwright: `ac_present, ac_testable, feature_label, qa_plan_found, steps, expected_defined, environment` with weights 30, 15, 15, 15, 10, 10, 5
- vitest: `ac_present, ac_testable, steps, expected_defined, context, title_prefix, feature_label, environment` with weights 30, 15, 15, 15, 10, 5, 5, 5

Detectors: port FE `deriveSignals :314-353` into `playwright.deriveSignals` and BE `:260-302` into `vitest.deriveSignals`, replacing every inline regex with the vocabulary (`v.expectedHeading`, `v.actualHeading`, `v.expectedPhrase`, `v.actualPhrase`, `v.contextHeadingFE/BE`, `v.userStoryLine`, …). Feature label: `labels.some(l => config.features.some(f => f.label === l))` (no bare-`warehouse` exception — spec §10 #2). Title prefix: `new RegExp('^\\s*\\[(?:' + config.titlePrefixes.join('|') + ')\\]', 'i')`. QA plan: `!!ticket.qaPlan?.url`. Derivable: playwright `countDerivable(v, [...ticket.scenarios, ...(ticket.qaPlan?.scenarios ?? [])])`; vitest `countDerivableFromText(v, [summary, description, acField].join('\n'))`. `briefExtras` (playwright only): `{ route: ticket.route ?? features.find(label).route ?? null, qaPlan, figma, mr }`.

- [ ] **Step 1: Write the failing tests**

```js
// test/score.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../core/config.mjs'
import { buildBrief, decideGate, THRESHOLD } from '../core/score.mjs'

const cfg = adapter => validateConfig({
  version: 1, adapter,
  jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null },
  languages: ['en', 'it'],
  features: [{ label: 'Orders', route: '/orders' }],
}).config

test('the bar is 70 and fixed', () => {
  assert.equal(THRESHOLD, 70)
  assert.equal(decideGate(69), 'refuse')
  assert.equal(decideGate(70), 'pass')
})
test('playwright rubric weights', () => {
  const b = buildBrief(cfg('playwright'), { key: 'DEMO-1', issuetype: 'Bug', labels: [], text: { description: 'x' } })
  assert.deepEqual(b.missing.map(m => [m.key, m.weight]),
    [['ac_present', 30], ['ac_testable', 15], ['feature_label', 15], ['qa_plan_found', 15], ['steps', 10], ['expected_defined', 10], ['environment', 5]])
})
test('vitest rubric weights', () => {
  const b = buildBrief(cfg('vitest'), { key: 'DEMO-1', issuetype: 'Bug', labels: [], summary: 's', text: { description: 'x' } })
  assert.deepEqual(b.missing.map(m => m.weight), [30, 15, 15, 15, 10, 5, 5, 5])
})
test('feature label comes from config; a bare domain word does not count', () => {
  const c = cfg('vitest')
  assert.equal(buildBrief(c, { key: 'DEMO-1', labels: ['Orders'], text: {} }).signals.feature_label, true)
  assert.equal(buildBrief(c, { key: 'DEMO-1', labels: ['orders-team'], text: {} }).signals.feature_label, false)
})
test('vitest accepts question forms for expected/actual, playwright does not', () => {
  const d = '**What happens?** it shows 150. **What is the expected behavior?** it should show 80.'
  assert.equal(buildBrief(cfg('vitest'), { key: 'DEMO-1', text: { description: d } }).signals.expected_defined, true)
  assert.equal(buildBrief(cfg('playwright'), { key: 'DEMO-1', text: { description: d } }).signals.expected_defined, false)
})
test('route comes from the feature in config', () => {
  assert.equal(buildBrief(cfg('playwright'), { key: 'DEMO-1', labels: ['Orders'], text: {} }).route, '/orders')
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the two rubric modules and `score.mjs` as described (port the bodies; no word lists inline).
- [ ] **Step 4: Run** → pass; `grep -n -i "warehouse\|FIC\|giacenza" core/rubrics core/score.mjs` prints nothing.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): per-stack rubrics and the fixed 70 gate"`

---

### Task 5: `messages.mjs` and `jira.mjs`

**Files:**
- Create: `core/messages.mjs`, `core/jira.mjs`
- Test: `test/jira.test.mjs`

**Interfaces:**
- Consumes: `brief`, `config`
- Produces:
  - `messagesFor(config, kind: 'bug'|'story') → Record<key, {title, missing, add, question, example}>` — built-in neutral defaults, overridden per key by `config.messages[key]`, then for stories by `config.messages.story?.[key]`
  - `templateLine(config, issuetype) → string` — `config.messages.templateLine?.[kind]` if set; else `The full ${Name} template is at ${path}.` when `config.ticketTemplates[kind]` is set; else `''`
  - `templateFor(issuetype) → 'bug'|'story'` (port FE `:85-88`)
  - `browseUrl(config, key) → string` (`${config.jira.site}/browse/${key}`)
  - `formatRefuseComment(config, brief) → string` (port FE `:418-450`, keeping `qa_plan_found` excluded, `NOT_ON_STORY = environment, expected_defined`, the footer `REFUSE_COMMENT_FOOTER` FE `:73`)
  - `isRefuseComment(text)`, `REFUSE_COMMENT_MARK`, `REFUSE_COMMENT_FOOTER`, `OLD_FOOTER` (FE `:70-108`)
  - `JIRA_FILL_MARK`, `jiraUpdate(ticket) → {append, labelsAdd, titlePrefix, replacedVague}`, `formatJiraUpdate(update) → string` (port BE `:606-639`; `titlePrefix` stays in the payload for both stacks, it is simply never set on playwright because the playwright rubric has no title signal)

Built-in neutral defaults (no product words) — one entry per rubric key, for example:

```js
ac_present: {
  title: 'Acceptance criteria',
  missing: 'We could not find acceptance criteria.',
  add: [
    'You can copy this and adjust it to your case. Either format works. A short list under an "Acceptance criteria" heading, one result per line:',
    '',
    '## Acceptance criteria',
    '- After saving, the list shows the new item with its name and today\'s date, and the counter above the list goes up by one.',
    '',
    'Or Given / When / Then, each at the start of its line:',
    '',
    'Given an empty list',
    'When I save a new item',
    'Then the list shows one row with that item',
  ].join('\n'),
  question: 'What should be true when this is done? Plain sentences (at least 150 characters), or Given / When / Then.',
  example: 'After saving, the list shows the new item with its name and today\'s date, and the counter above the list goes up by one. Nothing else in the list changes.',
},
```

(the remaining keys `ac_testable, feature_label, qa_plan_found, steps, expected_defined, context, title_prefix, environment` follow the same shape; `feature_label.add` lists `config.features` labels at runtime; story overrides for `steps` → "User story" and `context` → "Context" as in BE `:179-201`).

- [ ] **Step 1: Write the failing tests**

```js
// test/jira.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../core/config.mjs'
import { buildBrief } from '../core/score.mjs'
import { formatRefuseComment, templateLine, browseUrl, jiraUpdate, formatJiraUpdate } from '../core/jira.mjs'

const base = { version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [{ label: 'Orders' }] }
const cfg = (patch = {}) => validateConfig({ ...base, ...patch }).config
const bare = { key: 'DEMO-1', issuetype: 'Bug', labels: [], summary: 's', text: { description: 'Broken.' } }

test('neutral defaults: no product words, labels from config', () => {
  const c = formatRefuseComment(cfg(), buildBrief(cfg(), bare))
  assert.match(c, /We could not find acceptance criteria\./)
  assert.match(c, /Orders/)
  assert.doesNotMatch(c, /warehouse|magazzino|Giacenza/i)
})
test('a story is not asked for steps to reproduce or environment', () => {
  const c = formatRefuseComment(cfg(), buildBrief(cfg(), { ...bare, issuetype: 'Story' }))
  assert.doesNotMatch(c, /Steps to reproduce|## Environment/)
})
test('config messages override per key and per story', () => {
  const c = cfg({ messages: { ac_present: { missing: 'Custom missing.' }, story: { steps: { title: 'Story line' } } } })
  assert.match(formatRefuseComment(c, buildBrief(c, bare)), /Custom missing\./)
  assert.match(formatRefuseComment(c, buildBrief(c, { ...bare, issuetype: 'Story' })), /Story line/)
})
test('template line: override, path, or nothing', () => {
  assert.equal(templateLine(cfg(), 'Bug'), '')
  assert.equal(templateLine(cfg({ ticketTemplates: { bug: '.github/ISSUE_TEMPLATE/bug.md' } }), 'Bug'), 'The full Bug template is at .github/ISSUE_TEMPLATE/bug.md.')
  assert.equal(templateLine(cfg({ messages: { templateLine: { bug: 'X' } } }), 'Bug'), 'X')
})
test('browse URL from config', () => {
  assert.equal(browseUrl(cfg(), 'DEMO-1'), 'https://example.atlassian.net/browse/DEMO-1')
})
test('jira update sends only filled sections', () => {
  const t = { ...bare, filled: [{ key: 'ac_present', section: '## Acceptance criteria\n- x' }, { key: 'feature_label', label: 'Orders' }] }
  const u = jiraUpdate(t)
  assert.equal(u.append, '_Added during the /spec readiness check._\n\n## Acceptance criteria\n- x')
  assert.deepEqual(u.labelsAdd, ['Orders'])
  assert.match(formatJiraUpdate(u), /Nothing already on the ticket is changed\./)
})
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `messages.mjs` (defaults + merge) and `jira.mjs` (ports listed above, reading texts from `messagesFor`).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(core): configurable refuse comment, template line and Jira push"`

---

### Task 6: `sanitize.mjs`

**Files:** Create `core/sanitize.mjs`; Test `test/sanitize.test.mjs`

**Interfaces:**
- Produces: `adfToText(node)` (port BE `sanitize-ticket.mjs:15-30`), `redact(config, text) → string`, `sanitizeTicket(config, raw) → ticket` (port BE `:57-68`; redacts `summary`, `text.description`, `text.acField`; keeps `findGitlabMr` BE `:48-55` as `findMergeRequest`, host-agnostic)

`redact`: e-mails → `user@example.test` (BE `:37`), UUIDs → `00000000-0000-4000-8000-000000000001` (BE `:41`), then each `config.redact` pattern (global) → `<name>-redacted`. For warehouse parity the backend config sets `"redact": {"customerId": "U\\d{5,}"}` and the parity test expects today's replacement text `U######`; so the replacement is: for a pattern named `customerId`, `U######`; for any other name `[redacted:<name>]`.

- [ ] **Step 1: Failing tests**

```js
// test/sanitize.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig } from '../core/config.mjs'
import { redact, sanitizeTicket } from '../core/sanitize.mjs'

const cfg = r => validateConfig({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [], ...(r ? { redact: r } : {}) }).config

test('default patterns', () => {
  assert.equal(redact(cfg(), 'mail a.b@company.com id U123456 ws 3f2c1e4a-1b2c-4d3e-8f9a-0b1c2d3e4f5a'),
    'mail user@example.test id U###### ws 00000000-0000-4000-8000-000000000001')
})
test('a team pattern', () => {
  assert.equal(redact(cfg({ vat: 'IT\\d{11}' }), 'IT12345678901'), '[redacted:vat]')
})
test('only summary, description and criteria field are touched', () => {
  const t = sanitizeTicket(cfg(), { key: 'DEMO-1', summary: 'U123456', text: { description: 'U123456', acField: 'U123456' }, labels: ['U123456'] })
  assert.deepEqual([t.summary, t.text.description, t.text.acField, t.labels[0]], ['U######', 'U######', 'U######', 'U123456'])
})
```

- [ ] **Step 2:** run → fail. **Step 3:** implement. **Step 4:** run → pass. **Step 5:** commit `feat(core): configurable redaction`.

---

### Task 7: `fill.mjs`

**Files:** Create `core/fill.mjs`; Test `test/fill.test.mjs`

**Interfaces:**
- Consumes: `buildBrief`, `messagesFor`, criteria functions, `rubricFor`
- Produces: `fillMenu(config, brief)`, `projectPick(menu, nums)`, `formatFillMenu(menu)`, `formatPick(pick)`, `applyAnswer(config, ticket, key, answer) → {ok, reason?, input, brief?}` — ports of FE `:518-681` (and BE `:432-604` for the vitest-only keys `context` and `title_prefix`), with:
  - questions and examples from `messagesFor(config, kind)[key].question/example`
  - feature labels from `config.features`
  - the 150 rule and Gherkin exemption measured with `naturalLength(extractNaturalAC(v, text, {headingless:true}))`
  - the `filled` record (`{key, section?, label?, prefix?, replacedVague?}`) appended on acceptance only
  - `qa_plan_found` never offered; `NOT_ON_STORY` excluded for stories

- [ ] **Step 1: Failing tests** — port the fill-in assertions from the FE self-test (`score-ticket.mjs:714-1028`, the block starting `// --- guided fill-in`) and the BE self-test (`:641-928`, same block), converting each `console.assert(x, msg)` to `assert.ok(x, msg)`, replacing `bare` with a `DEMO` ticket and every warehouse label with `Orders`. Keep every case: menu order and gains, story exclusions, pick enough/short/unknown number, every accepted and rejected answer type, `filled` record, vague replacement, 150/149, Gherkin exemption.
- [ ] **Step 2:** run → fail. **Step 3:** port. **Step 4:** run → pass. **Step 5:** commit `feat(core): guided fill-in from config`.

---

### Task 8: `cli.mjs`

**Files:** Create `core/cli.mjs`; Test `test/cli.test.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: the commands of spec §6. Implementation outline (complete code):

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig, projectRoot } from './config.mjs'
import { buildBrief, formatReport } from './score.mjs'
import { formatRefuseComment, jiraUpdate, formatJiraUpdate } from './jira.mjs'
import { sanitizeTicket } from './sanitize.mjs'
import { fillMenu, projectPick, formatFillMenu, formatPick, applyAnswer } from './fill.mjs'

const out = s => process.stdout.write(`${s}\n`)
const fail = (msg, code = 2) => { process.stderr.write(`${msg}\n`); process.exit(code) }

function args(argv) {
  const a = { _: [], flags: new Set() }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in' || argv[i] === '--out') a[argv[i].slice(2)] = argv[++i]
    else if (argv[i].startsWith('--')) a.flags.add(argv[i])
    else a._.push(argv[i])
  }
  return a
}

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const [cmd, ...rest] = argv
  const a = args(rest)
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root)
  if (cmd === 'config' && a._[0] === 'check') {
    if (cfg.ok) return out('ok'), 0
    cfg.errors.forEach(e => out(e)); return 2
  }
  if (!cfg.ok) { cfg.errors.forEach(e => process.stderr.write(`${e}\n`)); return 2 }
  const config = cfg.config
  const inPath = a.in?.startsWith('@') ? resolve(root, a.in.slice(1)) : null
  const ticket = inPath ? JSON.parse(readFileSync(inPath, 'utf8')) : a.in ? JSON.parse(a.in) : null
  if (!ticket) { process.stderr.write('--in @<ticket.json> is required\n'); return 2 }
  const project = String(ticket.key ?? '').split('-')[0]
  const mismatch = ticket.key && !config.jira.projects.includes(project)
  if (mismatch) out(`PROJECT_MISMATCH:${JSON.stringify({ key: ticket.key, projects: config.jira.projects })}`)
  switch (cmd) {
    case 'sanitize': {
      const t = sanitizeTicket(config, ticket)
      writeFileSync(resolve(root, a.out), JSON.stringify(t))
      if (inPath) unlinkSync(inPath)
      return 0
    }
    case 'score': {
      if (mismatch && a.flags.has('--ci')) return 2
      const b = buildBrief(config, ticket)
      if (a.flags.has('--json')) out(JSON.stringify(b))
      else { out(formatReport(b)); out(`TICKET_EVAL_JSON:${JSON.stringify(b)}`) }
      return b.gate === 'refuse' ? 1 : 0
    }
    case 'refuse-comment': { const b = buildBrief(config, ticket); out(formatRefuseComment(config, b)); return b.gate === 'refuse' ? 1 : 0 }
    case 'fill-menu': { const m = fillMenu(config, buildBrief(config, ticket)); out(formatFillMenu(m)); out(`FILL_JSON:${JSON.stringify({ score: m.score, threshold: m.threshold, items: m.items })}`); return 0 }
    case 'pick': { const p = projectPick(fillMenu(config, buildBrief(config, ticket)), String(a._[0] ?? '').split(/[\s,]+/).filter(Boolean)); out(formatPick(p)); out(`FILL_JSON:${JSON.stringify(p)}`); return p.error ? 2 : p.enough ? 0 : 1 }
    case 'add': {
      if (!inPath) { process.stderr.write('add needs --in @<ticket.json> so the accepted answer can be saved\n'); return 2 }
      const r = applyAnswer(config, ticket, a._[0], a._[1])
      if (r.ok) writeFileSync(inPath, JSON.stringify(r.input))
      out(r.ok ? `Accepted. The ticket now has ${r.brief.score} points (the bar is ${r.brief.threshold})${r.brief.gate === 'pass' ? ': enough to continue.' : `: ${r.brief.threshold - r.brief.score} points short.`}` : `Not accepted: ${r.reason}`)
      const after = r.brief ?? buildBrief(config, ticket)
      out(`FILL_JSON:${JSON.stringify({ ok: r.ok, reason: r.reason ?? null, score: after.score, gate: after.gate })}`)
      return r.ok ? 0 : 1
    }
    case 'jira-update': { const u = jiraUpdate(ticket); out(formatJiraUpdate(u)); out(`JIRA_UPDATE_JSON:${JSON.stringify(u)}`); return 0 }
    default: process.stderr.write(`unknown command: ${cmd}\n`); return 2
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main())
```

The `Not accepted:` line additionally prints `Example: …` from `messagesFor(...)[key].example` exactly as today (FE `:1086-1088`); add it inside the `add` case.

- [ ] **Step 1: Failing tests** (spawn the CLI in a temp project)

```js
// test/cli.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = new URL('../core/cli.mjs', import.meta.url).pathname
const proj = () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/agentic-testing.json'), JSON.stringify({ version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }))
  writeFileSync(join(d, 't.json'), JSON.stringify({ key: 'DEMO-1', issuetype: 'Bug', summary: 's', labels: [], text: { description: 'Broken.' } }))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

test('score: refuse exits 1 and prints the JSON line', () => {
  const r = run(proj(), 'score', '--in', '@t.json')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^TICKET_EVAL_JSON:/m)
})
test('relative @file resolves against the project, not cwd', () => {
  assert.equal(run(proj(), 'score', '--in', '@t.json').status, 1)
})
test('no config: exit 2 with the setup message', () => {
  const d = mkdtempSync(join(tmpdir(), 'at-'))
  const r = run(d, 'score', '--in', '{}')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /Run \/agentic-testing:setup/)
})
test('a key from another project is flagged; --ci stops', () => {
  const d = proj()
  writeFileSync(join(d, 'x.json'), JSON.stringify({ key: 'OTHER-1', text: {} }))
  assert.match(run(d, 'score', '--in', '@x.json').stdout, /^PROJECT_MISMATCH:/m)
  assert.equal(run(d, 'score', '--in', '@x.json', '--ci').status, 2)
})
test('add rewrites the file only when accepted', () => {
  const d = proj()
  const before = readFileSync(join(d, 't.json'), 'utf8')
  assert.equal(run(d, 'add', '--in', '@t.json', 'environment', ' ').status, 1)
  assert.equal(readFileSync(join(d, 't.json'), 'utf8'), before)
  assert.equal(run(d, 'add', '--in', '@t.json', 'environment', 'staging').status, 0)
  assert.match(readFileSync(join(d, 't.json'), 'utf8'), /Env: staging/)
})
test('config check', () => {
  assert.equal(run(proj(), 'config', 'check').stdout.trim(), 'ok')
})
```

- [ ] **Step 2:** run → fail. **Step 3:** implement. **Step 4:** run → pass. **Step 5:** commit `feat(core): one CLI with today's output contract`.

---

### Task 9: Warehouse configs and the parity suite

**Files:**
- Create: `test/parity/configs/warehouse-frontend.json`, `test/parity/configs/warehouse-backend.json`
- Create: `scripts/capture-parity.mjs`, `test/parity/fixtures/*.json`, `test/parity/expected/*.json`
- Test: `test/parity.test.mjs`

**Interfaces:**
- Consumes: today's scripts (refs above), the CLI.
- Produces: the proof of spec §12 scenario 2.

Warehouse configs: `adapter` (`playwright` / `vitest`), `jira.site https://teamsystem.atlassian.net`, `projects ["FIC"]`, `acceptanceCriteriaField "customfield_11707"`, `trackingProjects ["AGT"]`, `languages ["en","it"]`, `features` = the 8 labels with FE routes from FE `score-ticket.mjs:54-63` (backend config: labels only), `ticketTemplates` = `.gitlab/issue_templates/{Bug,Story}.md`, and `messages` = **today's exact texts**: every `REFUSE_MISSING` block (FE `:110-186`, BE `:85-177`), `REFUSE_MISSING_STORY` (FE `:402-414`, BE `:179-201`), `FILL`/`FILL_STORY` question+example (FE `:518-537`, BE `:432-454`), and `templateLine` (FE `:90-98` text "…warehouse-frontend repository…", BE the backend one).

`scripts/capture-parity.mjs`:
1. `git show` the four source files into a temp folder (`expected-check.mjs` next to the BE scorer, since it imports it).
2. Build the input set: every `*.json` under `test/parity/fixtures/` (each `{ "repo": "fe"|"be", "ticket": {…}, "ops": [["score"],["fill-menu"],["pick","1 2"],["add","environment","staging"],["refuse-comment"],["jira-update"]] }`).
3. Run each op through today's script (`node <tmp>/<repo>/score-ticket.mjs --in @… <flag form> --no-audit`) on a copy of the ticket file, and record `{stdout, exit, fileAfter}` to `test/parity/expected/<fixture>.json`.

Fixtures: one per saved backend ticket (`.claude/audit/tickets/*/ticket.json` on the BE ref), plus the self-test inputs of both scorers (`bare`, `at25`, `vagueTicket`, story variants, the 76-case alignment table rebuilt as tickets). **Before writing a fixture, run it through the redaction patterns; if `U\d{5,}` or an e-mail other than `user@example.test` remains, replace it and note it.**

`test/parity.test.mjs`: for each fixture, run the same ops through the new CLI with the matching warehouse config in a temp project, and assert `stdout`, exit code and file-after are **equal** to `expected`, after applying only these documented transforms (spec §10):
- `#2` (`warehouse` label) — no fixture uses it; add one fixture that does and assert the new result explicitly differs.
- `#5` JSON key `warehouse_label` → `feature_label` in the expected backend output.
- `#3` and `#1` do not affect script output.

- [ ] **Step 1:** write the two configs and `capture-parity.mjs`; run it: `node scripts/capture-parity.mjs` → writes `expected/`.
- [ ] **Step 2:** write `test/parity.test.mjs`; run `node --test test/parity.test.mjs` → FAIL until Tasks 1–8 match.
- [ ] **Step 3:** fix every difference **in the core** (never in `expected/`), except the §10 transforms.
- [ ] **Step 4:** add `test/no-ids.test.mjs`: walk `test/` and assert no file matches `U\d{5,}`; run → pass.
- [ ] **Step 5:** run the whole suite `npm test` → all pass. Commit `test: parity with today's warehouse scorers`.

---

### Task 10: `setup.mjs`

**Files:** Create `core/setup.mjs`; Test `test/setup.test.mjs`

**Interfaces:**
- Produces:
  - `detect(root) → { adapter: 'playwright'|'vitest'|'both'|null, templates: {bug, story}, existing: object|null, gitignore: boolean }` — reads `package.json` (deps + devDeps), checks `.gitlab/issue_templates/{Bug,Story}.md` then `.github/ISSUE_TEMPLATE/{bug,story}.md`, reads an existing config
  - `write(root, config, { templates?: {bug: string, story: string}, gitignoreLine: string }) → { ok, errors? }` — validates with `validateConfig`, writes `.claude/agentic-testing.json` (2-space JSON + newline), writes template files only if given and absent, appends `<ticketsDir>/*/raw.json` to `.gitignore` once
  - CLI: `node core/setup.mjs --detect` prints `SETUP_JSON:{…}`; `node core/setup.mjs --write @proposal.json` writes and prints `ok` or the errors (exit 2)

- [ ] **Step 1: Failing tests**

```js
// test/setup.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detect, write } from '../core/setup.mjs'

const repo = pkg => { const d = mkdtempSync(join(tmpdir(), 'at-')); writeFileSync(join(d, 'package.json'), JSON.stringify(pkg)); return d }
const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }

test('detects the stack', () => {
  assert.equal(detect(repo({ devDependencies: { '@playwright/test': '1' } })).adapter, 'playwright')
  assert.equal(detect(repo({ devDependencies: { vitest: '1' } })).adapter, 'vitest')
  assert.equal(detect(repo({ devDependencies: { vitest: '1', '@playwright/test': '1' } })).adapter, 'both')
  assert.equal(detect(repo({})).adapter, null)
})
test('finds GitLab templates', () => {
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  writeFileSync(join(d, '.gitlab/issue_templates/Bug.md'), '#')
  assert.equal(detect(d).templates.bug, '.gitlab/issue_templates/Bug.md')
})
test('write refuses an invalid config and writes nothing', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, languages: [] }, { gitignoreLine: 'x' }).ok, false)
  assert.equal(existsSync(join(d, '.claude/agentic-testing.json')), false)
})
test('write writes the config and one gitignore line, idempotently', () => {
  const d = repo({})
  write(d, cfg, { gitignoreLine: '.claude/agentic-testing/tickets/*/raw.json' })
  write(d, cfg, { gitignoreLine: '.claude/agentic-testing/tickets/*/raw.json' })
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/agentic-testing.json'), 'utf8')), cfg)
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8').match(/raw\.json/g).length, 1)
})
```

- [ ] **Step 2:** run → fail. **Step 3:** implement. **Step 4:** run → pass. **Step 5:** commit `feat(core): setup detect and write`.

---

### Task 11: Plugin wiring — manifest, connectors, commands

**Files:**
- Create: `plugins/agentic-testing/.claude-plugin/plugin.json`, `.mcp.json`, `commands/setup.md`, `commands/ticket-eval.md`
- Modify: `.claude-plugin/marketplace.json` (add the plugin entry; keep the two warehouse entries)

- [ ] **Step 1: Manifest**

```json
{
  "name": "agentic-testing",
  "displayName": "Agentic testing",
  "version": "0.2.0",
  "description": "From a Jira ticket to graded tests, for any project. Part 1: setup and the readiness gate (70 points, Gherkin or 150+ characters of plain criteria), guided fill-in, Jira comment and push.",
  "author": { "name": "Elvis Zefaj" },
  "userConfig": {
    "figma_api_key": { "type": "string", "title": "Figma API key", "description": "Personal Figma token for the design side-by-side. Optional.", "sensitive": true },
    "gitlab_mcp_url": { "type": "string", "title": "GitLab MCP URL", "description": "Your GitLab instance's MCP endpoint.", "default": "https://biosphere.teamsystem.com/api/v4/mcp" }
  }
}
```

- [ ] **Step 2: Connectors** (`.mcp.json`)

```json
{
  "mcpServers": {
    "atlassian-rovo": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp" },
    "figma": { "command": "npx", "args": ["-y", "figma-developer-mcp", "--stdio"], "env": { "FIGMA_API_KEY": "${user_config.figma_api_key}" } },
    "gitlab": { "type": "http", "url": "${user_config.gitlab_mcp_url}" }
  }
}
```

- [ ] **Step 3: `commands/setup.md`** — frontmatter `description`, then the seven steps of spec §7 as instructions to Claude, with the exact calls:
  `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --detect`, the Jira tools (`mcp__atlassian-rovo__getVisibleJiraProjects`, `getJiraProjectIssueTypesMetaWithFields`, `searchJiraIssuesUsingJql` with `project = <KEY> ORDER BY created DESC` limited to 100, fields `labels,description`), the numbered cards, the preview card `1. Write it / 2. Change something / 3. Cancel`, If `--detect` returns `adapter: null`, stop with "This stack is not supported yet (v1: Playwright, Vitest)."; if `both`, ask which one with a numbered card. Then `node "${CLAUDE_PLUGIN_ROOT}/core/setup.mjs" --write @<tmp proposal>` and a final `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" score --in @…` on one recent ticket. State explicitly: "Never write `.claude/agentic-testing.json` yourself; only `setup.mjs --write` does."
- [ ] **Step 4: `commands/ticket-eval.md`** — adapted from FE `.claude/commands/ticket-eval.md`: `config check` first; read the ticket with the fields `summary,issuetype,status,labels,description,<jira.acceptanceCriteriaField>,issuelinks` (read the field id from the config, never hard-code it); write `raw.json` under `<ticketsDir>/<KEY>/`; `cli.mjs sanitize`; `cli.mjs score`; the refuse card and the three options, the guided fill-in and the Jira push exactly as in today's skills, with every command path `node "${CLAUDE_PLUGIN_ROOT}/core/cli.mjs" <command>`. Handle `PROJECT_MISMATCH:` with the card "This ticket is from project X, not one of <projects>. 1. Continue anyway / 2. Stop".
- [ ] **Step 5: Validate**

Run: `claude plugin validate plugins/agentic-testing && claude plugin validate .`
Expected: `✔ Validation passed` twice.

- [ ] **Step 6: Commit** — `git commit -m "feat: agentic-testing plugin manifest, connectors, setup and ticket-eval commands"`

---

### Task 12: CI and the acceptance checks

**Files:** Create `.github/workflows/test.yml`; Test: the acceptance scenarios of spec §12.

- [ ] **Step 1: Workflow**

```yaml
name: test
on: [push, pull_request]
jobs:
  core:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd plugins/agentic-testing && npm test
      - run: for f in $(git ls-files '*.json'); do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || exit 1; done
      - name: no project values in core
        run: "! grep -rn -E 'FIC|teamsystem\\.atlassian|customfield_11707|Giacenza|Magazzino|warehouse' plugins/agentic-testing/core"
```

(The parity suite needs the warehouse repos only to **capture**; the captured `expected/` files are committed, so CI runs without them.)

- [ ] **Step 2: Acceptance scenario 1** — run the grep step locally → exit 0.
- [ ] **Step 3: Acceptance scenario 2** — `npm test` (parity) → pass.
- [ ] **Step 4: Acceptance scenario 3** — in a temp copy of a repo with Vitest and no config, run `/agentic-testing:setup` in Claude Code with the local marketplace (`claude plugin marketplace add <path>`), confirm the preview, then `config check` → `ok`, and one ticket scored. Remove the local marketplace afterwards (`claude plugin marketplace remove agentic-testing`).
- [ ] **Step 5: Acceptance scenario 4** — set `jira.projects` to `["fic"]` in that temp repo, run `/agentic-testing:ticket-eval` → stops before scoring naming `jira.projects[0]`.
- [ ] **Step 6: Commit and tag** — `git commit -m "ci: core tests, JSON check, no project values in core"`; `claude plugin tag plugins/agentic-testing` (creates `agentic-testing--v0.2.0`).
