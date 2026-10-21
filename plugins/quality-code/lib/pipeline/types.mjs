// Type-check step: the project's own tsc, --noEmit, with the tsconfig of the vitest or playwright block
// plus the specs, so a spec its include leaves out is still checked. Only an error in a spec fails.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, relative } from 'node:path'
import { result } from '../base/result.mjs'
import { adapterOptions, timeoutSecondsOf } from '../base/config.mjs'
import { matches } from '../base/boundary.mjs'
import { stripCodeComments } from './checks/expected.mjs'
import { kill, toolScript, track } from './runners/tool.mjs'

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
  const slash = p => p.replace(/\\/g, '/')
  let best = tsconfig
  let most = 0
  for (const r of base.references) {
    let p = posix.join(posix.dirname(slash(tsconfig)), slash(String(r?.path ?? '')))
    if (!p.endsWith('.json')) p = posix.join(p, 'tsconfig.json')
    const include = readTsconfig(root, p)?.include ?? ['**/*']
    const n = specs.filter(s => {
      const rel = posix.relative(posix.dirname(p), slash(s))
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

export function typeCheck(root, config, specs, { timeoutMs = timeoutSecondsOf(config) * 1000 } = {}) {
  const configured = adapterOptions(config).tsconfig ?? 'tsconfig.json'
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
