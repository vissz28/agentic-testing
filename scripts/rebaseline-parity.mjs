#!/usr/bin/env node
// Re-baseline the score parity fixtures after a deliberate change of the rubric (weights, new
// signals). Runs every fixture's ops through the CURRENT core and rewrites
// plugins/quality-code/test/parity/expected/<fixture>.json, keeping the file's format: the
// backend output is written in the old names (warehouse_label), the frontend JIRA_UPDATE_JSON
// without titlePrefix, because parity.test.mjs applies the documented transforms on read.
// Nothing is edited by hand; it prints how many fixtures changed verdict (pass <-> refuse).
//
//   node scripts/rebaseline-parity.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = join(ROOT, 'plugins/quality-code')
const DIR = join(PLUGIN, 'test/parity')
const CLI = join(PLUGIN, 'core/cli.mjs')
const read = p => JSON.parse(readFileSync(p, 'utf8'))
const CONFIGS = { fe: read(join(DIR, 'configs/warehouse-frontend.json')), be: read(join(DIR, 'configs/warehouse-backend.json')) }

/** The inverse of the parity test's renameFeatureKey: feature_label back to warehouse_label. */
function oldNames(value) {
  if (Array.isArray(value)) return value.map(oldNames)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      [k === 'feature_label' ? 'warehouse_label' : k, k === 'key' && v === 'feature_label' ? 'warehouse_label' : oldNames(v)]))
  }
  return value
}

const JSON_LINE = /^([A-Z_]+_JSON):(.*)$/
function toOldFormat(repo, stdout) {
  return stdout.split('\n').map(line => {
    const m = line.match(JSON_LINE)
    if (m) {
      let json = JSON.parse(m[2])
      if (repo === 'be') json = oldNames(json)
      if (repo === 'fe' && m[1] === 'JIRA_UPDATE_JSON') delete json.titlePrefix
      return `${m[1]}:${JSON.stringify(json)}`
    }
    if (line.startsWith('{')) {
      const json = JSON.parse(line)
      return JSON.stringify(repo === 'be' ? oldNames(json) : json)
    }
    return line
  }).join('\n')
}

function runOp(dir, op) {
  const [cmd, ...rest] = op
  const flags = rest.filter(a => a.startsWith('--'))
  const args = rest.filter(a => !a.startsWith('--'))
  const r = spawnSync('node', [CLI, cmd, '--in', '@ticket.json', ...flags, ...args], {
    cwd: '/', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8',
  })
  return { stdout: r.stdout, exit: r.status }
}

function runFixture(repo, ticket, ops) {
  const dir = mkdtempSync(join(tmpdir(), 'rebaseline-'))
  try {
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/quality-code.json'), JSON.stringify(CONFIGS[repo]))
    writeFileSync(join(dir, 'ticket.json'), JSON.stringify(ticket))
    return ops.map(op => {
      const r = runOp(dir, op)
      const result = { op, stdout: toOldFormat(repo, r.stdout), exit: r.exit }
      if (op[0] === 'add') {
        const file = read(join(dir, 'ticket.json'))
        result.fileAfter = repo === 'be' ? oldNames(file) : file
      }
      return result
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const gatesOf = results => results.flatMap(r => r.stdout.split('\n')
  .map(l => l.match(/"gate":"(pass|refuse)"/)?.[1]).filter(Boolean))

let changed = 0
let flipped = 0
const flips = []
for (const name of readdirSync(join(DIR, 'fixtures')).filter(f => f.endsWith('.json')).sort()) {
  const fx = read(join(DIR, 'fixtures', name))
  const old = read(join(DIR, 'expected', name))
  let ticket = fx.ticket
  // Spec §10 #2: the old scorer counted the bare `warehouse` label as the feature label. Its
  // "before" is the same ticket with a real feature label, so the test can still compare the two.
  if (fx.difference === 2) ticket = { ...ticket, labels: [CONFIGS[fx.repo].features[0].label] }
  const results = runFixture(fx.repo, ticket, fx.ops)
  const next = { ...old, results }
  if (JSON.stringify(next) !== JSON.stringify(old)) changed++
  if (JSON.stringify(gatesOf(results)) !== JSON.stringify(gatesOf(old.results))) {
    flipped++
    flips.push(`${name}: ${gatesOf(old.results).join(',')} -> ${gatesOf(results).join(',')}`)
  }
  writeFileSync(join(DIR, 'expected', name), `${JSON.stringify(next, null, 2)}\n`)
}
console.log(`fixtures rewritten: ${changed}; verdict changed: ${flipped}`)
for (const f of flips) console.log(`  ${f}`)
