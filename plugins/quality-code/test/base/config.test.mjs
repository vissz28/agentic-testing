import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig, loadConfig, projectRoot, configPath, layersOf, strykerThreshold, adapterOptions, timeoutSecondsOf, seedOf, redTagsOf, doneStatusesOf } from '../../lib/base/config.mjs'

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
  assert.deepEqual(r.config.titlePrefixes, [])
  assert.equal(r.config.ticketsDir, '.claude/quality-code/tickets')
  assert.deepEqual(r.config.redact, { customerId: '\\bU\\d{5,}\\b' })
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
  assert.match(r.errors.join(' '), /re-run \/quality-code:setup/)
})

test('loadConfig reports a missing file distinctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  assert.deepEqual(loadConfig(dir), { ok: false, missing: true, errors: ['This repo is not set up. Run /quality-code:setup.'] })
})

test('loadConfig reads and validates the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude/quality-code.json'), JSON.stringify(good))
  assert.equal(loadConfig(dir).ok, true)
})

test('loadConfig names a JSON syntax error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'))
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude/quality-code.json'), '{ "version": 1, ')
  const r = loadConfig(dir)
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /not valid JSON/)
})

test('projectRoot: CLAUDE_PROJECT_DIR with the config, else the nearest config up from cwd, else CLAUDE_PROJECT_DIR or cwd', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-root-'))
  mkdirSync(join(d, 'app/.claude'), { recursive: true }); writeFileSync(join(d, 'app/.claude/quality-code.json'), '{}')
  mkdirSync(join(d, 'app/src/deep'), { recursive: true })
  assert.equal(projectRoot({}, join(d, 'app/src/deep')), join(d, 'app'), 'a script run from a subfolder')
  assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: d }, join(d, 'app/src')), join(d, 'app'), 'a monorepo session, a package with its own config')
  assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: join(d, 'app') }, d), join(d, 'app'))
  assert.equal(projectRoot({ CLAUDE_PROJECT_DIR: '/p' }, '/c'), '/p')
  assert.equal(projectRoot({}, '/c'), '/c')
  assert.equal(configPath('/p'), '/p/.claude/quality-code.json')
})

bad({ jira: 'x' }, 'jira')
bad({ jira: 5 }, 'jira')
bad({ jira: { ...good.jira, trackingProjects: 'ABC' } }, 'jira.trackingProjects')
bad({ jira: { ...good.jira, trackingProjects: { a: 1 } } }, 'jira.trackingProjects')
bad({ titlePrefixes: 'FE' }, 'titlePrefixes')
bad({ titlePrefixes: ['FE', ''] }, 'titlePrefixes[1]')
bad({ ticketsDir: '' }, 'ticketsDir')
bad({ ticketsDir: 5 }, 'ticketsDir')
bad({ ticketsDir: 'tix\n*.env' }, 'ticketsDir')
bad({ ticketsDir: 'tix\r' }, 'ticketsDir')
bad({ ticketsDir: '///' }, 'ticketsDir')
bad({ redact: { blank: 'x*' } }, 'redact.blank')
bad({ redact: { blank: '^' } }, 'redact.blank')
bad({ ticketTemplates: 'x' }, 'ticketTemplates')
bad({ ticketTemplates: { bug: 5 } }, 'ticketTemplates.bug')
bad({ ticketTemplates: { story: {} } }, 'ticketTemplates.story')
bad({ ticketTemplates: { epic: 'x' } }, 'ticketTemplates.epic')
bad({ redact: 'x' }, 'redact')
bad({ redact: { x: 5 } }, 'redact.x')
bad({ messages: 'x' }, 'messages')
bad({ messages: [] }, 'messages')
bad({ messages: { jiraFillMark: 5 } }, 'messages.jiraFillMark')
bad({ messages: { jiraFillMark: ' ' } }, 'messages.jiraFillMark')
bad({ features: [{ label: 'A', route: 5 }] }, 'features[0].route')
bad({ features: [{ label: 'A', qaPlanSearch: 5 }] }, 'features[0].qaPlanSearch')
bad({ features: [{ label: 'A', qaPlanSearch: '  ' }] }, 'features[0].qaPlanSearch')

test('a non-string route is not reported as missing a slash', () => {
  const r = validateConfig({ ...good, features: [{ label: 'A', route: 5 }] })
  assert.doesNotMatch(r.errors.join(' '), /start with/)
})

test('validateConfig never throws on non-object input', () => {
  for (const v of ['x', null, undefined, 5, []]) assert.equal(validateConfig(v).ok, false)
})

test('a redact pattern that matches empty text gets one clear error', () => {
  const r = validateConfig({ ...good, redact: { customerId: '\\bU\\d{5,}\\b', blank: 'a?' } })
  assert.deepEqual(r.errors, ['redact.blank: must not match empty text (it would insert the mask between every character)'])
})
test('ticketsDir: backslashes become "/" and trailing slashes go', () => {
  assert.equal(validateConfig({ ...good, ticketsDir: 'tix\\sub\\' }).config.ticketsDir, 'tix/sub')
  assert.equal(validateConfig({ ...good, ticketsDir: 'tix//' }).config.ticketsDir, 'tix')
})

