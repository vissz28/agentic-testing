import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTORS_TTL_MS, clearContext, fileChanged, getFact, listContext, recordFile, setFact } from '../../lib/base/context.mjs'
import { main } from '../../bin/progress.mjs'

const env = () => ({ CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-ctx-')) })
const project = () => mkdtempSync(join(tmpdir(), 'qc-proj-'))

test('nothing saved: not found', () => {
  assert.deepEqual(getFact(project(), 'flow', null, env()), { ok: true, found: false })
})
test('a fact with no source rule is fresh and keeps its value', () => {
  const e = env(), r = project()
  assert.equal(setFact(r, 'flow', { flow: 'project', why: 'the project has 40 tests' }, { kind: 'none' }, e).ok, true)
  const g = getFact(r, 'flow', null, e)
  assert.deepEqual([g.found, g.fresh, g.value.flow], [true, true, 'project'])
})
test('ttl: fresh inside the limit, stale after it, with the reason', () => {
  const e = env(), r = project(), t0 = Date.parse('2026-11-04T08:00:00Z')
  setFact(r, 'connectors', { jira: 'ok' }, { kind: 'ttl', value: CONNECTORS_TTL_MS }, e, t0)
  assert.equal(getFact(r, 'connectors', null, e, t0 + CONNECTORS_TTL_MS - 1000).fresh, true)
  const old = getFact(r, 'connectors', null, e, t0 + CONNECTORS_TTL_MS + 1000)
  assert.deepEqual([old.fresh, old.reason, old.value], [false, 'older than its time limit', undefined])
})
test('head, hash and ticket: fresh only while the token is the same', () => {
  const e = env(), r = project()
  for (const [name, kind, tok, next, why] of [['tests', 'head', 'abc123', 'def456', 'the code changed (new git commit)'], ['style', 'hash', 'h1', 'h2', 'its source changed'], ['jira', 'ticket', '2026-11-04T10:00', '2026-11-04T11:00', 'the ticket changed']]) {
    setFact(r, name, { x: 1 }, { kind, value: tok }, e)
    assert.equal(getFact(r, name, tok, e).fresh, true, `${kind} same`)
    const stale = getFact(r, name, next, e)
    assert.deepEqual([stale.fresh, stale.reason], [false, why], `${kind} changed`)
    assert.equal(getFact(r, name, null, e).fresh, false, `${kind} no current token`)
  }
})
test('facts are per project: another folder sees nothing', () => {
  const e = env(), a = project(), b = project()
  setFact(a, 'stack', { adapter: 'vitest' }, { kind: 'none' }, e)
  assert.equal(getFact(b, 'stack', null, e).found, false)
})
test('secrets, unknown facts, bad sources and oversized values are refused', () => {
  const e = env(), r = project()
  assert.match(setFact(r, 'flow', { token: 'x' }, { kind: 'none' }, e).reason, /secret/)
  assert.match(setFact(r, 'flow', { note: ['ghp', 'x'.repeat(36)].join('_') }, { kind: 'none' }, e).reason, /secret/)
  assert.equal(setFact(r, 'nope', 1, { kind: 'none' }, e).ok, false)
  assert.equal(setFact(r, 'flow', 1, { kind: 'forever' }, e).ok, false)
  assert.equal(setFact(r, 'flow', 1, { kind: 'ttl', value: -5 }, e).ok, false)
  assert.equal(setFact(r, 'flow', 1, { kind: 'head' }, e).ok, false)
  assert.equal(setFact(r, 'flow', 'x'.repeat(70000), { kind: 'none' }, e).ok, false)
  assert.equal(getFact(r, 'flow', null, e).found, false)
})
test('a file is kept as a path and a hash, not as a copy; a change is seen; paths stay inside the project', () => {
  const e = env(), r = project()
  mkdirSync(join(r, 'src'))
  writeFileSync(join(r, 'src/pricing.ts'), 'export const a = 1\n')
  const rec = recordFile(r, 'src/pricing.ts', 'target', e)
  assert.equal(rec.ok, true)
  assert.equal(JSON.stringify(listContext(r, e)).includes('export const a'), false)
  assert.deepEqual(fileChanged(r, 'src/pricing.ts', e), { ok: true, known: true, changed: false, role: 'target' })
  writeFileSync(join(r, 'src/pricing.ts'), 'export const a = 2\n')
  assert.equal(fileChanged(r, 'src/pricing.ts', e).changed, true)
  assert.equal(fileChanged(r, 'src/other.ts', e).known, false)
  for (const bad of ['/etc/passwd', '../x', 'src/../../x', 'missing.ts']) assert.equal(recordFile(r, bad, 'file', e).ok, false, bad)
})
test('clear forgets one fact or all of them; list shows what is kept', () => {
  const e = env(), r = project()
  setFact(r, 'flow', 1, { kind: 'none' }, e)
  setFact(r, 'stack', 2, { kind: 'none' }, e)
  assert.deepEqual(listContext(r, e).facts.map(f => f.name).sort(), ['flow', 'stack'])
  assert.deepEqual(clearContext(r, 'flow', e), { ok: true, cleared: true })
  assert.deepEqual(clearContext(r, 'flow', e), { ok: true, cleared: false })
  assert.deepEqual(clearContext(r, null, e), { ok: true, cleared: true })
  assert.equal(listContext(r, e).facts.length, 0)
})
test('the script: set, get (reuse and stale), file, changed, list, clear and usage errors', async () => {
  const e = env(), r = project()
  writeFileSync(join(r, 'a.ts'), 'x')
  const run = async argv => { let o = '', er = ''; const code = await main(argv, { env: e, cwd: r, stdout: s => { o += s }, stderr: s => { er += s } }); return { code, o, er } }
  assert.equal((await run(['context', 'set', 'style', '--data', '{"assertions":"assertj"}', '--source', 'hash:h1'])).code, 0)
  assert.match((await run(['context', 'get', 'style', '--current', 'h1'])).o, /Reusing style/)
  assert.match((await run(['context', 'get', 'style', '--current', 'h2'])).o, /Read style again: its source changed/)
  assert.match((await run(['context', 'file', 'a.ts', '--role', 'target'])).o, /recorded/)
  assert.match((await run(['context', 'changed', 'a.ts'])).o, /unchanged/)
  assert.match((await run(['context', 'list'])).o, /style \(hash/)
  assert.match((await run(['context', 'clear'])).o, /forgotten/)
  assert.match((await run(['context', 'get', 'style'])).o, /Nothing saved about style/)
  for (const bad of [['context'], ['context', 'get'], ['context', 'bogus', 'x'], ['context', 'set', 'style', '--data', '{', '--source', 'none'], ['context', 'set', 'style', '--data', '{"token":"x"}', '--source', 'none'], ['context', 'get', 'nope']]) assert.equal((await run(bad)).code, 2, bad.join(' '))
})

test('the progress guide, setup and spec carry the project-context rule', async () => {
  const { readFileSync } = await import('node:fs')
  const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  const guide = read('guides/progress.md')
  for (const t of ['## Project context', 'context get <fact> --head', 'context set <fact>', 'context file <path>', 'context changed <path>', '`--fresh`', 'never a token, key, password or ticket text', 'a file is kept as a path and a hash, never as a copy']) assert.ok(guide.includes(t), t)
  for (const f of ['commands/setup.md', 'commands/spec.md']) assert.match(read(f), /\*\*Project context\*\* section also applies/, f)
})
