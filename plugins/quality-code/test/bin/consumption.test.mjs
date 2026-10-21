import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../bin/consumption.mjs'
import { CONFIG, NOW, install } from '../report/helpers.mjs'

const CLI = new URL('../../bin/consumption.mjs', import.meta.url).pathname
async function run(args, f = install(), now = NOW) {
  let out = ''
  let err = ''
  const code = await main(args, { CLAUDE_PROJECT_DIR: f.root, CLAUDE_CONFIG_DIR: f.configDir }, '/', { now, stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}
const json = out => JSON.parse(out.trim().split('\n').at(-1).replace(/^CONSUMPTION_JSON:/, ''))

test('default: last 30 days by command, exit 0, card then the machine line', async () => {
  const r = await run([])
  assert.equal(r.code, 0)
  assert.match(r.out, /^quality-code consumption · last 30 days · my project\n/)
  const j = json(r.out)
  assert.equal(j.by, 'command')
  assert.equal(j.totals.runs, 3)
})

test('--json prints the report only', async () => {
  const r = await run(['--json', '--by', 'day'])
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.out, /CONSUMPTION_JSON|quality-code consumption/)
  assert.equal(JSON.parse(r.out).by, 'day')
})

test('ticket keys follow the project config when there is one', async () => {
  const keys = async f => json((await run(['--by', 'ticket', '--since', '2026-08-01'], f)).out).groups.map(g => g.name).sort()
  assert.deepEqual(await keys(install()), ['ABC-12', 'ABC-34', 'XYZ-7', 'no ticket'])
  assert.deepEqual(await keys(install({ config: CONFIG })), ['ABC-12', 'ABC-34', 'no ticket'])
})

test('usage errors exit 2 with a plain line', async () => {
  for (const args of [['--by', 'week'], ['--since'], ['--since', 'soon'], ['--until', '2026-1-1'], ['--what'], ['extra']]) {
    const r = await run(args)
    assert.equal(r.code, 2, args.join(' '))
    assert.match(r.err, /usage: consumption\.mjs/)
    assert.equal(r.out, '')
  }
})

test('no transcripts: exit 3 and where it looked', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'qc-empty-'))
  const r = await run([], { root: join(empty, 'proj'), configDir: join(empty, 'claude') })
  assert.equal(r.code, 3)
  assert.match(r.out, /No Claude Code transcripts found for .*proj/)
  assert.ok(r.out.includes(join(empty, 'claude', 'projects', '-')))
})

test('the slug guess failing falls back to sessions recorded in the project', async () => {
  const r = await run([], install({ folder: 'cut-name' }))
  assert.equal(r.code, 0)
  assert.equal(json(r.out).totals.runs, 3)
})

test('--prices: an override prices an unknown model; a bad file exits 2', async () => {
  const f = install()
  writeFileSync(join(f.root, 'prices.json'), JSON.stringify({ asOf: '2026-11-01', models: { 'claude-unknown-9': { input: 1, output: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1 } } }))
  const r = await run(['--prices', 'prices.json'], f)
  assert.equal(r.code, 0)
  const j = json(r.out)
  assert.deepEqual(j.unknownModels, [])
  assert.equal(j.prices.asOf, '2026-11-01')
  assert.match(r.out, /as of 2026-11-01 \(with prices\.json\)/)
  const bad = await run(['--prices', 'missing.json'], f)
  assert.equal(bad.code, 2)
  assert.match(bad.err, /file not found/)
})

test('no prompt, answer, argument or tool text ever reaches the output', async () => {
  const f = install()
  const fixtures = readFileSync(join(f.dir, 'sess-a.jsonl'), 'utf8')
  assert.match(fixtures, /SECRET-/, 'the fixtures do carry text')
  for (const args of [[], ['--by', 'ticket'], ['--by', 'day'], ['--by', 'model'], ['--json'], ['--since', '2026-01-01']]) {
    const r = await run(args, f)
    assert.doesNotMatch(r.out + r.err, /SECRET|look at this|spawning|something else/, args.join(' '))
  }
})

test('runs as a script with the documented exit code', () => {
  const empty = mkdtempSync(join(tmpdir(), 'qc-empty-'))
  const r = spawnSync(process.execPath, [CLI], { env: { ...process.env, CLAUDE_PROJECT_DIR: join(empty, 'p'), CLAUDE_CONFIG_DIR: empty }, encoding: 'utf8' })
  assert.equal(r.status, 3)
  const f = install()
  const ok = spawnSync(process.execPath, [CLI, '--since', '2026-10-01', '--until', '2026-10-14'], { env: { ...process.env, CLAUDE_PROJECT_DIR: f.root, CLAUDE_CONFIG_DIR: f.configDir }, encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /^quality-code consumption · 2026-10-01 to 2026-10-14 · my project/)
})
