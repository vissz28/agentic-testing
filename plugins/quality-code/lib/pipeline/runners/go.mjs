// The Go runner: runs the specs' packages with `go test -json` and reads its event stream.
// Implements the runner contract of the shared checks. Never writes into the project: go keeps its
// build cache outside the repo, and a {report} file of go.command goes to a temp folder.
//
// One result per scenario, as the dialect (dialects/go.mjs) titles them: a direct t.Run with a
// literal name, else the test function itself (a table-driven test's cases fold into it). path[0] is
// the function's doc comment (where the ticket key is), else its name.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { commandOf, timeoutSecondsOf } from '../../base/config.mjs'
import { goName, scan } from '../../base/dialects/go.mjs'
import { findUp, kill, track } from './tool.mjs'

const LABEL = 'Go'
const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const slash = p => p.split(sep).join('/')
/** A literal for Go's regexp (RE2): the same metacharacters as JavaScript's. */
export const reEscape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The module of a package folder: { root, path } from the nearest go.mod, or null. */
export function moduleOf(dirAbs) {
  const mod = findUp(dirAbs, 'go.mod')
  if (!mod) return null
  const path = /^\s*module\s+("?)([^\s"]+)\1/m.exec(readFileSync(mod, 'utf8'))?.[2]
  return path ? { root: dirname(mod), path } : null
}

/**
 * What the specs hold, per package: { importPath, dir, cwd, pattern, funcs: Map name →
 * { file, group, literal: Map goName → title } }. Only the requested files' functions: another
 * file's tests in the same package are not this run's.
 */
export function indexSpecs(root, files) {
  const pkgs = new Map()
  for (const file of files) {
    const dirAbs = resolve(root, dirname(file))
    let pkg = pkgs.get(dirAbs)
    if (!pkg) {
      const mod = moduleOf(dirAbs)
      if (!mod) return { error: `no go.mod above ${slash(dirname(file)) || '.'}` }
      const rel = slash(relative(mod.root, dirAbs))
      pkg = { importPath: rel ? `${mod.path}/${rel}` : mod.path, dir: dirAbs, cwd: mod.root, pattern: rel ? `./${rel}` : '.', files: [], funcs: new Map() }
      pkgs.set(dirAbs, pkg)
    }
    pkg.files.push(file)
    let src = ''
    try { src = readFileSync(resolve(root, file), 'utf8') } catch {}
    for (const f of scan(src)) {
      pkg.funcs.set(f.name, { file, group: f.group, literal: new Map(f.subtests.map(s => [goName(s.title), s.title])) })
    }
  }
  return { pkgs: [...pkgs.values()] }
}

/** The -run regex: every requested function, or the one scenario testName names (a function or a literal subtest). */
export function runPattern(pkgs, testName) {
  const all = pkgs.flatMap(p => [...p.funcs.entries()])
  if (testName === undefined) {
    const names = [...new Set(all.map(([n]) => n))]
    return names.length ? `^(${names.map(reEscape).join('|')})$` : null
  }
  if (all.some(([n]) => n === testName)) return `^${reEscape(testName)}$`
  const owners = [...new Set(all.filter(([, f]) => [...f.literal.values()].includes(testName)).map(([n]) => n))]
  if (!owners.length) return null
  // A "/" in a name is a level of its own for go test: each level gets its own anchored pattern.
  return [`^(${owners.map(reEscape).join('|')})$`, ...goName(testName).split('/').map(p => `^${reEscape(p)}$`)].join('/')
}

/** The JSON events of a `go test -json` stream; other lines are left out. */
export function parseEvents(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('{')) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

const COMPILE = /^\S+\.go:\d+(?::\d+)?: .+/

/** The first compiler (or vet) error line of a build's output, else its first line that says something. */
export function compileError(lines) {
  const ls = lines.join('').split('\n').map(l => l.trim())
  return ls.find(l => COMPILE.test(l)) ?? ls.find(l => l && !l.startsWith('#') && !/^(FAIL|ok)\s/.test(l)) ?? 'the package does not build'
}