// confluenceSpaces: optional list of Confluence space keys the QA-plan search is limited to.
bad({ confluenceSpaces: 'ABC' }, 'confluenceSpaces')
bad({ confluenceSpaces: ['ABC', ''] }, 'confluenceSpaces[1]')
bad({ confluenceSpaces: ['ABC', 'A B'] }, 'confluenceSpaces[1]')
bad({ confluenceSpaces: ['A"B'] }, 'confluenceSpaces[0]')
bad({ confluenceSpaces: [5] }, 'confluenceSpaces[0]')

test('confluenceSpaces: absent by default (search all spaces); valid keys pass as written', () => {
  const none = validateConfig(good)
  assert.equal(none.ok, true)
  assert.equal('confluenceSpaces' in none.config, false)
  const some = validateConfig({ ...good, confluenceSpaces: ['ABC', 'team_2', '~user-1'] })
  assert.equal(some.ok, true)
  assert.deepEqual(some.config.confluenceSpaces, ['ABC', 'team_2', '~user-1'])
})
test('confluenceSpaces: one clear error naming the index', () => {
  const r = validateConfig({ ...good, confluenceSpaces: ['ABC', 'A B'] })
  assert.deepEqual(r.errors, ['confluenceSpaces[1] "A B" must be a Confluence space key: letters, digits, "_", "~" or "-", like "ABC"'])
})
test('the schema documents confluenceSpaces with the validator\'s pattern', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const p = schema.properties.confluenceSpaces
  assert.equal(p.type, 'array')
  assert.equal(p.items.pattern, '^[A-Za-z0-9_~-]+$')
  assert.match(p.description, /all spaces/)
  assert.ok(!schema.required.includes('confluenceSpaces'))
})
// An empty list would build "space in ()", which Confluence rejects; leave the field out for all spaces.
bad({ confluenceSpaces: [] }, 'confluenceSpaces')

test('the short setup config: only version, adapter and Jira site and projects', () => {
  const r = validateConfig({ version: 1, adapter: 'vitest', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'] } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.deepEqual(r.config.languages, ['en'], 'Italian is opt-in: its "e" step word read English text')
  assert.deepEqual(r.config.features, [])
  assert.equal('acceptanceCriteriaField' in r.config.jira, false)
})
test('jira.bugTypes is a non-empty list of names; confluence is a boolean', () => {
  const ok = validateConfig({ ...good, jira: { ...good.jira, bugTypes: ['Defect'] }, confluence: false })
  assert.equal(ok.ok, true, ok.errors?.join(' | '))
  for (const bugTypes of [[], 'Bug', [''], [3]]) assert.match(validateConfig({ ...good, jira: { ...good.jira, bugTypes } }).errors.join(' '), /jira.bugTypes/)
  assert.match(validateConfig({ ...good, confluence: 'no' }).errors.join(' '), /confluence: must be true or false/)
})
test('given languages and features still win over the defaults', () => {
  const r = validateConfig(good)
  assert.deepEqual(r.config.languages, ['en'])
  assert.deepEqual(r.config.features, [{ label: 'Orders', route: '/orders' }])
  assert.equal(r.config.jira.acceptanceCriteriaField, null)
})
test('the schema requires only version, adapter and jira site and projects', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  assert.deepEqual(schema.required, ['version', 'adapter', 'jira'])
  assert.deepEqual(schema.properties.jira.required, ['site', 'projects'])
})

test('boundaries: forbidden rules with optional why, and allow patterns', () => {
  const r = validateConfig({ ...good, boundaries: { forbidden: [{ path: 'src/' }, { path: '.env', why: 'shared systems' }], allow: ['src/**/*.spec.ts'] } })
  assert.equal(r.ok, true)
  assert.deepEqual(r.config.boundaries.allow, ['src/**/*.spec.ts'])
})
test('boundaries: absent stays absent', () => {
  assert.equal(validateConfig(good).config.boundaries, undefined)
})
test('boundaries: each wrong part is named', () => {
  const r = validateConfig({ ...good, boundaries: { forbidden: [{ path: '../x' }, { path: '/abs' }, { path: 'ok/', why: '' }, { path: 'a', extra: 1 }], allow: ['a\nb'], other: [] } })
  assert.deepEqual(r.errors, [
    'boundaries.other: unknown field (only "forbidden" and "allow")',
    'boundaries.forbidden[0].path "../x" must be a relative path inside the project (no "..", not absolute, one line)',
    'boundaries.forbidden[1].path "/abs" must be a relative path inside the project (no "..", not absolute, one line)',
    'boundaries.forbidden[2].why: must be one non-empty line',
    'boundaries.forbidden[3].extra: unknown field (only "path" and "why")',
    'boundaries.allow[0] "a\\nb" must be a relative path inside the project (no "..", not absolute, one line)',
  ])
})
bad({ boundaries: [] }, 'boundaries')
bad({ boundaries: { forbidden: [] } }, 'boundaries.forbidden')
bad({ boundaries: { allow: 'src/' } }, 'boundaries.allow')
test('the schema documents boundaries', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const b = schema.properties.boundaries
  assert.equal(b.type, 'object')
  assert.equal(b.additionalProperties, false)
  assert.equal(b.properties.forbidden.minItems, 1)
  assert.ok(!schema.required.includes('boundaries'))
})

