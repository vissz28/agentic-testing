import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { attribute, classifyUser, findProjectDirs, loadSessions, slugFor } from '../../lib/report/transcripts.mjs'
import { install } from './helpers.mjs'

const load = opts => {
  const f = install(opts)
  const { dirs, sessions } = findProjectDirs(f.root, f.configDir)
  return { ...f, dirs, sessions: dirs.flatMap(d => loadSessions(d, sessions[d])) }
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

test('a session counts by its cwd: another path with the same slug is left out, a subfolder of the project is in', () => {
  const { dirs, dir, root, configDir } = load()
  const line = cwd => `${JSON.stringify({ type: 'user', cwd, message: { content: 'hi' } })}\n`
  writeFileSync(join(dir, 'other.jsonl'), line(root.replace('my project', 'my/project')))
  const sub = join(configDir, 'projects', `${slugFor(root)}-packages-web`)
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, 'web.jsonl'), line(join(root, 'packages/web')))
  const r = findProjectDirs(root, configDir)
  assert.deepEqual(r.dirs, [dir, sub])
  assert.ok(!r.sessions[dir].includes('other.jsonl'), 'same slug, other project')
  assert.deepEqual(r.sessions[sub], ['web.jsonl'])
  assert.deepEqual(dirs, [dir])
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
  assert.equal(u('This session is being continued from a previous conversation.', { isCompactSummary: true }).kind, 'meta')
  assert.equal(u('<task-notification>x</task-notification>', { origin: { kind: 'task-notification' } }).kind, 'meta')
  assert.equal(u('<system-reminder>x</system-reminder>').kind, 'meta')
  assert.equal(u('[Request interrupted by user]').kind, 'meta')
  assert.equal(u('hello there', { isSidechain: true }).kind, 'other')
  for (const a of ['1', ' 2 ', '1, 3', 'ABC-123', 'MY_PROJ-7', 'none', 'yes', 'y', 'ok', 'sì', 'si', 'va bene', 'stop', 'basta']) assert.equal(u(a).kind, 'answer', a)
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

test('a free-text answer to a card keeps the run going (a headless session); after a reply with no card it ends the run', () => {
  const usage = { input_tokens: 1, output_tokens: 1 }
  const at = (sec, line) => ({ timestamp: `2026-10-10T10:00:${String(sec).padStart(2, '0')}Z`, ...line })
  const said = (sec, id, text) => at(sec, { type: 'assistant', requestId: id, message: { model: 'claude-opus-5-5', usage, content: [{ type: 'text', text }] } })
  const user = (sec, content) => at(sec, { type: 'user', message: { content } })
  const lines = [
    user(0, '<command-name>/quality-code:spec</command-name><command-args>ABC-9</command-args>'),
    said(1, 'r1', 'Plan\n  1. Write the tests\n  2. Only check the tests already on this branch'),
    user(2, 'Write the tests, keep the stub'),
    said(3, 'r2', 'Done: 12 tests written.'),
    user(4, 'thanks, now look at the login bug'),
    said(5, 'r3', 'Looking.'),
  ]
  const r = attribute([{ id: 's', lines, subagents: [] }])
  assert.deepEqual(r.events.map(e => e.run?.command ?? null), ['spec', 'spec', null])
})
test('a command the model starts with the Skill tool opens a run, its args give the key', () => {
  const usage = { input_tokens: 1, output_tokens: 1 }
  const at = (sec, line) => ({ timestamp: `2026-10-10T10:00:0${sec}Z`, ...line })
  const lines = [
    at(0, { type: 'user', message: { content: 'check ABC-9 please' } }),
    at(1, { type: 'assistant', requestId: 'r1', message: { model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'quality-code:check', args: '--key ABC-9' } }] } }),
    at(2, { type: 'assistant', requestId: 'r2', message: { model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'ok' }] } }),
  ]
  const r = attribute([{ id: 's', lines, subagents: [] }])
  assert.deepEqual(r.runs.map(x => [x.command, x.key]), [['check', 'ABC-9']])
  assert.equal(r.events.at(-1).run, r.runs[0])
})

