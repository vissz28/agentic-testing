import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
