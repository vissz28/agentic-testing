// The acceptance-criteria field is found when a ticket is checked, not in setup, and remembered
// per Jira project in a local file. A field named in the team config always wins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIELDS_REL, resolveField, storeField } from '../../lib/ticket/fields.mjs'

const CLI = new URL('../../bin/ticket.mjs', import.meta.url).pathname
const base = { version: 1, adapter: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'] } }
const dir = (cfg = base) => {
  const d = mkdtempSync(join(tmpdir(), 'qc-f-'))
  mkdirSync(join(d, '.claude'))
  writeFileSync(join(d, '.claude/quality-code.json'), JSON.stringify(cfg))
  return d
}
const run = (d, ...argv) => spawnSync('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: 'utf8' })
const json = r => JSON.parse(r.stdout.trim().split('\n').find(l => l.startsWith('FIELD_JSON:')).slice(11))

test('unknown until stored; stored per project; none is stored as null', () => {
  const d = dir()
  assert.deepEqual(resolveField(d, base, 'DEMO'), { field: undefined, source: 'unknown' })
  assert.equal(storeField(d, 'DEMO', 'customfield_10001').ok, true)
  assert.equal(storeField(d, 'OTHER', 'none').ok, true)
  assert.deepEqual(resolveField(d, base, 'DEMO'), { field: 'customfield_10001', source: 'stored' })
  assert.deepEqual(resolveField(d, base, 'OTHER'), { field: null, source: 'stored' })
  assert.deepEqual(JSON.parse(readFileSync(join(d, FIELDS_REL), 'utf8')), { projects: { DEMO: 'customfield_10001', OTHER: null } })
})
test('the team config wins, null included', () => {
  const d = dir()
  storeField(d, 'DEMO', 'customfield_1')
  assert.deepEqual(resolveField(d, { ...base, jira: { ...base.jira, acceptanceCriteriaField: 'customfield_2' } }, 'DEMO'), { field: 'customfield_2', source: 'config' })
  assert.deepEqual(resolveField(d, { ...base, jira: { ...base.jira, acceptanceCriteriaField: null } }, 'DEMO'), { field: null, source: 'config' })
})
test('only customfield_<digits> or none, only project keys', () => {
  const d = dir()
  for (const v of ['11707', 'customfield_x', 'description', '', 'customfield_1 ']) assert.equal(storeField(d, 'DEMO', v).ok, false, v)
  for (const p of ['demo', 'DE MO', '']) assert.equal(storeField(d, p, 'none').ok, false, p)
  assert.equal(existsSync(join(d, FIELDS_REL)), false)
})
test('a broken local file reads as unknown and is rewritten on the next store', () => {
  const d = dir()
  mkdirSync(join(d, '.claude/quality-code'), { recursive: true })
  writeFileSync(join(d, FIELDS_REL), '{nope')
  assert.equal(resolveField(d, base, 'DEMO').source, 'unknown')
  assert.equal(storeField(d, 'DEMO', 'none').ok, true)
  assert.deepEqual(resolveField(d, base, 'DEMO'), { field: null, source: 'stored' })
})
test('CLI: field get and field set', () => {
  const d = dir()
  let r = run(d, 'field', 'get', 'DEMO')
  assert.equal(r.status, 0)
  assert.deepEqual(json(r), { project: 'DEMO', field: null, source: 'unknown' })
  r = run(d, 'field', 'set', 'DEMO', 'customfield_10001')
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), 'ok')
  assert.deepEqual(json(run(d, 'field', 'get', 'DEMO')), { project: 'DEMO', field: 'customfield_10001', source: 'stored' })
  r = run(d, 'field', 'set', 'DEMO', '11707')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /customfield_<digits> or none/)
  assert.equal(run(d, 'field', 'get').status, 2)
  assert.equal(run(d, 'field', 'nope', 'DEMO').status, 2)
})
