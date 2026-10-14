import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attribute, classifyUser, findProjectDirs, loadSessions, slugFor } from '../../core/consumption/transcripts.mjs'
import { install } from './helpers.mjs'

const load = opts => {
  const f = install(opts)
  const { dirs } = findProjectDirs(f.root, f.configDir)
  return { ...f, dirs, sessions: dirs.flatMap(loadSessions) }
}
const runOf = (usage, iso) => {
  const e = usage.events.find(x => x.t === Date.parse(iso))
  return e ? e.run : 'missing'
}

test('slug: every character that is not a letter or digit becomes "-"', () => {
  assert.equal(slugFor('/home/user/agentic-testing'), '-home-user-agentic-testing')
  assert.equal(slugFor('/a/my project/x_y.z'), '-a-my-project-x-y-z')
})

test('the slug folder is found first', () => {
  const { dirs, dir } = load()
  assert.deepEqual(dirs, [dir])
})

test('when the slug guess fails, folders whose sessions ran in the project are found by cwd', () => {
  const { dirs, dir, root, configDir } = load({ folder: 'some-truncated-name-1a2b' })
  assert.deepEqual(dirs, [dir])
  assert.deepEqual(findProjectDirs(`${root}-other`, configDir).dirs, [])
})

test('nothing found: no folders and the places looked at', () => {
  const r = findProjectDirs('/no/such/project', '/no/such/config')
  assert.deepEqual(r.dirs, [])
  assert.ok(r.looked[0].endsWith('-no-such-project'))
})

test('classifyUser: commands, prompts, card answers and what never ends a run', () => {
  const u = (content, extra = {}) => classifyUser({ type: 'user', message: { content }, ...extra })
  const c = u('<command-message>quality-code:check</command-message>\n<command-name>/quality-code:check</command-name>\n<command-args>--key ABC-1</command-args>')
  assert.deepEqual(c, { kind: 'command', name: 'quality-code:check', args: '--key ABC-1' })
  assert.equal(u([{ type: 'text', text: '<command-name>/clear</command-name>' }]).kind, 'command')
  assert.equal(u([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]).kind, 'tool')
  assert.equal(u('expanded prompt', { isMeta: true }).kind, 'meta')
  assert.equal(u('<task-notification>x</task-notification>', { origin: { kind: 'task-notification' } }).kind, 'meta')
  assert.equal(u('<system-reminder>x</system-reminder>').kind, 'meta')
  assert.equal(u('[Request interrupted by user]').kind, 'meta')
  assert.equal(u('hello there', { isSidechain: true }).kind, 'other')
  for (const a of ['1', ' 2 ', '1, 3', 'ABC-123', 'none', 'yes']) assert.equal(u(a).kind, 'answer', a)
  assert.equal(u('fix the login page please').kind, 'prompt')
})

test('one API response written on several lines counts once (by requestId)', () => {
  const usage = attribute(load().sessions)
  const c1 = usage.events.filter(e => e.tokens.cacheRead === 10000)
  assert.equal(c1.length, 1)
  assert.deepEqual(c1[0].tokens, { input: 1000, output: 1000, cacheWrite5m: 1000, cacheWrite1h: 1000, cacheRead: 10000 })
  assert.equal(usage.events.filter(e => e.t === Date.parse('2026-10-10T09:00:05.000Z')).length, 1)
  assert.equal(usage.events.filter(e => e.t === Date.parse('2026-10-10T09:00:06.000Z')).length, 0)
})

test('the same request in two places counts once; message.id is the fallback id', () => {
  const line = { type: 'assistant', timestamp: '2026-10-10T10:00:00Z', message: { id: 'msg-1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } }
  const s = { id: 's', lines: [line, { ...line }], subagents: [] }
  assert.equal(attribute([s, { ...s, id: 't' }]).events.length, 1)
})

test('runs: from the command line to the next real prompt; card answers keep the run going', () => {
  const usage = attribute(load().sessions)
  assert.deepEqual(usage.runs.map(r => [r.command, r.key, r.sessionId]), [
    ['check', 'ABC-12', 'sess-a'], ['start', null, 'sess-a'], ['ticket-eval', 'XYZ-7', 'sess-b'], ['check', 'ABC-34', 'sess-b'],
  ])
  const [check, start] = usage.runs
  assert.equal(runOf(usage, '2026-10-10T09:00:05.000Z'), null, 'before the command')
  assert.equal(runOf(usage, '2026-10-10T10:00:10.000Z'), check)
  assert.equal(runOf(usage, '2026-10-10T10:06:10.000Z'), check, 'after the card answer "1"')
  assert.equal(runOf(usage, '2026-10-10T11:00:10.000Z'), null, 'after the next real prompt')
  assert.equal(runOf(usage, '2026-10-11T08:00:10.000Z'), start)
  assert.equal(runOf(usage, '2026-10-11T09:00:10.000Z'), null, 'another plugin command ends the run')
})

test('subagents belong to the run that spawned them: by tool call, else by start time', () => {
  const usage = attribute(load().sessions)
  const [check, start] = usage.runs
  assert.equal(runOf(usage, '2026-10-10T12:00:10.000Z'), check, 'spawned by check, still working after the next prompt')
  assert.equal(runOf(usage, '2026-10-11T08:30:10.000Z'), start, 'no tool call id: the run active when it started')
})

test('synthetic messages carry no usage and are skipped', () => {
  const usage = attribute(load().sessions)
  assert.ok(!usage.events.some(e => e.model === '<synthetic>'))
  assert.equal(usage.events.length, 10)
})

test('ticket keys: the configured projects only when given', () => {
  const usage = attribute(load().sessions, { keySource: '(?:ABC)-\\d+' })
  assert.deepEqual(usage.runs.map(r => r.key), ['ABC-12', null, null, 'ABC-34'])
})
