// Type-check step: the project's own tsc, --noEmit, with the tsconfig of the vitest or playwright block
// plus the specs, so a spec its include leaves out is still checked. Only an error in a spec fails.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, relative } from 'node:path'
import { result } from './result.mjs'
import { adapterOptions, timeoutSecondsOf } from '../config/config.mjs'
import { matches } from './boundary.mjs'
import { stripCodeComments } from './checks/expected.mjs'
import { kill, toolScript, track } from './runners/tool.mjs'
import { runnerOf } from '../base/runners.mjs'
import { toForwardSlashes, plural } from '../core/text.mjs'

const CYPRESS_TSCONFIG = 'cypress/tsconfig.json'
const TS = /\.(ts|tsx|mts|cts)$/
const CAP = 1 << 20

/**
 * The tsconfig tsc runs on: the project's own (its options, include and exclude are inherited) with the
 * specs added. Written next to it, so its relative paths resolve the same. The specs are relative too: an
 * absolute path under a symlinked root makes tsc load a spec twice, the second under a ../ path. composite
 * is off: it would refuse a spec its include does not list.
 * ponytail: a base with no include and no files (tsc's default: every file) then only gets the specs and what they import.
 */
export function scopedTsconfig(tsconfig, specs) {
  return { extends: `./${basename(tsconfig)}`, compilerOptions: { composite: false }, files: specs.map(s => relative(dirname(tsconfig), s)) }
}

const readTsconfig = (root, p) => {
  // ponytail: comments and trailing commas only; a "," before "]" inside a string value would be dropped.
  try { return JSON.parse(stripCodeComments(readFileSync(join(root, p), 'utf8')).replace(/,(\s*[}\]])/g, '$1')) } catch { return null }
}
// A tsconfig include entry: a glob, or a file or a folder (everything under it).
const covers = (entry, path) => matches(entry, path) || (!entry.includes('*') && matches(`${entry.replace(/\/+$/, '')}/`, path))

/**
 * The tsconfig to extend. A solution-style one (no files of its own, only references, as in the Vite
 * templates) checks nothing and has no compiler options: the referenced one whose include covers the
 * most specs is the one the project's own build checks them with.
 */
