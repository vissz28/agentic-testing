// Parity: warehouse's two configs make the core print exactly what today's two scorers print.
// expected/ is captured from today's scripts by scripts/capture-parity.mjs (repo root). The only
// transforms applied to it are the documented differences of spec §10:
//   #5  the backend key warehouse_label is named feature_label (property names and `key` values)
//   #6  the frontend JIRA_UPDATE_JSON also carries titlePrefix: null
//   #2  a bare `warehouse` label no longer counts (its own fixture, asserted to differ)
// JSON lines (and the --json output) are compared as parsed objects (Ruling R2); every other line
// must be identical, as must the exit code and, for `add`, the ticket file afterwards.
// Sanitize: today's backend sanitizer and `cli.mjs sanitize` under the backend config write the
// same JSON for every raw input of parity/sanitize-inputs.mjs (both sides masked the same way).
// One hand edit, spec §10 #8 (harvested free text is redacted): in expected/sanitize.json the
// untouched-fields scenario `then` reads "shows U######" where today's script kept the id.
// One more, spec §10 #10 (plain criteria that start with a Gherkin keyword count as plain
// criteria): in expected/be--be-mixed-vague-then.json and be--fe-mixed-vague-then.json, op 14
// (`score`) counts 5 and 4 assertable chunks (was 3), because the Given / When lines left once the
// vague Then is replaced are no longer real Gherkin.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mask, sanitizeInputs } from './parity/sanitize-inputs.mjs'

const CLI = new URL('../core/cli.mjs', import.meta.url).pathname
const DIR = new URL('./parity/', import.meta.url).pathname
const read = p => JSON.parse(readFileSync(p, 'utf8'))
const CONFIGS = { fe: read(join(DIR, 'configs/warehouse-frontend.json')), be: read(join(DIR, 'configs/warehouse-backend.json')) }
const FIXTURES = readdirSync(join(DIR, 'fixtures')).filter(f => f.endsWith('.json')).sort()
  .map(f => ({ name: f, ...read(join(DIR, 'fixtures', f)), expected: read(join(DIR, 'expected', f)) }))

function run(dir, argv) {
  return new Promise((done, fail) => {
    const p = spawn('node', [CLI, ...argv], { cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', d => { stdout += d })
    p.stderr.on('data', d => { stderr += d })
    p.on('error', fail)
    p.on('close', exit => done({ stdout, stderr, exit }))
  })
}

/** The new CLI form of one op: `<cmd> --in @ticket.json [args]`. */
export function newArgs(op) {
  const [cmd, ...rest] = op
  const flags = rest.filter(a => a.startsWith('--'))
  const args = rest.filter(a => !a.startsWith('--'))
  return [cmd, '--in', '@ticket.json', ...flags, ...args]
}

/** Spec §10 #5: rename warehouse_label to feature_label in property names and `key` values. */
export function renameFeatureKey(value) {
  if (Array.isArray(value)) return value.map(renameFeatureKey)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const name = k === 'warehouse_label' ? 'feature_label' : k
      out[name] = k === 'key' && v === 'warehouse_label' ? 'feature_label' : renameFeatureKey(v)
    }
    return out
  }
  return value
}

const JSON_LINE = /^([A-Z_]+_JSON):(.*)$/

/** One stdout line as compared: JSON lines parsed, the rest as text. */
function parseLine(line, isJsonOp) {
  const m = line.match(JSON_LINE)
  if (m) return { prefix: m[1], json: JSON.parse(m[2]) }
  if (isJsonOp && line.startsWith('{')) return { prefix: '--json', json: JSON.parse(line) }
  return { text: line }
}

/** Expected output after the documented transforms, and only those. */
export function transform(repo, line) {
  if (!('json' in line)) return line
  let json = line.json
  if (repo === 'be') json = renameFeatureKey(json)
  if (repo === 'fe' && line.prefix === 'JIRA_UPDATE_JSON') json = { ...json, titlePrefix: null }
  return { ...line, json }
}

/** Every difference between one expected op result and the actual one, as readable strings. */
export function diffOp(repo, op, want, got) {
  const out = []
  if (want.exit !== got.exit) out.push(`exit ${want.exit} → ${got.exit}`)
  const isJsonOp = op.includes('--json')
  const w = want.stdout.split('\n').map(l => transform(repo, parseLine(l, isJsonOp)))
  const g = got.stdout.split('\n').map(l => parseLine(l, isJsonOp))
  if (w.length !== g.length) out.push(`line count ${w.length} → ${g.length}`)
  for (let i = 0; i < Math.max(w.length, g.length); i++) {
    try { assert.deepStrictEqual(g[i], w[i]) } catch {
      out.push(`line ${i + 1}:\n    want ${JSON.stringify(w[i])}\n    got  ${JSON.stringify(g[i])}`)
    }
  }
  if ('fileAfter' in want) {
    const wf = repo === 'be' ? renameFeatureKey(want.fileAfter) : want.fileAfter
    try { assert.deepStrictEqual(got.fileAfter, wf) } catch {
      out.push(`file after:\n    want ${JSON.stringify(wf)}\n    got  ${JSON.stringify(got.fileAfter)}`)
    }
  }
  return out
}

