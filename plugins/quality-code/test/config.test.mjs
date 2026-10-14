import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfig, loadConfig, projectRoot, configPath, layersOf, strykerThreshold } from '../core/config.mjs'

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

test('projectRoot prefers CLAUDE_PROJECT_DIR, else cwd', () => {
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
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
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
  assert.deepEqual(r.config.languages, ['en', 'it'])
  assert.deepEqual(r.config.features, [])
  assert.equal('acceptanceCriteriaField' in r.config.jira, false)
})
test('given languages and features still win over the defaults', () => {
  const r = validateConfig(good)
  assert.deepEqual(r.config.languages, ['en'])
  assert.deepEqual(r.config.features, [{ label: 'Orders', route: '/orders' }])
  assert.equal(r.config.jira.acceptanceCriteriaField, null)
})
test('the schema requires only version, adapter and jira site and projects', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
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
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
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
  assert.ok(r.errors.includes('vitest: only allowed with "adapter": "vitest"'))
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
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
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
  const schema = JSON.parse(readFileSync(new URL('../schema/quality-code.schema.json', import.meta.url), 'utf8'))
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
  for (const v of ['x', 5, null, []]) assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: v } }).errors, ['vitest.stryker: must be an object with an optional "threshold"'], JSON.stringify(v))
  assert.deepEqual(validateConfig({ ...vgood, vitest: { stryker: { bar: 1 } } }).errors, ['vitest.stryker.bar: unknown field (only "threshold")'])
})