const vgood = { ...good, adapter: 'vitest' }
test('vitest block: configs, tsconfig, timeout', () => {
  const r = validateConfig({ ...vgood, vitest: { configs: [{ match: 'test/integration/**', config: 'vitest.config.db.ts' }], tsconfig: 'tsconfig.test.json', timeoutSeconds: 120 } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.equal(r.config.vitest.timeoutSeconds, 120)
})
test('vitest block: absent stays absent; only with adapter vitest', () => {
  assert.equal(validateConfig(vgood).config.vitest, undefined)
  const r = validateConfig({ ...good, vitest: {} })
  assert.ok(r.errors.includes('vitest: only allowed with "adapter": "vitest" or "fullstack"'))
})
test('vitest block: each wrong part is named', () => {
  const r = validateConfig({ ...vgood, vitest: { configs: [{ match: '../x', config: 'a.ts' }, { match: 'test/', config: '/abs.ts' }, { match: 'x' }, 'no'], tsconfig: '', timeoutSeconds: 5, extra: 1 } })
  assert.deepEqual(r.errors, [
    'vitest.extra: unknown field (only "configs", "tsconfig", "timeoutSeconds", "layers" and "stryker")',
    'vitest.configs[0].match "../x" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[1].config "/abs.ts" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[2].config undefined must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.configs[3]: must be an object with "match" and "config"',
    'vitest.tsconfig "" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.timeoutSeconds: must be a whole number from 10 to 3600',
  ])
})
test('vitest block: not an object', () => {
  for (const v of ['x', 5, null, ['a']]) assert.ok(validateConfig({ ...vgood, vitest: v }).errors.includes('vitest: must be an object'), JSON.stringify(v))
})
test('vitest.configs: not a list; an empty list is fine', () => {
  assert.ok(validateConfig({ ...vgood, vitest: { configs: {} } }).errors.includes('vitest.configs: must be a list of { "match", "config" }'))
  assert.equal(validateConfig({ ...vgood, vitest: { configs: [] } }).ok, true)
})
test('vitest.timeoutSeconds: whole numbers from 10 to 3600', () => {
  const msg = 'vitest.timeoutSeconds: must be a whole number from 10 to 3600'
  for (const t of [1.5, 3601, 9, '60', null]) assert.ok(validateConfig({ ...vgood, vitest: { timeoutSeconds: t } }).errors.includes(msg), String(t))
  for (const t of [10, 3600]) assert.equal(validateConfig({ ...vgood, vitest: { timeoutSeconds: t } }).ok, true, String(t))
})
test('the schema documents the vitest block', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const v = schema.properties.vitest
  assert.equal(v.type, 'object')
  assert.equal(v.additionalProperties, false)
  assert.deepEqual(Object.keys(v.properties).sort(), ['configs', 'layers', 'stryker', 'timeoutSeconds', 'tsconfig'])
  assert.equal(v.properties.layers.minItems, 1)
  assert.equal(v.properties.layers.maxItems, 5)
  assert.equal(v.properties.layers.items.properties.name.pattern, '^[a-z][a-z0-9-]{0,30}$')
  assert.deepEqual(v.properties.layers.items.required, ['name', 'folder'])
  assert.deepEqual(v.properties.stryker.properties.threshold, { type: 'integer', minimum: 0, maximum: 100, default: 60, description: v.properties.stryker.properties.threshold.description })
})
test('the schema gives the vitest paths the validator\'s pattern', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const v = schema.properties.vitest.properties
  const re = new RegExp(v.tsconfig.pattern)
  assert.equal(v.configs.items.properties.match.pattern, v.tsconfig.pattern)
  assert.equal(v.configs.items.properties.config.pattern, v.tsconfig.pattern)
  for (const ok of ['tsconfig.test.json', 'test/integration/**', 'a/b/']) assert.ok(re.test(ok), ok)
  for (const bad of ['/abs', '../x', 'a/../b', 'C:\\x', 'a\nb', '']) assert.ok(!re.test(bad), JSON.stringify(bad))
})

