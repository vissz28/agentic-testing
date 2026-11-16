import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../bin/progress.mjs'
import { MAX_AGE_MS, clearProgress, getProgress, listProgress, setProgress } from '../../lib/state/progress.mjs'

const env = () => ({ CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'qc-prog-')) })
const root = mkdtempSync(join(tmpdir(), 'qc-root-'))

test('nothing saved: found is false', () => {
  assert.deepEqual(getProgress(root, 'setup', null, env()), { ok: true, found: false })
})
test('set then get: the step, the label and the answers come back', () => {
  const e = env()
  assert.equal(setProgress(root, 'setup', { step: 3, label: 'Jira site', data: { where: 'repo', site: 'https://x.atlassian.net' } }, e).ok, true)
  const r = getProgress(root, 'setup', null, e)
  assert.equal(r.found, true)
  assert.equal(r.step, 3)
  assert.deepEqual(r.data, { where: 'repo', site: 'https://x.atlassian.net' })
})
test('a later set keeps the earlier answers and adds the new ones', () => {
  const e = env()
  setProgress(root, 'setup', { step: 1, data: { where: 'repo' } }, e)
  setProgress(root, 'setup', { step: 2, data: { site: 's' } }, e)
  assert.deepEqual(getProgress(root, 'setup', null, e).data, { where: 'repo', site: 's' })
})
test('a ticket key keeps its own stop, apart from the command without one', () => {
  const e = env()
  setProgress(root, 'spec', { key: 'ABC-1', step: 4 }, e)
  setProgress(root, 'spec', { key: 'ABC-2', step: 2 }, e)
  assert.equal(getProgress(root, 'spec', 'ABC-1', e).step, 4)
  assert.equal(getProgress(root, 'spec', 'ABC-2', e).step, 2)
  assert.equal(getProgress(root, 'spec', null, e).found, false)
})
test('a stop older than 7 days is ignored', () => {
  const e = env()
  const t0 = Date.parse('2026-11-01T10:00:00Z')
  setProgress(root, 'setup', { step: 2 }, e, t0)
  assert.equal(getProgress(root, 'setup', null, e, t0 + MAX_AGE_MS - 1000).found, true)
  const old = getProgress(root, 'setup', null, e, t0 + MAX_AGE_MS + 1000)
  assert.deepEqual([old.found, old.expired], [false, true])
})
test('secrets are refused: a token value, a token field, a private key', () => {
  const e = env()
  for (const data of [{ note: ['ghp', 'x'.repeat(36)].join('_') }, { token: 'x' }, { nested: { password: 'p' } }, { k: '-----BEGIN RSA PRIVATE KEY-----' }]) {
    const r = setProgress(root, 'setup', { step: 1, data }, e)
    assert.equal(r.ok, false, JSON.stringify(data))
    assert.match(r.reason, /secret/)
  }
  assert.equal(getProgress(root, 'setup', null, e).found, false)
})
test('bad input is refused: command, key, step, label, data', () => {
  const e = env()
  assert.equal(setProgress(root, 'nope', { step: 1 }, e).ok, false)
  assert.equal(setProgress(root, 'spec', { key: 'abc', step: 1 }, e).ok, false)
  assert.equal(setProgress(root, 'setup', { step: -1 }, e).ok, false)
  assert.equal(setProgress(root, 'setup', { step: 1, label: 'a\nb' }, e).ok, false)
  assert.equal(setProgress(root, 'setup', { step: 1, data: [] }, e).ok, false)
  assert.equal(setProgress(root, 'setup', { step: 1, data: { big: 'x'.repeat(20000) } }, e).ok, false)
})
test('clear forgets the stop; list shows what is saved, newest first', () => {
  const e = env()
  const t = Date.now()
  setProgress(root, 'setup', { step: 1, label: 'where' }, e, t - 60000)
  setProgress(root, 'spec', { key: 'ABC-1', step: 5, label: 'plan' }, e, t)
  assert.deepEqual(listProgress(root, e, t).map(i => [i.command, i.key, i.step]), [['spec', 'ABC-1', 5], ['setup', null, 1]])
  assert.deepEqual(clearProgress(root, 'setup', null, e), { ok: true, cleared: true })
  assert.deepEqual(clearProgress(root, 'setup', null, e), { ok: true, cleared: false })
  assert.equal(listProgress(root, e, t).length, 1)
})
test('the script: set, get, list, clear and the usage errors', async () => {
  const e = env()
  const run = async argv => { let o = '', er = ''; const code = await main(argv, { env: e, cwd: root, stdout: s => { o += s }, stderr: s => { er += s } }); return { code, o, er } }
  assert.equal((await run(['set', 'setup', '--step', '2', '--label', 'Jira', '--data', '{"site":"s"}'])).code, 0)
  const g = await run(['get', 'setup'])
  assert.match(g.o, /stopped at step 2 \(Jira\)/)
  assert.equal(JSON.parse(g.o.split('PROGRESS_JSON:')[1]).data.site, 's')
  assert.match((await run(['list'])).o, /setup: step 2, Jira/)
  assert.match((await run(['clear', 'setup'])).o, /forgotten/)
  assert.match((await run(['get', 'setup'])).o, /Nothing saved/)
  for (const bad of [['set', 'setup'], ['set', 'setup', '--step', 'x'], ['set', 'setup', '--step', '1', '--data', '{'], ['get'], ['bogus', 'setup'], ['get', 'setup', '--nope']]) assert.equal((await run(bad)).code, 2, bad.join(' '))
})