/** Why a test failed: its first file.go:NN: line (testify's Error, expected and actual with it), or the panic. */
export function failureLine(lines) {
  const ls = lines.join('').split('\n')
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i].trim()
    const m = /^(\S+\.go:\d+):\s*(.*)$/.exec(l)
    if (m) {
      if (m[2]) return `${m[1]}: ${m[2]}`
      const rest = ls.slice(i + 1, i + 12).map(x => x.trim())
      const err = rest.find(x => /^Error:/.test(x))?.replace(/^Error:\s*/, '')
      const exp = rest.find(x => /^expected\s*:/.test(x))
      const act = rest.find(x => /^actual\s*:/.test(x))
      return [`${m[1]}:`, err, exp, act].filter(Boolean).join(' ').replace(/\s+/g, ' ')
    }
    if (/^panic: /.test(l)) return l.replace(/ \[recovered\]$/, '')
  }
  return ls.map(x => x.trim()).find(x => x && !/^(=== |--- |FAIL\b|PASS\b|ok\s)/.test(x)) ?? ''
}

/** The events grouped per package: { tests: Map name → { status, output }, output, status, failedBuild }, and build output per import path. */
export function collect(events) {
  const pkgs = new Map()
  const builds = new Map()
  const pkgOf = name => {
    if (!pkgs.has(name)) pkgs.set(name, { tests: new Map(), output: [], status: null, failedBuild: null })
    return pkgs.get(name)
  }
  for (const e of events) {
    // Go 1.24+: the build's own events, keyed by "<import path> [<import path>.test]".
    if (e.Action === 'build-output' || e.Action === 'build-fail') {
      const ip = String(e.ImportPath ?? '').split(' ')[0]
      if (!builds.has(ip)) builds.set(ip, [])
      if (e.Output) builds.get(ip).push(e.Output)
      continue
    }
    if (!e.Package) continue
    const p = pkgOf(e.Package)
    if (e.Test) {
      if (!p.tests.has(e.Test)) p.tests.set(e.Test, { status: null, output: [] })
      const t = p.tests.get(e.Test)
      if (e.Action === 'output') t.output.push(e.Output ?? '')
      else if (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip') t.status = e.Action
    } else if (e.Action === 'output') p.output.push(e.Output ?? '')
    else if (e.Action === 'pass' || e.Action === 'fail' || e.Action === 'skip') {
      p.status = e.Action
      if (e.FailedBuild) p.failedBuild = String(e.FailedBuild).split(' ')[0]
    }
  }
  return { pkgs, builds }
}

const STATUS = { pass: 'passed', fail: 'failed', skip: 'skipped' }

/**
 * The results of one run for the indexed packages: { tests, broken }. stderr holds what an older go
 * (before 1.24) prints of a failed build.
 */
export function results(events, pkgs, stderr = '') {
  const { pkgs: seen, builds } = collect(events)
  const tests = []
  const broken = []
  for (const pkg of pkgs) {
    const p = seen.get(pkg.importPath)
    if (!p) continue
    const own = new Set(pkg.files)
    const pkgOut = p.output.join('')
    const buildFailed = Boolean(p.failedBuild) || /\[(?:build|setup) failed\]/.test(pkgOut)
    if (buildFailed) {
      const lines = builds.get(p.failedBuild ?? pkg.importPath) ?? [...builds.values()].flat()
      const message = compileError(lines.length ? lines : [stderr, pkgOut])
      for (const file of own) broken.push({ file, message })
      continue
    }
    let anyFailed = false
    for (const [name, f] of pkg.funcs) {
      const top = p.tests.get(name)
      if (!top) continue
      const kids = [...p.tests].filter(([n]) => n.startsWith(`${name}/`))
      const outputOf = prefix => kids.filter(([n]) => n === prefix || n.startsWith(`${prefix}/`)).flatMap(([, t]) => t.output)
      const result = (title, t, output) => {
        // A test that started and never ended: a panic elsewhere stopped the package.
        const status = STATUS[t.status] ?? (p.status === 'fail' ? 'failed' : 'skipped')
        if (status === 'failed') anyFailed = true
        return { title, path: [f.group], file: f.file, status, message: status === 'failed' ? failureLine(output) || failureLine([pkgOut]) : '' }
      }
      const out = []
      if (f.literal.size) {
        for (const [n, t] of kids) {
          const title = f.literal.get(n.slice(name.length + 1))
          if (title !== undefined) out.push(result(title, t, outputOf(n)))
        }
      }
      // No literal scenario ran (a plain or table-driven test, or a skip before them), or the function failed outside them.
      if (!out.length || (top.status === 'fail' && !out.some(r => r.status === 'failed'))) out.push(result(name, top, [...top.output, ...outputOf(name)]))
      tests.push(...out.filter(r => own.has(r.file)))
    }
    // The package failed with no test failing: TestMain, an init panic, a timeout.
    if (p.status === 'fail' && !anyFailed) for (const file of own) broken.push({ file, message: failureLine([pkgOut]) || 'the test binary failed outside the tests' })
  }
  return { tests, broken }
}

const quote = s => (process.platform === 'win32' ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`)

/**
 * The command for one module: go test -json, or go.command with {files} (the package patterns),
 * {test} (the -run regex) and {report} (a file for the JSON stream, else it is read from stdout).
 * A command with no placeholder gets the flags and packages appended.
 */
export function commandFor(config, patterns, run, report) {
  const flags = ['-json', '-count=1', ...(run ? ['-run', run] : [])]
  const custom = commandOf(config)
  if (!custom) return { file: 'go', args: ['test', ...flags, ...patterns], shell: false }
  if (!/\{(?:files|test|report)\}/.test(custom)) return { line: `${custom} ${[...flags, ...patterns].map(quote).join(' ')}`, shell: true }
  return {
    // Functions as replacements: a "$" in the -run regex is no replacement pattern.
    line: custom.replace(/\{files\}/g, () => patterns.map(quote).join(' ')).replace(/\{test\}/g, () => quote(run ?? '.')).replace(/\{report\}/g, () => quote(report)),
    shell: true,
    report: /\{report\}/.test(custom),
  }
}

function runGo(cwd, cmd, report, timeoutMs, dir) {
  return new Promise(done => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer = null
    let untrack = () => {}
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      untrack()
      done(r)
    }
    let child
    try {
      const opts = { cwd, detached: true, windowsHide: true, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] }
      child = cmd.shell ? spawn(cmd.line, { ...opts, shell: true }) : spawn(cmd.file, cmd.args, opts)
      untrack = track(child, [dir])
    } catch (e) {
      return finish({ ran: false, error: `could not start ${LABEL}: ${e.message}` })
    }
    // The stream can be long (one event per output line); stderr only needs its first lines.
    child.stdout.on('data', d => { if (stdout.length < 64 * 1024 * 1024) stdout += d })
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: e.code === 'ENOENT' ? `${LABEL} is not installed (no go command on the PATH)` : `could not start ${LABEL}: ${e.message}` }))
    child.on('close', code => {
      if (timedOut) return
      let text = stdout
      if (cmd.report) { try { text = readFileSync(report, 'utf8') } catch { text = '' } }
      finish({ ran: true, code, events: parseEvents(text), stderr })
    })
  })
}

export function goRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  return async ({ files, testName, timeoutMs }) => {
    const idx = indexSpecs(root, files)
    if (idx.error) return { ran: false, tests: [], broken: [], error: idx.error }
    const run = runPattern(idx.pkgs, testName)
    // Nothing to run: no test function in the specs, or no scenario of that name.
    if (!run) return { ran: true, tests: [], broken: [] }
    const byModule = new Map()
    for (const p of idx.pkgs) byModule.set(p.cwd, [...(byModule.get(p.cwd) ?? []), p])
    const all = { ran: true, tests: [], broken: [] }
    for (const [cwd, pkgs] of byModule) {
      const dir = mkdtempSync(join(tmpdir(), 'qc-go-'))
      const report = join(dir, 'report.jsonl')
      try {
        const cmd = commandFor(config, pkgs.map(p => p.pattern), run, report)
        const r = await runGo(cwd, cmd, report, timeoutMs ?? defaultMs, dir)
        if (!r.ran) return { ran: false, tests: [], broken: [], error: r.error }
        // go stopped before any package (no module, a bad flag): no result to read.
        if (!r.events.length && r.code !== 0) return { ran: false, tests: [], broken: [], error: firstLine(r.stderr) || `${LABEL} exited with code ${r.code}` }
        const got = results(r.events, pkgs, r.stderr)
        all.tests.push(...got.tests)
        all.broken.push(...got.broken)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    return all
  }
}