test('vitest.layers and vitest.stryker: a valid block, and the defaults', () => {
  const layers = [{ name: 'unit', folder: 'test/unit/', guide: 'docs/testing/unit.md' }, { name: 'integration-db', folder: 'test/integration/' }]
  const r = validateConfig({ ...vgood, vitest: { layers, stryker: { threshold: 75 } } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.deepEqual(layersOf(r.config), layers)
  assert.equal(strykerThreshold(r.config), 75)
  const d = validateConfig(vgood).config
  assert.deepEqual(layersOf(d), [{ name: 'unit', folder: 'test/' }])
  assert.equal(strykerThreshold(d), 60)
  assert.equal(strykerThreshold(validateConfig({ ...vgood, vitest: { stryker: {} } }).config), 60)
  for (const t of [0, 100]) assert.equal(validateConfig({ ...vgood, vitest: { stryker: { threshold: t } } }).ok, true, String(t))
})
test('vitest.layers: not a list, empty, or more than 5', () => {
  const msg = 'vitest.layers: must be a list of 1 to 5 { "name", "folder", "guide" }'
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `l${i}`, folder: `test/l${i}/` }))
  for (const ls of [{}, 'test/', [], six]) assert.deepEqual(validateConfig({ ...vgood, vitest: { layers: ls } }).errors, [msg], JSON.stringify(ls))
  const five = six.slice(0, 5)
  assert.equal(validateConfig({ ...vgood, vitest: { layers: five } }).ok, true)
})
test('vitest.layers: each wrong part is named', () => {
  assert.deepEqual(validateConfig({ ...vgood, vitest: { layers: ['x'] } }).errors, ['vitest.layers[0]: must be an object with "name", "folder" and an optional "guide"'])
  const r = validateConfig({ ...vgood, vitest: { layers: [
    { name: 'Unit', folder: 'test/a/' },
    { name: 'unit', folder: 'test/b' },
    { name: 'unit', folder: '../x/' },
    { name: 'e2e', folder: 'test/e2e/', guide: 'docs/e2e.txt', extra: 1 },
    { name: '1st', folder: '/abs/', guide: '../g.md' },
  ] } })
  assert.deepEqual(r.errors, [
    'vitest.layers[0].name "Unit" must be lower-case letters, digits and "-", starting with a letter, like "unit"',
    'vitest.layers[1].folder "test/b" must end with "/"',
    'vitest.layers[2].name "unit" appears twice',
    'vitest.layers[2].folder "../x/" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.layers[3].extra: unknown field (only "name", "folder" and "guide")',
    'vitest.layers[3].guide "docs/e2e.txt" must be a relative path to a .md file inside the project',
    'vitest.layers[4].name "1st" must be lower-case letters, digits and "-", starting with a letter, like "unit"',
    'vitest.layers[4].folder "/abs/" must be a relative path inside the project (no "..", not absolute, one line)',
    'vitest.layers[4].guide "../g.md" must be a relative path to a .md file inside the project',
  ])
  const long = 'a'.repeat(32)
  assert.ok(validateConfig({ ...vgood, vitest: { layers: [{ name: long, folder: 't/' }] } }).errors[0].startsWith(`vitest.layers[0].name "${long}"`))
  assert.equal(validateConfig({ ...vgood, vitest: { layers: [{ name: 'a'.repeat(31), folder: 't/' }] } }).ok, true)
})
test('vitest.layers: a folder inside a forbidden boundary is refused, naming the rule', () => {
  const r = validateConfig({ ...vgood, vitest: { layers: [{ name: 'unit', folder: 'src/__tests__/' }, { name: 'all', folder: 'src/' }] } })
  assert.deepEqual(r.errors, [
    'vitest.layers[0].folder "src/__tests__/" is inside the forbidden "src/"',
    'vitest.layers[1].folder "src/" is inside the forbidden "src/"',
  ])
  const own = { forbidden: [{ path: 'lib/**' }] }
  assert.deepEqual(validateConfig({ ...vgood, boundaries: own, vitest: { layers: [{ name: 'unit', folder: 'lib/tests/' }] } }).errors,
    ['vitest.layers[0].folder "lib/tests/" is inside the forbidden "lib/**"'])
  // The configured boundary replaces the default: src/ is then writable.
  assert.equal(validateConfig({ ...vgood, boundaries: own, vitest: { layers: [{ name: 'unit', folder: 'src/__tests__/' }] } }).ok, true)
  // An allow rule opens the folder again.
  assert.equal(validateConfig({ ...vgood, boundaries: { allow: ['src/**/__tests__/**'] }, vitest: { layers: [{ name: 'unit', folder: 'src/a/__tests__/' }] } }).ok, true)
})
test('vitest.stryker: each wrong part is named', () => {
  const msg = 'vitest.stryker.threshold: must be a whole number from 0 to 100'
  for (const t of [-1, 101, 1.5, '60', null]) assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: { threshold: t } } }).errors, [msg], String(t))
  for (const v of ['x', 5, null, []]) assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: v } }).errors, ['vitest.stryker: must be an object with an optional "threshold" and "timeoutSeconds"'], JSON.stringify(v))
  assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: { bar: 1 } } }).errors, ['vitest.stryker.bar: unknown field (only "threshold" and "timeoutSeconds")'])
})