export function ownTsconfig(root, tsconfig, specs) {
  const base = readTsconfig(root, tsconfig)
  if (!base?.references?.length || !(base.files?.length === 0 || base.include?.length === 0)) return tsconfig
  let best = tsconfig
  let most = 0
  for (const r of base.references) {
    let p = posix.join(posix.dirname(toForwardSlashes(tsconfig)), toForwardSlashes(String(r?.path ?? '')))
    if (!p.endsWith('.json')) p = posix.join(p, 'tsconfig.json')
    const include = readTsconfig(root, p)?.include ?? ['**/*']
    const n = specs.filter(s => {
      const rel = posix.relative(posix.dirname(p), toForwardSlashes(s))
      return !rel.startsWith('../') && include.some(e => covers(String(e).replace(/^\.\//, ''), rel))
    }).length
    if (n > most) { best = p; most = n }
  }
  return best
}

/** tsc's output, graded for the specs alone: errors elsewhere in the project are not the specs' to fix. */
export function readTsc(out, code, specs, truncated = false) {
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
  const errors = lines.filter(l => /error TS\d+/.test(l))
  const inSpec = errors.filter(l => specs.some(s => l.startsWith(`${s}(`)))
  if (inSpec.length) return result('types', 'fail', inSpec[0], inSpec.map(l => ({ file: l.slice(0, l.indexOf('(')), kind: 'compile error', detail: l })), { applicable: true })
  // An error with no file, or in a tsconfig: tsc stopped before it checked anything, which is not a pass.
  const config = errors.find(l => /^error TS/.test(l) || /^[^(]*\.json\(\d+,\d+\): error TS/.test(l))
  if (config) return result('types', 'not_run', `tsc could not check the specs: ${config}`)
  if (truncated) return result('types', 'not_run', 'the tsc output was too long to read')
  if (code === 0) return result('types', 'pass', 'compiles', [], { applicable: true })
  if (!errors.length) return result('types', 'not_run', `tsc exited with ${code}: ${lines[0] ?? 'no output'}`)
  return result('types', 'pass', `compiles; ${errors.length} error(s) in other files, not in the specs`, [], { applicable: true, otherErrors: errors.length })
}

/** The nearest tsconfig.json above a spec, up to the project root (a workspace's own); null when none. */
export function nearestTsconfig(root, spec) {
  let dir = posix.dirname(toForwardSlashes(spec))
  for (;;) {
    const p = dir === '.' ? 'tsconfig.json' : `${dir}/tsconfig.json`
    if (existsSync(join(root, p))) return p
    if (dir === '.' || dir === '/' || dir === '') return null
    dir = posix.dirname(dir)
  }
}

const WORST = { fail: 2, not_run: 1, pass: 0 }

/**
 * The type-check. With a tsconfig named in the config (vitest.tsconfig, playwright.tsconfig) or one at the root, every spec goes to it.
 * With neither, each spec goes to the nearest tsconfig.json above it, so a monorepo with no tsconfig at its root is checked workspace by workspace.
 */
export async function typeCheck(root, config, specs, opts = {}) {
  const cypress = runnerOf(config) === 'cypress' && existsSync(join(root, CYPRESS_TSCONFIG))
  if (adapterOptions(config).tsconfig || cypress || existsSync(join(root, 'tsconfig.json'))) return typeCheckOne(root, config, specs, opts)
  const tsSpecs = specs.filter(s => TS.test(s))
  const groups = new Map()
  for (const s of tsSpecs) {
    const t = nearestTsconfig(root, s)
    if (t) groups.set(t, [...(groups.get(t) ?? []), s])
  }
  if (!groups.size) return typeCheckOne(root, config, specs, opts)
  const results = []
  for (const [tsconfig, list] of groups) results.push(await typeCheckOne(root, config, list, opts, tsconfig))
  const without = tsSpecs.length - [...groups.values()].reduce((n, l) => n + l.length, 0)
  const status = results.map(r => r.status).reduce((a, b) => (WORST[b] > WORST[a] ? b : a))
  const worst = results.find(r => r.status === status)
  const note = without ? `; ${without} spec(s) have no tsconfig.json above them and were not type-checked` : ''
  const summary = status === 'pass' ? `compiles (${plural(groups.size, 'tsconfig')}, one per workspace)${note}` : `${worst.summary}${note}`
  return result('types', status, summary, results.flatMap(r => r.findings ?? []), { applicable: results.some(r => r.data?.applicable !== false), tsconfigs: [...groups.keys()] })
}

function typeCheckOne(root, config, specs, { timeoutMs = timeoutSecondsOf(config) * 1000 } = {}, forced = null) {
  // Cypress keeps the types its specs need (cy, its chainers) in cypress/tsconfig.json.
  const cypress = runnerOf(config) === 'cypress' && existsSync(join(root, CYPRESS_TSCONFIG))
  const configured = forced ?? adapterOptions(config).tsconfig ?? (cypress ? CYPRESS_TSCONFIG : 'tsconfig.json')
  const tsSpecs = specs.filter(s => TS.test(s))
  if (!tsSpecs.length) return Promise.resolve(result('types', 'pass', 'no TypeScript specs: nothing to type-check', [], { applicable: false }))
  if (!existsSync(join(root, configured))) return Promise.resolve(result('types', 'not_run', `no ${configured}: cannot type-check the TypeScript specs`))
  const bin = toolScript(root, ['typescript'], 'tsc')
  if (!bin) return Promise.resolve(result('types', 'not_run', 'TypeScript is not installed in this project'))
  const tsconfig = ownTsconfig(root, configured, tsSpecs)
  return new Promise(done => {
    const tmp = mkdtempSync(join(tmpdir(), 'qc-tsc-'))
    // mut-tmp-*: the name setup already git-ignores, so a killed run leaves nothing to commit.
    const scoped = join(dirname(tsconfig), `mut-tmp-qc-tsconfig-${randomBytes(4).toString('hex')}.json`)
    let out = ''
    let truncated = false
    let timedOut = false
    let settled = false
    let timer = null
    let untrack = () => {}
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      untrack()
      try {
        rmSync(tmp, { recursive: true, force: true })
        rmSync(join(root, scoped), { force: true })
      } finally { done(r) }
    }
    let child
    try {
      writeFileSync(join(root, scoped), JSON.stringify(scopedTsconfig(tsconfig, tsSpecs)))
      child = spawn(process.execPath, [bin, '--noEmit', '-p', scoped, '--incremental', '--tsBuildInfoFile', join(tmp, 'qc.tsbuildinfo'), '--pretty', 'false'], { cwd: root, detached: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
      untrack = track(child, [tmp, join(root, scoped)])
    } catch (e) {
      return finish(result('types', 'not_run', `could not start tsc: ${e.message}`))
    }
    const keep = d => { if (out.length < CAP) out += d; else truncated = true }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish(result('types', 'not_run', `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}`))
    }, timeoutMs)
    child.on('error', e => finish(result('types', 'not_run', `could not start tsc: ${e.message}`)))
    child.on('close', code => {
      if (timedOut) return
      try {
        finish(readTsc(out, code, tsSpecs, truncated))
      } catch (e) {
        finish(result('types', 'not_run', `could not read the tsc output: ${e.message}`))
      }
    })
  })
}