test('direct names its run after the command it routes to, and that command does not open a second run', () => {
  const usage = { input_tokens: 1, output_tokens: 1 }
  const at = (sec, line) => ({ timestamp: `2026-10-10T10:00:${String(sec).padStart(2, '0')}Z`, ...line })
  const said = (sec, id, content) => at(sec, { type: 'assistant', requestId: id, message: { model: 'claude-opus-5-5', usage, content } })
  const skill = (id, name, args) => [{ type: 'tool_use', id, name: 'Skill', input: { skill: `quality-code:${name}`, args } }]
  const user = (sec, content) => at(sec, { type: 'user', message: { content } })
  // The plugin alone: direct, then the Skill it names.
  const plugin = attribute([{ id: 's', subagents: [], lines: [
    user(0, 'Quality Code ticket ABC-1'),
    said(1, 'r1', skill('t1', 'direct', 'ticket ABC-1')),
    said(2, 'r2', skill('t2', 'ticket', 'ABC-1')),
    said(3, 'r3', [{ type: 'text', text: 'done' }]),
    user(4, '<command-name>/quality-code:direct</command-name><command-args>spec ABC-2</command-args>'),
    said(5, 'r4', skill('t3', 'spec', 'ABC-2')),
    said(6, 'r5', skill('t4', 'check', '--key ABC-2')),
  ] }])
  assert.deepEqual(plugin.runs.map(r => [r.command, r.key]), [['ticket', 'ABC-1'], ['spec', 'ABC-2'], ['check', 'ABC-2']])
  assert.deepEqual(plugin.events.map(e => e.run.command), ['ticket', 'ticket', 'ticket', 'spec', 'check'])
  // The connector: a sentence the server routes; its answer names the command.
  const tool = 'mcp__plugin_quality-code_quality-code__quality_code_direct'
  const server = attribute([{ id: 's', subagents: [], lines: [
    user(0, 'Quality Code write the tests for ABC-3'),
    said(1, 'r1', skill('t1', 'direct', 'write the tests for ABC-3')),
    said(2, 'r2', [{ type: 'tool_use', id: 't2', name: tool, input: { request: 'Quality Code write the tests for ABC-3' } }]),
    user(3, [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'Using Quality Code: understood as /quality-code:spec ABC-3 (if that is not ...' }] }]),
    said(4, 'r3', [{ type: 'text', text: 'Plan' }]),
  ] }])
  assert.deepEqual(server.runs.map(r => [r.command, r.key]), [['spec', 'ABC-3']])
  assert.equal(new Set(server.events.map(e => e.run)).size, 1)
})

test('a resumed session repeats the earlier messages: their runs and requests are counted once', () => {
  const usage = { input_tokens: 100, output_tokens: 10 }
  const T = sec => `2026-10-10T10:00:${String(sec).padStart(2, '0')}Z`
  const orig = [
    { type: 'user', uuid: 'u1', timestamp: T(0), message: { content: '<command-name>/quality-code:spec</command-name><command-args>ABC-1</command-args>' } },
    { type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: T(1), message: { model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'quality-code:check', args: '--key ABC-1' } }] } },
  ]
  const resumed = [...orig, { type: 'assistant', uuid: 'a2', requestId: 'r2', timestamp: T(30), message: { model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'ok' }] } }]
  for (const sessions of [[orig, resumed], [resumed, orig]]) {
    const r = attribute(sessions.map((lines, i) => ({ id: `s${i}`, lines, subagents: [] })))
    assert.deepEqual(r.runs.map(x => x.command), ['spec', 'check'])
    assert.equal(r.events.length, 2)
    assert.equal(r.events.find(e => e.t === Date.parse(T(30))).run, r.runs[1], 'the resumed session goes on in the same run')
  }
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