test('playwright block: configs, projects, tsconfig, timeout', () => {
  const r = validateConfig({ ...good, playwright: { configs: [{ match: 'e2e/admin/**', config: 'playwright.admin.config.ts' }], projects: ['chromium', 'Mobile Safari'], tsconfig: 'e2e/tsconfig.json', timeoutSeconds: 900 } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.deepEqual(r.config.playwright.projects, ['chromium', 'Mobile Safari'])
})
test('playwright block: absent stays absent; only with adapter playwright; not an object', () => {
  assert.equal(validateConfig(good).config.playwright, undefined)
  assert.ok(validateConfig({ ...vgood, playwright: {} }).errors.includes('playwright: only allowed with "adapter": "playwright" or "fullstack"'))
  for (const v of ['x', 5, null, ['a']]) assert.ok(validateConfig({ ...good, playwright: v }).errors.includes('playwright: must be an object'), JSON.stringify(v))
  assert.ok(validateConfig({ ...good, vitest: {} }).errors.includes('vitest: only allowed with "adapter": "vitest" or "fullstack"'))
})
test('playwright block: each wrong part is named', () => {
  const r = validateConfig({ ...good, playwright: { configs: [{ match: '../x', config: 'a.ts' }, 'no'], tsconfig: '/abs.json', timeoutSeconds: 9, layers: [] } })
  assert.deepEqual(r.errors, [
    'playwright.layers: unknown field (only "configs", "projects", "tsconfig", "timeoutSeconds", "folder", "guide", "ungradedTitles" and "redTags")',
    'playwright.configs[0].match "../x" must be a relative path inside the project (no "..", not absolute, one line)',
    'playwright.configs[1]: must be an object with "match" and "config"',
    'playwright.tsconfig "/abs.json" must be a relative path inside the project (no "..", not absolute, one line)',
    'playwright.timeoutSeconds: must be a whole number from 10 to 3600',
  ])
  assert.ok(validateConfig({ ...good, playwright: { configs: {} } }).errors.includes('playwright.configs: must be a list of { "match", "config" }'))
  for (const t of [1.5, 3601, '60']) assert.ok(validateConfig({ ...good, playwright: { timeoutSeconds: t } }).errors.includes('playwright.timeoutSeconds: must be a whole number from 10 to 3600'), String(t))
})
test('playwright.projects: 1 to 10 one-line names, not starting with "-", no duplicates', () => {
  const list = 'playwright.projects: must be a list of 1 to 10 project names'
  const eleven = Array.from({ length: 11 }, (_, i) => `p${i}`)
  for (const ps of [[], 'chromium', {}, eleven]) assert.deepEqual(validateConfig({ ...good, playwright: { projects: ps } }).errors, [list], JSON.stringify(ps))
  assert.equal(validateConfig({ ...good, playwright: { projects: eleven.slice(1) } }).ok, true)
  const bad = v => `playwright.projects[${v[0]}] ${JSON.stringify(v[1])} must be a project name of your Playwright config: one line, not empty, not starting with "-"`
  const r = validateConfig({ ...good, playwright: { projects: ['chromium', 'chromium', '-x', 'a\nb', '', 3] } })
  assert.deepEqual(r.errors, ['playwright.projects[1] "chromium" appears twice', ...[[2, '-x'], [3, 'a\nb'], [4, ''], [5, 3]].map(bad)])
})
test('adapterOptions and timeoutSecondsOf: the configured adapter\'s block, 600 s for Playwright, 300 s for Vitest', () => {
  assert.deepEqual(adapterOptions({ adapter: 'playwright', playwright: { projects: ['a'] }, vitest: { tsconfig: 'x' } }), { projects: ['a'] })
  assert.deepEqual(adapterOptions({ adapter: 'vitest', vitest: { tsconfig: 'x' } }), { tsconfig: 'x' })
  assert.deepEqual(adapterOptions({ adapter: 'vitest' }), {})
  assert.deepEqual(adapterOptions(null), {})
  assert.equal(timeoutSecondsOf({ adapter: 'playwright' }), 600)
  assert.equal(timeoutSecondsOf({ adapter: 'vitest' }), 300)
  assert.equal(timeoutSecondsOf({ adapter: 'playwright', playwright: { timeoutSeconds: 42 } }), 42)
  assert.equal(timeoutSecondsOf({ adapter: 'vitest', vitest: { timeoutSeconds: 42 }, playwright: { timeoutSeconds: 7 } }), 42)
})
test('playwright.ungradedTitles, playwright.redTags and jira.doneStatuses: checked, with today\'s defaults', () => {
  const pw = playwright => validateConfig({ ...good, playwright })
  assert.equal(pw({ ungradedTitles: 'conformance|capture' }).ok, true)
  for (const u of ['', '(', 'a|', 5]) assert.ok(pw({ ungradedTitles: u }).errors.some(e => e.startsWith('playwright.ungradedTitles:')), JSON.stringify(u))
  assert.equal(pw({ redTags: null }).ok, true)
  assert.equal(pw({ redTags: { scenario: '@red' } }).ok, true)
  for (const rt of ['@x', { scenario: 'red' }, { other: '@x' }]) assert.equal(pw({ redTags: rt }).ok, false, JSON.stringify(rt))
  assert.deepEqual(redTagsOf({}), ['@anchor', '@finding'])
  assert.deepEqual(redTagsOf({ playwright: { redTags: { scenario: '@red' } } }), ['@red', '@finding'])
  assert.deepEqual(redTagsOf({ playwright: { redTags: null } }), [])
  const jira = doneStatuses => validateConfig({ ...good, jira: { ...good.jira, doneStatuses } })
  assert.equal(jira(['Released']).ok, true)
  for (const d of ['Done', [''], [3]]) assert.ok(jira(d).errors.includes('jira.doneStatuses: must be a list of Jira status names, like ["Done", "Closed"]'), JSON.stringify(d))
  assert.ok(doneStatusesOf({}).includes('Done'))
  assert.deepEqual(doneStatusesOf(jira(['Released']).config), ['Released'])
})
test('the schema documents the playwright block with the validator\'s path pattern', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const p = schema.properties.playwright
  assert.equal(p.type, 'object')
  assert.equal(p.additionalProperties, false)
  assert.deepEqual(Object.keys(p.properties).sort(), ['configs', 'folder', 'guide', 'projects', 'redTags', 'timeoutSeconds', 'tsconfig', 'ungradedTitles'])
  const path = schema.properties.vitest.properties.tsconfig.pattern
  assert.equal(p.properties.folder.pattern, path)
  assert.equal(p.properties.guide.pattern, path)
  assert.equal(p.properties.tsconfig.pattern, path)
  assert.equal(p.properties.configs.items.properties.match.pattern, path)
  assert.equal(p.properties.configs.items.properties.config.pattern, path)
  assert.equal(p.properties.projects.minItems, 1)
  assert.equal(p.properties.projects.maxItems, 10)
  assert.equal(p.properties.timeoutSeconds.default, 600)
  const name = new RegExp(p.properties.projects.items.pattern)
  for (const ok of ['chromium', 'Mobile Safari']) assert.ok(name.test(ok), ok)
  for (const bad of ['-x', 'a\nb', '', '  ']) assert.ok(!name.test(bad), JSON.stringify(bad))
})

test('seed block: absent gives the defaults; a valid block for each adapter', () => {
  assert.deepEqual(seedOf(validateConfig(vgood).config), { builders: [], dataset: null, stubsFrom: null, guide: null })
  assert.deepEqual(seedOf(null), { builders: [], dataset: null, stubsFrom: null, guide: null })
  const v = validateConfig({ ...vgood, seed: { builders: ['test/helpers/seed.ts', 'test/helpers/more.ts'], dataset: 'docs/testing/dataset.md' } })
  assert.equal(v.ok, true, v.errors?.join(' | '))
  assert.deepEqual(seedOf(v.config), { builders: ['test/helpers/seed.ts', 'test/helpers/more.ts'], dataset: 'docs/testing/dataset.md', stubsFrom: null, guide: null })
  const p = validateConfig({ ...good, seed: { stubsFrom: 'e2e/tests/', dataset: 'docs/testing/dataset.md' } })
  assert.equal(p.ok, true, p.errors?.join(' | '))
  assert.equal(seedOf(p.config).stubsFrom, 'e2e/tests/')
  assert.equal(validateConfig({ ...good, seed: {} }).ok, true)
})
test('seed block: builders only with vitest, stubsFrom only with playwright', () => {
  assert.deepEqual(validateConfig({ ...good, seed: { builders: ['test/seed.ts'] } }).errors,
    ['seed.builders: only allowed with "adapter": "vitest" or "fullstack" (Playwright seeds with route stubs, see seed.stubsFrom)'])
  assert.deepEqual(validateConfig({ ...vgood, seed: { stubsFrom: 'e2e/' } }).errors,
    ['seed.stubsFrom: only allowed with "adapter": "playwright" or "fullstack" (Vitest seeds with builder calls, see seed.builders)'])
})
test('fullstack: both blocks, both seed kinds and sides are allowed; sides only on fullstack', () => {
  const fs = { ...good, adapter: 'fullstack' }
  const r = validateConfig({ ...fs, vitest: { tsconfig: 'tsconfig.json' }, playwright: { folder: 'e2e/' }, seed: { builders: ['test/seed.ts'], stubsFrom: 'e2e/mocks/' }, sides: { frontend: ['FE', 'web'], backend: ['BE'] } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.deepEqual(validateConfig({ ...good, sides: { frontend: ['FE'] } }).errors, ['sides: only allowed with "adapter": "fullstack" (it tells frontend, backend and fullstack tickets apart)'])
  assert.deepEqual(validateConfig({ ...fs, sides: { mobile: ['MO'], backend: ['[BE]'], frontend: 'FE' } }).errors, [
    'sides.mobile: unknown field (only "frontend", "backend" and "fullstack")',
    'sides.backend: must be a list of title prefixes or labels, like ["FE"] (no brackets)',
    'sides.frontend: must be a list of title prefixes or labels, like ["FE"] (no brackets)',
  ])
  assert.deepEqual(validateConfig({ ...good, adapter: 'jest' }).errors, ['adapter: must be "playwright" (frontend), "vitest" (backend) or "fullstack" (both) (found "jest")'])
})
test('git.base: a branch name, optional; the config keeps it as given', () => {
  assert.equal(validateConfig({ ...good, git: { base: 'develop' } }).ok, true)
  assert.equal(validateConfig({ ...good, git: { base: 'develop' } }).config.git.base, 'develop')
  assert.equal(validateConfig({ ...good, git: {} }).ok, true)
  assert.equal(validateConfig(good).config.git, undefined)
  assert.deepEqual(validateConfig({ ...good, git: { base: '' } }).errors, ['git.base "" must be a branch name, like "develop"'])
  assert.deepEqual(validateConfig({ ...good, git: { base: 'a\nb' } }).errors, ['git.base "a\\nb" must be a branch name, like "develop"'])
  assert.deepEqual(validateConfig({ ...good, git: { base: 5 } }).errors, ['git.base 5 must be a branch name, like "develop"'])
  assert.deepEqual(validateConfig({ ...good, git: { base: 'develop', extra: 1 } }).errors, ['git.extra: unknown field (only "base")'])
  assert.deepEqual(validateConfig({ ...good, git: 'develop' }).errors, ['git: must be an object with an optional "base"'])
})
test('seed block: each wrong part is named', () => {
  for (const v of ['x', 5, null, ['a']]) assert.deepEqual(validateConfig({ ...vgood, seed: v }).errors, ['seed: must be an object with optional "builders", "dataset", "stubsFrom" and "guide"'], JSON.stringify(v))
  const list = 'seed.builders: must be a list of 1 to 10 files that hold the seed builders'
  const eleven = Array.from({ length: 11 }, (_, i) => `t/s${i}.ts`)
  for (const b of [[], 'test/seed.ts', {}, eleven]) assert.deepEqual(validateConfig({ ...vgood, seed: { builders: b } }).errors, [list], JSON.stringify(b))
  const r = validateConfig({ ...vgood, seed: { builders: ['a.ts', 'a.ts', '../x.ts', '/abs.ts', 'test/helpers/', 3], dataset: 'docs/data.json', extra: 1 } })
  assert.deepEqual(r.errors, [
    'seed.extra: unknown field (only "builders", "dataset", "stubsFrom" and "guide")',
    'seed.builders[1] "a.ts" appears twice',
    'seed.builders[2] "../x.ts" must be a relative path inside the project (no "..", not absolute, one line)',
    'seed.builders[3] "/abs.ts" must be a relative path inside the project (no "..", not absolute, one line)',
    'seed.builders[4] "test/helpers/" must be a file, not a folder',
    'seed.builders[5] 3 must be a relative path inside the project (no "..", not absolute, one line)',
    'seed.dataset "docs/data.json" must be a relative path to a .md file inside the project',
  ])
  for (const d of ['../d.md', '/d.md', 'a\nb.md', '']) assert.ok(validateConfig({ ...vgood, seed: { dataset: d } }).errors[0].startsWith('seed.dataset '), JSON.stringify(d))
  assert.deepEqual(validateConfig({ ...good, seed: { stubsFrom: 'e2e/tests' } }).errors, ['seed.stubsFrom "e2e/tests" must be a folder ending with "/"'])
  assert.deepEqual(validateConfig({ ...good, seed: { stubsFrom: '../e2e/' } }).errors, ['seed.stubsFrom "../e2e/" must be a relative path inside the project (no "..", not absolute, one line)'])
})
test('the schema documents the seed block with the validator\'s path pattern', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  const s = schema.properties.seed
  assert.equal(s.type, 'object')
  assert.equal(s.additionalProperties, false)
  assert.equal(s.required, undefined)
  assert.deepEqual(Object.keys(s.properties).sort(), ['builders', 'dataset', 'guide', 'stubsFrom'])
  const path = schema.properties.vitest.properties.tsconfig.pattern
  assert.equal(s.properties.builders.items.pattern, path)
  assert.equal(s.properties.dataset.pattern, path)
  assert.equal(s.properties.stubsFrom.pattern, path)
  assert.equal(s.properties.guide.pattern, path)
  assert.equal(s.properties.builders.minItems, 1)
  assert.equal(s.properties.builders.maxItems, 10)
})

test('playwright.folder and playwright.guide: a valid block', () => {
  const r = validateConfig({ ...good, playwright: { folder: 'e2e/checkout/', guide: 'docs/testing/e2e.md' } })
  assert.equal(r.ok, true, r.errors?.join(' | '))
  assert.equal(r.config.playwright.folder, 'e2e/checkout/')
  assert.equal(r.config.playwright.guide, 'docs/testing/e2e.md')
})
test('playwright.folder and playwright.guide: each wrong part is named', () => {
  const errs = pw => validateConfig({ ...good, playwright: pw }).errors
  assert.deepEqual(errs({ folder: 'e2e' }), ['playwright.folder "e2e" must end with "/"'])
  assert.deepEqual(errs({ folder: '../e2e/' }), ['playwright.folder "../e2e/" must be a relative path inside the project (no "..", not absolute, one line)'])
  assert.deepEqual(errs({ folder: 5 }), ['playwright.folder 5 must be a relative path inside the project (no "..", not absolute, one line)'])
  assert.deepEqual(errs({ guide: 'docs/e2e.txt' }), ['playwright.guide "docs/e2e.txt" must be a relative path to a .md file inside the project'])
  assert.deepEqual(errs({ guide: '/abs.md' }), ['playwright.guide "/abs.md" must be a relative path to a .md file inside the project'])
})
test('playwright.folder: inside a forbidden boundary is refused, naming the rule; allow opens it', () => {
  assert.deepEqual(validateConfig({ ...good, playwright: { folder: 'src/e2e/' } }).errors, ['playwright.folder "src/e2e/" is inside the forbidden "src/"'])
  assert.deepEqual(validateConfig({ ...good, boundaries: { forbidden: [{ path: 'app/**' }] }, playwright: { folder: 'app/e2e/' } }).errors,
    ['playwright.folder "app/e2e/" is inside the forbidden "app/**"'])
  assert.equal(validateConfig({ ...good, boundaries: { allow: ['src/e2e/'] }, playwright: { folder: 'src/e2e/' } }).ok, true)
  assert.equal(validateConfig({ ...good, boundaries: { forbidden: [{ path: 'lib/' }] }, playwright: { folder: 'src/e2e/' } }).ok, true)
})

test('seed.guide is a .md file; qaPlans is a folder ending in /', () => {
  assert.equal(validateConfig({ ...vgood, seed: { guide: '.claude/quality-code/guides/seed.md' } }).ok, true)
  assert.deepEqual(validateConfig({ ...vgood, seed: { guide: 'seed.txt' } }).errors, ['seed.guide "seed.txt" must be a relative path to a .md file inside the project'])
  assert.equal(validateConfig({ ...vgood, qaPlans: 'test/qa-plans/' }).ok, true)
  for (const q of ['test/qa-plans', '../plans/', 5]) assert.deepEqual(validateConfig({ ...vgood, qaPlans: q }).errors, [`qaPlans ${JSON.stringify(q)} must be a folder inside the project, ending with "/" (one <feature label>.md per feature)`], String(q))
})

test('the schema knows every top-level field the validator takes, fullstack included', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/quality-code.schema.json', import.meta.url), 'utf8'))
  assert.deepEqual(schema.properties.adapter.enum, ['playwright', 'vitest', 'fullstack'])
  for (const f of ['sides', 'qaPlans', 'xray', 'git']) assert.ok(schema.properties[f], f)
  assert.equal(schema.properties.xray.properties.csv.pattern, schema.properties.qaPlans.pattern)
  assert.deepEqual(Object.keys(schema.properties.sides.properties), ['frontend', 'backend', 'fullstack'])
  assert.equal(schema.properties.qaPlans.pattern, schema.properties.vitest.properties.tsconfig.pattern)
})

test('xray: Playwright or fullstack only, a .csv, a folder outside the boundaries, known columns with distinct headers', () => {
  const x = { csv: 'qa/cases.csv' }
  assert.equal(validateConfig({ ...good, xray: x }).ok, true)
  assert.equal(validateConfig({ ...good, adapter: 'fullstack', xray: { ...x, folder: 'e2e/tickets/', headers: { action: 'Azione', data: 'Dati' } } }).ok, true)
  assert.deepEqual(validateConfig({ ...vgood, xray: x }).errors, ['xray: only allowed with "adapter": "playwright" or "fullstack" (XRay test cases are written for Playwright tests)'])
  assert.deepEqual(validateConfig({ ...good, xray: [] }).errors, ['xray: must be an object with "csv" and optional "folder" and "headers"'])
  assert.deepEqual(validateConfig({ ...good, xray: { csv: 'cases.xlsx', more: 1 } }).errors, ['xray.more: unknown field (only "csv", "folder" and "headers")', 'xray.csv "cases.xlsx" must be a relative path to a .csv file inside the project'])
  assert.deepEqual(validateConfig({ ...good, xray: { csv: '../cases.csv' } }).errors, ['xray.csv "../cases.csv" must be a relative path to a .csv file inside the project'])
  assert.deepEqual(validateConfig({ ...good, xray: { ...x, folder: 'src/tickets/' } }).errors, ['xray.folder "src/tickets/" is inside the forbidden "src/"'])
  assert.deepEqual(validateConfig({ ...good, xray: { ...x, folder: 'tickets' } }).errors, ['xray.folder "tickets" must end with "/"'])
  assert.deepEqual(validateConfig({ ...good, xray: { ...x, headers: { bad: 'B', action: 'a,b', ticket: 'Summary' } } }).errors, [
    'xray.headers.bad: unknown column (only tcid, summary, description, step, action, expected, label, priority, component, ticket, epic, testType, data)',
    'xray.headers.action: must be one line of text, without commas or quotes',
    'xray.headers: two columns have the same header',
  ])
})

test('vitest.stryker.timeoutSeconds: 60 to 7200, default 1800', async () => {
  const { strykerTimeoutSeconds } = await import('../../lib/base/config.mjs')
  assert.equal(strykerTimeoutSeconds({}), 1800)
  assert.equal(strykerTimeoutSeconds({ vitest: { stryker: { timeoutSeconds: 600 } } }), 600)
  assert.equal(validateConfig({ ...vgood, vitest: { stryker: { timeoutSeconds: 600 } } }).ok, true)
  for (const t of [59, 7201, 1.5, '600']) assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: { timeoutSeconds: t } } }).errors, ['vitest.stryker.timeoutSeconds: must be a whole number from 60 to 7200'], String(t))
  assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: { bad: 1 } } }).errors, ['vitest.stryker.bad: unknown field (only "threshold" and "timeoutSeconds")'])
})

test('$schema is accepted; git.base; ticketsDir stays inside and drops ./; jira.site may end in / or have a path', () => {
  const b = { version: 1, adapter: 'vitest', jira: { site: 'https://x.atlassian.net/', projects: ['ABC'] } }
  const r = validateConfig({ ...b, $schema: './node_modules/x/schema.json', git: { base: 'develop' }, ticketsDir: './qa/tickets' })
  assert.equal(r.ok, true, r.errors?.join('\n'))
  assert.equal(r.config.jira.site, 'https://x.atlassian.net')
  assert.equal(r.config.ticketsDir, 'qa/tickets')
  for (const t of ['../outside', '/etc/x', 'C:/x']) assert.match(validateConfig({ ...b, ticketsDir: t }).errors.join(), /ticketsDir .* must be a relative path inside the project/, t)
  assert.equal(validateConfig({ ...b, jira: { site: 'https://jira.example.com/jira', projects: ['ABC'] } }).ok, true)
  assert.deepEqual(validateConfig({ ...b, git: { base: '-x', other: 1 } }).errors, ['git.other: unknown field (only "base")', 'git.base "-x" must be a branch name, like "develop"'])
})