/** Run a fixture's ops in order on one ticket file, in a temp project with the repo's config. */
async function runFixture(fx) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'))
  try {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/agentic-testing.json'), JSON.stringify(CONFIGS[fx.repo]))
    writeFileSync(join(dir, 'ticket.json'), JSON.stringify(fx.ticket))
    const results = []
    for (const op of fx.ops) {
      const r = await run(dir, newArgs(op))
      if (op[0] === 'add') r.fileAfter = read(join(dir, 'ticket.json'))
      results.push(r)
    }
    return results
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parity with today\'s warehouse scorers', { concurrency: 8 }, () => {
  for (const fx of FIXTURES.filter(f => !f.difference)) {
    test(fx.name, async () => {
      assert.deepEqual(fx.expected.results.map(r => r.op), fx.ops, 'expected/ was captured from these ops')
      const got = await runFixture(fx)
      const diffs = fx.ops.flatMap((op, i) =>
        diffOp(fx.repo, op, fx.expected.results[i], got[i]).map(d => `[${i}] ${JSON.stringify(op)} ${d}`))
      assert.equal(diffs.length, 0, `${fx.name}\n${diffs.join('\n')}`)
    })
  }
})

const briefOf = (stdout, prefix = 'TICKET_EVAL_JSON:') => JSON.parse(stdout.split('\n').find(l => l.startsWith(prefix)).slice(prefix.length))

test('spec §10 #2: a bare warehouse label no longer counts as a feature label (backend)', async () => {
  const fx = FIXTURES.find(f => f.difference === 2)
  assert.ok(fx && fx.ticket.labels.includes('warehouse'), 'the fixture carries a bare warehouse label')
  const [got] = await runFixture(fx)
  const before = briefOf(fx.expected.results[0].stdout)
  const after = briefOf(got.stdout)
  assert.equal(before.signals.warehouse_label, true)
  assert.equal(after.signals.feature_label, false)
  assert.equal(after.score, before.score - 5)
  assert.ok(after.missing.some(m => m.key === 'feature_label'))
  const { score: _a, gate: _b, missing: _c, signals: sa, ...restAfter } = after
  const { score: _d, gate: _e, missing: _f, signals: sb, ...restBefore } = renameFeatureKey(before)
  assert.deepEqual(restAfter, restBefore, 'nothing else in the brief changes')
  assert.deepEqual({ ...sa, feature_label: true }, sb)
})

test('spec §10 #5: the backend output really names the key warehouse_label today', () => {
  const be = FIXTURES.filter(f => f.repo === 'be').flatMap(f => f.expected.results)
  assert.ok(be.some(r => r.stdout.includes('"warehouse_label"')))
  assert.ok(!be.some(r => r.stdout.includes('"feature_label"')))
})

test('spec §10 #6: the frontend JIRA_UPDATE_JSON has no titlePrefix today', () => {
  const lines = FIXTURES.filter(f => f.repo === 'fe').flatMap(f => f.expected.results)
    .filter(r => r.op[0] === 'jira-update').map(r => briefOf(r.stdout, 'JIRA_UPDATE_JSON:'))
  assert.ok(lines.length > 0)
  assert.ok(lines.every(u => !('titlePrefix' in u)))
})

test('every fixture has captured output for each op', () => {
  for (const fx of FIXTURES) assert.equal(fx.expected.results.length, fx.ops.length, fx.name)
})

describe('sanitize parity with today\'s backend sanitizer', { concurrency: 8 }, () => {
  const expected = read(join(DIR, 'expected/sanitize.json')).results
  const inputs = sanitizeInputs()
  test('expected/sanitize.json was captured from these inputs', () => {
    assert.deepEqual(expected.map(r => r.name), inputs.map(i => i.name))
  })
  for (const { name, raw } of inputs) {
    test(`sanitize: ${name}`, async () => {
      const want = expected.find(r => r.name === name)
      const dir = mkdtempSync(join(tmpdir(), 'parity-sanitize-'))
      try {
        mkdirSync(join(dir, '.claude'))
        writeFileSync(join(dir, '.claude/agentic-testing.json'), JSON.stringify(CONFIGS.be))
        writeFileSync(join(dir, 'raw.json'), JSON.stringify(raw))
        const got = await run(dir, ['sanitize', '--in', '@raw.json', '--out', 'ticket.json'])
        assert.equal(got.exit, want.exit)
        assert.equal(mask(got.stdout), want.stdout)
        assert.deepEqual(JSON.parse(mask(readFileSync(join(dir, 'ticket.json'), 'utf8'))), want.out)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
