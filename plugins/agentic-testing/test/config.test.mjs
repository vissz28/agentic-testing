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

bad({ jira: 'x' }, 'jira')
bad({ jira: 5 }, 'jira')
bad({ jira: { ...good.jira, trackingProjects: 'ABC' } }, 'jira.trackingProjects')
bad({ jira: { ...good.jira, trackingProjects: { a: 1 } } }, 'jira.trackingProjects')
bad({ titlePrefixes: 'FE' }, 'titlePrefixes')
bad({ titlePrefixes: ['FE', ''] }, 'titlePrefixes[1]')
bad({ ticketsDir: '' }, 'ticketsDir')
bad({ ticketsDir: 5 }, 'ticketsDir')
bad({ ticketTemplates: 'x' }, 'ticketTemplates')
bad({ ticketTemplates: { bug: 5 } }, 'ticketTemplates.bug')
bad({ ticketTemplates: { story: {} } }, 'ticketTemplates.story')
bad({ ticketTemplates: { epic: 'x' } }, 'ticketTemplates.epic')
bad({ redact: 'x' }, 'redact')
bad({ redact: { x: 5 } }, 'redact.x')
bad({ messages: 'x' }, 'messages')
bad({ messages: [] }, 'messages')
bad({ features: [{ label: 'A', route: 5 }] }, 'features[0].route')

test('a non-string route is not reported as missing a slash', () => {
  const r = validateConfig({ ...good, features: [{ label: 'A', route: 5 }] })
  assert.doesNotMatch(r.errors.join(' '), /start with/)
})

test('validateConfig never throws on non-object input', () => {
  for (const v of ['x', null, undefined, 5, []]) assert.equal(validateConfig(v).ok, false)
})
