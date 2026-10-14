#!/usr/bin/env node
// Run every parity fixture through today's warehouse scorers and record what they print.
// Needs the two warehouse repos next to this one (or WAREHOUSE_FE / WAREHOUSE_BE); CI does not:
// the captured files under plugins/quality-code/test/parity/expected/ are committed.
//
//   node scripts/capture-parity.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PARITY = join(ROOT, 'plugins/quality-code/test/parity')
const SOURCES = {
  fe: {
    repo: process.env.WAREHOUSE_FE || resolve(ROOT, '../warehouse-frontend'),
    ref: 'origin/agentic-testing-fe',
    files: ['score-ticket.mjs'],
  },
  be: {
    repo: process.env.WAREHOUSE_BE || resolve(ROOT, '../warehouse-backend'),
    ref: 'origin/agt-34-remove-audit-logs',
    // the scorer imports ./expected-check.mjs; the sanitizer is kept for reference
    files: ['score-ticket.mjs', 'expected-check.mjs', 'sanitize-ticket.mjs'],
  },
}

// Today's backend names the feature-label key warehouse_label (spec §10 #5): fixtures use the new
// name, so translate it back when calling the old script.
const oldKey = (repo, key) => (repo === 'be' && key === 'feature_label' ? 'warehouse_label' : key)

/** The old flag form of one op. */
export function oldArgs(repo, op) {
  const [cmd, ...rest] = op
  switch (cmd) {
    case 'score': return rest
    case 'refuse-comment': return ['--refuse-comment']
    case 'fill-menu': return ['--fill-menu']
    case 'pick': return ['--pick', rest[0]]
    case 'add': return ['--add', oldKey(repo, rest[0]), rest[1]]
    case 'jira-update': return ['--jira-update']
    default: throw new Error(`unknown op ${cmd}`)
  }
}

/**
 * Today's backend sanitizer on every raw input of test/parity/sanitize-inputs.mjs. The inputs are
 * built at runtime and outputs are masked, so no customer id or e-mail is written (Ruling R11).
 */
async function captureSanitize(tmp, commit, expectedDir) {
  const { sanitizeInputs, mask } = await import(pathToFileURL(join(PARITY, 'sanitize-inputs.mjs')).href)
  const results = sanitizeInputs().map(({ name, raw }) => {
    const work = mkdtempSync(join(tmp, 'sanitize-'))
    writeFileSync(join(work, 'raw.json'), JSON.stringify(raw))
    const r = spawnSync('node', [join(tmp, 'be', 'sanitize-ticket.mjs'), '--in', `@${join(work, 'raw.json')}`, '--out', join(work, 'ticket.json')], { cwd: work, encoding: 'utf8' })
    if (r.error) throw r.error
    const out = r.status === 0 ? JSON.parse(mask(readFileSync(join(work, 'ticket.json'), 'utf8'))) : null
    return { name, stdout: mask(r.stdout), exit: r.status, out }
  })
  const file = { source: { ref: SOURCES.be.ref, commit, script: 'sanitize-ticket.mjs' }, results }
  writeFileSync(join(expectedDir, 'sanitize.json'), `${JSON.stringify(file, null, 2)}\n`)
  return results.length
}

function extract(tmp) {
  const commits = {}
  for (const [name, s] of Object.entries(SOURCES)) {
    const dir = join(tmp, name)
    mkdirSync(dir, { recursive: true })
    for (const f of s.files) {
      const src = execFileSync('git', ['-C', s.repo, 'show', `${s.ref}:.claude/harness/${f}`], { encoding: 'utf8' })
      writeFileSync(join(dir, f), src)
    }
    commits[name] = execFileSync('git', ['-C', s.repo, 'rev-parse', s.ref], { encoding: 'utf8' }).trim()
  }
  return commits
}

async function main() {
  // Real path: the old sanitizer runs main() only when argv[1] equals its own resolved path, and
  // the macOS temp dir is a symlink.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'parity-capture-')))
  try {
    const commits = extract(tmp)
    const expectedDir = join(PARITY, 'expected')
    mkdirSync(expectedDir, { recursive: true })
    for (const f of readdirSync(expectedDir)) if (f.endsWith('.json')) rmSync(join(expectedDir, f))
    const fixtures = readdirSync(join(PARITY, 'fixtures')).filter(f => f.endsWith('.json')).sort()
    let ops = 0
    for (const f of fixtures) {
      const fx = JSON.parse(readFileSync(join(PARITY, 'fixtures', f), 'utf8'))
      const work = mkdtempSync(join(tmp, 'run-'))
      const ticketPath = join(work, 'ticket.json')
      writeFileSync(ticketPath, JSON.stringify(fx.ticket))
      const results = fx.ops.map(op => {
        const r = spawnSync('node', [join(tmp, fx.repo, 'score-ticket.mjs'), '--in', `@${ticketPath}`, ...oldArgs(fx.repo, op), '--no-audit'], { cwd: work, encoding: 'utf8' })
        if (r.error) throw r.error
        ops++
        const res = { op, stdout: r.stdout, exit: r.status }
        if (op[0] === 'add') res.fileAfter = JSON.parse(readFileSync(ticketPath, 'utf8'))
        return res
      })
      const out = { fixture: f, repo: fx.repo, source: { ref: SOURCES[fx.repo].ref, commit: commits[fx.repo] }, results }
      writeFileSync(join(expectedDir, f), `${JSON.stringify(out, null, 2)}\n`)
    }
    console.log(`captured ${fixtures.length} fixtures, ${ops} ops`)
    console.log(`captured ${await captureSanitize(tmp, commits.be, expectedDir)} sanitize inputs`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