test('setup and spec follow the progress guide; the guide names the three calls and the secret rule', async () => {
  const { readFileSync } = await import('node:fs')
  const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  for (const f of ['commands/setup.md', 'commands/spec.md']) assert.match(read(f), /guides\/progress\.md/, f)
  const guide = read('guides/progress.md')
  for (const call of ['progress.mjs" get', 'progress.mjs" set', 'progress.mjs" clear']) assert.ok(guide.includes(call), call)
  assert.match(guide, /Never save a token, key, password or ticket text/)
  assert.match(guide, /1\. Go on from there\n2\. Start over\n3\. Stop/)
})

test('session keeps the language, per project folder', () => {
  const e = env()
  assert.equal(setProgress(root, 'session', { step: 0, label: 'language', data: { language: 'it' } }, e).ok, true)
  assert.equal(getProgress(root, 'session', null, e).data.language, 'it')
  const other = mkdtempSync(join(tmpdir(), 'qc-root-'))
  assert.equal(getProgress(other, 'session', null, e).found, false)
})
test('session language does not expire after 7 days, other commands do', () => {
  const e = env()
  const t0 = Date.parse('2026-11-01T10:00:00Z')
  setProgress(root, 'session', { step: 0, data: { language: 'sq' } }, e, t0)
  setProgress(root, 'setup', { step: 1 }, e, t0)
  const later = t0 + 30 * 24 * 60 * 60 * 1000
  assert.equal(getProgress(root, 'session', null, e, later).data.language, 'sq')
  assert.equal(getProgress(root, 'setup', null, e, later).found, false)
})
test('session accepts only a lowercase two-letter language and nothing else', () => {
  const e = env()
  for (const language of ['IT', 'ita', 'i', '', 5, null]) assert.equal(setProgress(root, 'session', { step: 0, data: { language } }, e).ok, false, String(language))
  const r = setProgress(root, 'session', { step: 0, data: { language: 'it', site: 'x' } }, e)
  assert.equal(r.ok, false)
  assert.match(r.reason, /only language/)
  assert.equal(setProgress(root, 'session', { key: 'ABC-1', step: 0, data: { language: 'it' } }, e).ok, false)
})
test('progress.mjs set and get session from the command line', async () => {
  const e = env()
  const out = []
  const run = argv => main(argv, { env: e, cwd: root, stdout: s => out.push(s), stderr: s => out.push(s) })
  assert.equal(await run(['set', 'session', '--step', '0', '--label', 'language', '--data', '{"language":"it"}']), 0)
  out.length = 0
  assert.equal(await run(['get', 'session']), 0)
  const line = out.join('').split('\n').find(l => l.startsWith('PROGRESS_JSON:'))
  assert.equal(JSON.parse(line.slice('PROGRESS_JSON:'.length)).data.language, 'it')
  assert.equal(await run(['set', 'session', '--step', '0', '--data', '{"language":"Italian"}']), 2)
})
