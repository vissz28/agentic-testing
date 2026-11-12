// bin/qa.mjs: the rules /quality-code:qa leaves to a script: the JQL, saved progress, evidence paths, status picks, the watch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickTransition, pickXray, runsJql, stopCheck, main } from '../../bin/qa.mjs'
import { qaOf, validateConfig } from '../../lib/base/config.mjs'

const BASE = { version: 2, frontend: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['AB'] } }
function project(qa) {
  const root = mkdtempSync(join(tmpdir(), 'qc-qa-'))
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify({ ...BASE, ...(qa ? { qa } : {}) }))
  return { root, env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-cfg-')) } }
}
async function qa(p, ...args) {
  let out = ''
  let err = ''
  const code = await main(args, p.env, p.root, { stdout: s => { out += s }, stderr: s => { err += s }, now: () => '2026-11-03T10:00:00.000Z' })
  const machine = out.split('\n').find(l => /^QA_[A-Z_]+_JSON:/.test(l))
  return { code, out, err, json: machine ? JSON.parse(machine.slice(machine.indexOf(':') + 1)) : null }
}

test('qaOf: defaults are Xray\'s types, the open sprint, no fixed names, stop after 2 blocked', () => {
  assert.deepEqual(qaOf({}), { executionTypes: ['Test Execution', 'Sub Test Execution'], sprint: 'open', app: null, statuses: { ko: null, ready: null, done: null }, blockedStop: 2, autoPass: false })
})
test('the qa config block is validated: types, sprint, app, status names, numbers', () => {
  assert.equal(validateConfig({ ...BASE, qa: { executionTypes: ['Sub-task (Test)'], sprint: 'any', app: 'https://app.test', statuses: { ko: 'TEST KO', ready: 'Ready to test', done: 'DONE' }, blockedStop: 0, autoPass: true } }).errors, undefined)
  const bad = validateConfig({ ...BASE, qa: { executionTypes: ['a"b'], sprint: 'x', app: 'ftp://x', statuses: { ko: 'a"', zz: 'x' }, blockedStop: 99, autoPass: 'y', other: 1 } }).errors.join('\n')
  for (const m of ['qa.other', 'qa.executionTypes', 'qa.sprint', 'qa.app', 'qa.statuses.ko', 'qa.statuses.zz', 'qa.blockedStop', 'qa.autoPass']) assert.match(bad, new RegExp(m.replace('.', '\\.')))
})
test('runsJql: my open executions in the open sprint, in board order; any sprint when set so', () => {
  assert.equal(runsJql(qaOf({})), 'assignee = currentUser() AND issuetype in ("Test Execution", "Sub Test Execution") AND statusCategory != Done AND sprint in openSprints() ORDER BY Rank ASC, updated DESC')
  assert.equal(runsJql(qaOf({ qa: { executionTypes: ['Sub-task (Test)'], sprint: 'any' } })), 'assignee = currentUser() AND issuetype in ("Sub-task (Test)") AND statusCategory != Done ORDER BY Rank ASC, updated DESC')
})
test('pickXray: PASS, FAIL and BLOCK by name; ABORT when there is no BLOCK; several or none means ask', () => {
  assert.equal(pickXray('ok', ['TO DO', 'PASSED', 'FAILED']).pick, 'PASSED')
  assert.equal(pickXray('ko', ['TO DO', 'PASSED', 'FAILED']).pick, 'FAILED')
  assert.equal(pickXray('blocked', ['PASSED', 'BLOCKED', 'ABORTED']).pick, 'BLOCKED')
  assert.equal(pickXray('blocked', ['PASSED', 'ABORTED']).pick, 'ABORTED')
  const many = pickXray('ok', ['PASS', 'PASSED'])
  assert.deepEqual([many.ask, many.pick, many.candidates], [true, null, ['PASS', 'PASSED']])
  assert.deepEqual([pickXray('blocked', ['PASSED']).ask, pickXray('blocked', ['PASSED']).candidates], [true, ['PASSED']])
})
test('pickTransition: the configured name wins; without one a single KO or fail name; else ask', () => {
  const names = ['In Progress', 'TEST KO', 'Done']
  assert.deepEqual(pickTransition('run-ko', names, { ko: 'test ko', done: null }), { pick: 'TEST KO', ask: false, candidates: ['TEST KO'], source: 'config' })
  assert.equal(pickTransition('run-ko', names, { ko: null, done: null }).pick, 'TEST KO')
  assert.equal(pickTransition('run-ko', ['Failed', 'Test KO'], { ko: null, done: null }).ask, true)
  const missing = pickTransition('run-ko', ['Done'], { ko: 'TEST KO', done: null })
  assert.deepEqual([missing.ask, missing.missing], [true, 'TEST KO'])
  assert.equal(pickTransition('run-done', names, { ko: null, done: 'Done' }).pick, 'Done')
  assert.equal(pickTransition('run-done', names, { ko: null, done: null }).ask, true)
})
test('stopCheck: counts the blocked tests at the end; blockedStop 0 never suggests stopping', () => {
  const t = { A: { verdict: 'ok', n: 1 }, B: { verdict: 'blocked', n: 2 }, C: { verdict: 'blocked', n: 3 } }
  assert.deepEqual(stopCheck(t, 2), { blockedInARow: 2, stopSuggested: true })
  assert.deepEqual(stopCheck(t, 3), { blockedInARow: 2, stopSuggested: false })
  assert.equal(stopCheck(t, 0).stopSuggested, false)
  assert.equal(stopCheck({ ...t, D: { verdict: 'ok', n: 4 } }, 2).blockedInARow, 0)
})
test('state: progress is saved per test, resumable, and says when the environment looks down', async () => {
  const p = project()
  assert.equal((await qa(p, 'state', 'show', 'AB-1', '--tests', 'AB-2,AB-3')).json.exists, false)
  await qa(p, 'state', 'record', 'AB-1', 'AB-2', 'ok', '--story', 'AB-9')
  const ko = await qa(p, 'state', 'record', 'AB-1', 'AB-3', 'ko', '--step', '3', '--note', 'expected 5, shows 4', '--defect', 'AB-20', '--evidence', '/x/a.png', '--run-id', 'r3')
  assert.equal(ko.code, 0)
  const s = (await qa(p, 'state', 'show', 'AB-1', '--tests', 'AB-2,AB-3,AB-4')).json
  assert.deepEqual([s.exists, s.story, s.answered, s.pending], [true, 'AB-9', 2, ['AB-4']])
  assert.deepEqual(s.counts, { ok: 1, ko: 1, blocked: 0, skipped: 0 })
  assert.deepEqual(s.tests['AB-3'], { verdict: 'ko', n: 2, at: '2026-11-03T10:00:00.000Z', note: 'expected 5, shows 4', step: 3, evidence: '/x/a.png', defect: 'AB-20', runId: 'r3' })
  await qa(p, 'state', 'record', 'AB-1', 'AB-4', 'blocked')
  const last = await qa(p, 'state', 'record', 'AB-1', 'AB-5', 'blocked')
  assert.equal(last.json.stopSuggested, true)
  assert.match(last.out, /2 blocked tests in a row: the environment is probably down/)
  await qa(p, 'state', 'record', 'AB-1', 'AB-3', 'ok', '--xray', 'set')
  assert.equal((await qa(p, 'state', 'show', 'AB-1')).json.tests['AB-3'].xraySet, true)
  await qa(p, 'state', 'reset', 'AB-1')
  assert.equal((await qa(p, 'state', 'show', 'AB-1')).json.answered, 0)
})
test('state: bad input is refused with exit 2 and nothing is saved', async () => {
  const p = project()
  for (const args of [['state', 'record', 'AB-1', 'AB-2', 'maybe'], ['state', 'record', 'ab-1', 'AB-2', 'ok'], ['state', 'record', 'AB-1', 'AB-2', 'ok', '--defect', 'x'], ['state', 'close', 'AB-1', 'done'], ['state', 'record', 'AB-1', 'AB 2', 'ok'], ['bogus']])
    assert.equal((await qa(p, ...args)).code, 2, args.join(' '))
  assert.equal((await qa(p, 'state', 'show', 'AB-1')).json.exists, false)
})
test('evidence: the path of a failing step\'s screenshot, in a folder git ignores', async () => {
  const p = project()
  const r = await qa(p, 'evidence', 'AB-1', 'AB-3', '--step', '2')
  assert.match(r.json.path, /qa[\\/]evidence[\\/]AB-1[\\/]AB-3-step2\.png$/)
  assert.ok(existsSync(join(r.json.path, '..')))
  assert.equal(readFileSync(join(r.json.path, '..', '..', '..', '.gitignore'), 'utf8'), '*\n')
  assert.equal((await qa(p, 'evidence', 'AB-1', '../etc')).code, 2)
})
test('app: the configured address wins, else the last one used; set takes only http or https', async () => {
  const p = project()
  assert.equal((await qa(p, 'app', 'get')).json.app, null)
  assert.equal((await qa(p, 'app', 'set', 'https://app-test.example.com')).code, 0)
  assert.deepEqual((await qa(p, 'app', 'get')).json, { app: 'https://app-test.example.com', source: 'last run' })
  assert.equal((await qa(p, 'app', 'set', 'javascript:alert(1)')).code, 2)
  const fixed = project({ app: 'https://staging.example.com' })
  await qa(fixed, 'app', 'set', 'https://other.example.com')
  assert.deepEqual((await qa(fixed, 'app', 'get')).json, { app: 'https://staging.example.com', source: 'config' })
})
test('pick through the script: Xray names and Jira transitions', async () => {
  const p = project({ statuses: { ko: 'TEST KO' } })
  assert.equal((await qa(p, 'pick', 'blocked', '--from', 'PASSED,FAILED,BLOCKED')).json.pick, 'BLOCKED')
  assert.equal((await qa(p, 'pick', 'run-ko', '--from', 'In Progress,TEST KO,DONE')).json.source, 'config')
  assert.equal((await qa(p, 'pick', 'ok')).code, 2)
})
test('watch: only stories of runs that closed with a KO, in the ready status; each is told once; a new KO is told again', async () => {
  const none = project({ statuses: { ready: 'Ready to test' } })
  assert.deepEqual((await qa(none, 'jql', 'watch')).json.stories, [])
  assert.match((await qa(project(), 'jql', 'watch')).err, /qa\.statuses\.ready/)
  const p = none
  await qa(p, 'state', 'record', 'AB-1', 'AB-2', 'ko', '--story', 'AB-9')
  assert.deepEqual((await qa(p, 'jql', 'watch')).json.stories, [], 'an open run is not watched yet')
  await qa(p, 'state', 'close', 'AB-1', 'ko')
  const w = (await qa(p, 'jql', 'watch')).json
  assert.equal(w.jql, 'key in (AB-9) AND status = "Ready to test"')
  assert.deepEqual(w.runs, { 'AB-9': 'AB-1' })
  assert.deepEqual((await qa(p, 'watch', 'fresh', '--found', 'AB-9')).json.fresh, ['AB-9'])
  assert.deepEqual((await qa(p, 'watch', 'fresh', '--found', 'AB-9')).json.fresh, [])
  await qa(p, 'state', 'close', 'AB-1', 'ko')
  assert.deepEqual((await qa(p, 'watch', 'fresh', '--found', 'AB-9')).json.fresh, ['AB-9'])
  assert.equal((await qa(p, 'watch', 'fresh', '--found', 'nope')).code, 2)
})
