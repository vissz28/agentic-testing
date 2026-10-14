import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { detect, write } from '../core/setup.mjs'

const SETUP = join(dirname(fileURLToPath(import.meta.url)), '../core/setup.mjs')
const repo = pkg => { const d = mkdtempSync(join(tmpdir(), 'at-')); writeFileSync(join(d, 'package.json'), JSON.stringify(pkg)); return d }
const cfg = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
const LINE = '.claude/quality-code/tickets/*/raw.json'
const cli = (d, ...args) => spawnSync(process.execPath, [SETUP, ...args], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })

test('detects the stack', () => {
  assert.equal(detect(repo({ devDependencies: { '@playwright/test': '1' } })).adapter, 'playwright')
  assert.equal(detect(repo({ devDependencies: { vitest: '1' } })).adapter, 'vitest')
  assert.equal(detect(repo({ devDependencies: { vitest: '1', '@playwright/test': '1' } })).adapter, 'both')
  assert.equal(detect(repo({})).adapter, null)
  assert.equal(detect(mkdtempSync(join(tmpdir(), 'at-'))).adapter, null)
})
test('finds GitLab templates', () => {
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  writeFileSync(join(d, '.gitlab/issue_templates/Bug.md'), '#')
  assert.equal(detect(d).templates.bug, '.gitlab/issue_templates/Bug.md')
  assert.equal(detect(d).templates.story, null)
})
test('finds GitHub templates', () => {
  const d = repo({}); mkdirSync(join(d, '.github/ISSUE_TEMPLATE'), { recursive: true })
  writeFileSync(join(d, '.github/ISSUE_TEMPLATE/story.md'), '#')
  assert.equal(detect(d).templates.story, '.github/ISSUE_TEMPLATE/story.md')
})
test('detect reports existing config, bad JSON and gitignore state', () => {
  const d = repo({})
  assert.equal(detect(d).existing, null)
  assert.equal(detect(d).gitignore, false)
  write(d, cfg, {})
  const r = detect(d)
  assert.deepEqual(r.existing, cfg)
  assert.equal(r.gitignore, true)
  writeFileSync(join(d, '.claude/quality-code.json'), '{nope')
  const bad = detect(d)
  assert.equal(bad.existing, null)
  assert.match(bad.existingError, /not valid JSON/)
})
test('write refuses an invalid config and writes nothing', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, languages: [] }, { gitignoreLine: 'x' }).ok, false)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  assert.equal(existsSync(join(d, '.gitignore')), false)
})
test('write writes the config and one gitignore line, idempotently', () => {
  const d = repo({})
  write(d, cfg, { gitignoreLine: LINE })
  write(d, cfg, { gitignoreLine: LINE })
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')), cfg)
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8').match(/raw\.json/g).length, 1)
})
test('config is written as given, 2-space with trailing newline', () => {
  const d = repo({})
  write(d, cfg, {})
  assert.equal(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'), `${JSON.stringify(cfg, null, 2)}\n`)
})
test('gitignore: newline added before the line, content kept; custom ticketsDir used', () => {
  const d = repo({}); writeFileSync(join(d, '.gitignore'), 'node_modules')
  write(d, { ...cfg, ticketsDir: 'tix' }, {})
  assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'node_modules\ntix/*/raw.json\n')
  const e = repo({}); writeFileSync(join(e, '.gitignore'), 'a\n')
  write(e, cfg, {})
  assert.equal(readFileSync(join(e, '.gitignore'), 'utf8'), `a\n${LINE}\n`)
})
test('gitignore: a trailing slash or backslashes in ticketsDir still give <dir>/*/raw.json', () => {
  for (const ticketsDir of ['tix/', 'tix\\']) {
    const d = repo({})
    assert.equal(write(d, { ...cfg, ticketsDir }, {}).ok, true)
    assert.equal(readFileSync(join(d, '.gitignore'), 'utf8'), 'tix/*/raw.json\n', ticketsDir)
    assert.equal(detect(d).gitignore, true, ticketsDir)
  }
})
test('a newline in ticketsDir is refused before .gitignore is touched', () => {
  const d = repo({})
  assert.equal(write(d, { ...cfg, ticketsDir: 'tix\n!secret' }, {}).ok, false)
  assert.equal(existsSync(join(d, '.gitignore')), false)
})
test('templates are written when absent and wired into ticketTemplates', () => {
  const d = repo({})
  assert.equal(write(d, cfg, { templates: { bug: '# Bug', story: '# Story' } }).ok, true)
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'utf8'), '# Bug\n')
  assert.equal(existsSync(join(d, '.gitlab/issue_templates/Story.md')), true)
  const written = JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8'))
  assert.deepEqual(written.ticketTemplates, { bug: '.gitlab/issue_templates/Bug.md', story: '.gitlab/issue_templates/Story.md' })
})
test('existing templates are never overwritten', () => {
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  writeFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'mine')
  write(d, cfg, { templates: { bug: '# Bug', story: '# Story' } })
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Bug.md'), 'utf8'), 'mine')
  assert.equal(readFileSync(join(d, '.gitlab/issue_templates/Story.md'), 'utf8'), '# Story\n')
})
test('a ticketTemplates value already set is kept', () => {
  const d = repo({})
  const c = { ...cfg, ticketTemplates: { bug: 'docs/bug.md', story: null } }
  write(d, c, { templates: { bug: '#', story: '#' } })
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')).ticketTemplates, c.ticketTemplates)
})
test('paths escaping the project are rejected and nothing is written', () => {
  for (const bad of [{ ticketsDir: '../out' }, { ticketsDir: '/abs' }, { ticketTemplates: { bug: '../b.md' } }, { ticketTemplates: { story: '/etc/x' } }]) {
    const d = repo({})
    const r = write(d, { ...cfg, ...bad }, { templates: { bug: '#', story: '#' } })
    assert.equal(r.ok, false)
    assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
    assert.equal(existsSync(join(d, '.gitlab')), false)
  }
})
test('CLI --detect prints one SETUP_JSON line and exits 0', () => {
  const d = repo({ devDependencies: { vitest: '1' } })
  const r = cli(d, '--detect')
  assert.equal(r.status, 0)
  const lines = r.stdout.trimEnd().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0].replace(/^SETUP_JSON:/, '')).adapter, 'vitest')
})
test('CLI --write @file writes and prints ok', () => {
  const d = repo({})
  writeFileSync(join(d, 'p.json'), JSON.stringify({ config: cfg, templates: { bug: '#', story: '#' } }))
  const r = cli(d, '--write', '@p.json')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'ok\n')
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), true)
})
test('CLI --write prints each error on its own line, exits 2, writes nothing', () => {
  const d = repo({})
  writeFileSync(join(d, 'p.json'), JSON.stringify({ config: { ...cfg, languages: [], adapter: 'x' } }))
  const r = cli(d, '--write', '@p.json')
  assert.equal(r.status, 2)
  assert.equal(r.stdout.trimEnd().split('\n').length >= 2, true)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  assert.equal(cli(d, '--write', '@missing.json').status, 2)
})
test('re-running the same proposal is idempotent and keeps ticketTemplates', () => {
  const d = repo({})
  const run = () => { assert.equal(write(d, cfg, { templates: { bug: '#', story: '#' } }).ok, true); return readFileSync(join(d, '.claude/quality-code.json'), 'utf8') }
  const first = run()
  assert.equal(run(), first)
  assert.ok(JSON.parse(first).ticketTemplates)
})
test('write never throws: a dangling symlink at a template path is an error, nothing partial written', async () => {
  const { symlinkSync } = await import('node:fs')
  const d = repo({}); mkdirSync(join(d, '.gitlab/issue_templates'), { recursive: true })
  symlinkSync(join(d, 'missing-target'), join(d, '.gitlab/issue_templates/Bug.md'))
  const proposal = { config: cfg, templates: { bug: '#', story: '#' } }
  const r = write(d, proposal.config, { templates: proposal.templates })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /Bug\.md/)
  assert.equal(existsSync(join(d, '.claude/quality-code.json')), false)
  writeFileSync(join(d, 'p.json'), JSON.stringify(proposal))
  const c = cli(d, '--write', '@p.json')
  assert.equal(c.status, 2)
  assert.match(c.stdout, /Bug\.md/)
  assert.equal(c.stderr, '')
})
