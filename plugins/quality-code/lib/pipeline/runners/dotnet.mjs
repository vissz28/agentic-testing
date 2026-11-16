// .NET runner: `dotnet test` per test project, read from TRX (xUnit, NUnit, MSTest). Report goes to a temp dir.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { classesOf } from '../../stacks/dialects/dotnet.mjs'
import { commandOf, timeoutSecondsOf } from '../../config/config.mjs'
import { kill, track } from './tool.mjs'
import { firstLine, localToForwardSlashes } from '../../core/text.mjs'
import { fillPlaceholders, shellQuote } from '../../core/shell.mjs'
import { child, descendants, parseXml } from '../../core/xml.mjs'

/** Drop theory parameters and the class prefix. */
export const methodTitle = name => String(name ?? '').split('(')[0].trim().split('.').at(-1)

/** Drop assembly and generic arity; Outer+Inner becomes Outer.Inner. */
const className = name => String(name ?? '').split(',')[0].split('(')[0].replace(/`\d+/g, '').replace(/\+/g, '.').trim()

const STATUS = { Passed: 'passed', PassedButRunAborted: 'passed', Completed: 'passed', Failed: 'failed', Error: 'failed', Timeout: 'failed', Aborted: 'failed' }

/** Data-driven MSTest results count their inner results; NotExecuted, Inconclusive etc. are skipped. */
export function parseTrx(xml) {
  const doc = parseXml(xml)
  const defs = new Map()
  for (const ut of descendants(doc, 'UnitTest')) {
    const tm = child(ut, 'TestMethod')
    defs.set(ut.attrs.id, { className: className(tm?.attrs.className), name: tm?.attrs.name ?? ut.attrs.name })
  }
  const out = []
  const read = (r, parentId) => {
    const inner = child(r, 'InnerResults')
    if (inner?.children.some(c => c.name === 'UnitTestResult')) {
      for (const c of inner.children.filter(c => c.name === 'UnitTestResult')) read(c, r.attrs.testId)
      return
    }
    const def = defs.get(r.attrs.testId) ?? defs.get(parentId) ?? { className: '', name: r.attrs.testName }
    const status = STATUS[r.attrs.outcome] ?? 'skipped'
    const info = child(child(r, 'Output'), 'ErrorInfo')
    out.push({ className: def.className, title: methodTitle(def.name ?? r.attrs.testName), status, message: status === 'failed' ? firstLine(child(info, 'Message')?.text) : '' })
  }
  const results = child(child(doc, 'TestRun') ?? doc, 'Results')
  for (const r of (results ?? doc).children.filter(c => c.name === 'UnitTestResult')) read(r)
  return out
}

/** First compiler error, e.g. "File.cs(12,5): error CS1002: ; expected", minus the [project] suffix. */
export function buildError(text) {
  const m = /^.*?\berror (?:CS|FS|BC)\d+:.*$/m.exec(String(text ?? ''))
  if (!m) return null
  return m[0].replace(/\s*\[[^\]]*\.(?:cs|fs|vb)proj(?:::[^\]]*)?\]\s*$/, '').replace(/^\s*\d+>/, '').trim()
}

/** Nearest *.csproj/*.fsproj above the spec, up to root. */
export function projectOf(root, file) {
  const top = resolve(root)
  for (let d = dirname(resolve(root, file)); ; d = dirname(d)) {
    let names = []
    try { names = readdirSync(d) } catch {}
    const proj = names.filter(n => /\.(?:cs|fs)proj$/.test(n)).sort()[0]
    if (proj) return join(d, proj)
    if (d === top || dirname(d) === d || !d.startsWith(top)) return null
  }
}

export function filterFor(classes, testName) {
  return classes.map(c => `FullyQualifiedName~${c.fqn}.${testName === undefined ? '' : testName}`).join('|')
}

/** Multi-targeted projects write one .trx per framework. */
function trxFiles(dir) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    try {
      if (statSync(p).isDirectory()) out.push(...trxFiles(p))
      else if (n.endsWith('.trx')) out.push(p)
    } catch {}
  }
  return out
}

export function runDotnet(root, project, { filter, command = null, timeoutMs }) {
  return new Promise(done => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-dotnet-'))
    const report = join(dir, 'report.trx')
    const logger = ['--logger', `trx;LogFileName=${report}`, '--results-directory', dir]
    let file
    let args
    if (command) {
      // dotnet.command: {files} test project, {report} TRX path, {test} filter.
      let line = fillPlaceholders(command, { files: shellQuote(project), report: shellQuote(report), test: shellQuote(filter) })
      if (!command.includes('{report}')) line += ` ${logger.map(w => shellQuote(w)).join(' ')}`
      if (!command.includes('{test}')) line += ` --filter ${shellQuote(filter)}`
      file = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
      args = process.platform === 'win32' ? ['/d', '/s', '/c', line] : ['-c', line]
    } else {
      file = 'dotnet'
      args = ['test', project, '--nologo', ...logger, '--filter', filter]
    }
    let output = ''
    let timedOut = false
    let settled = false
    let timer = null
    let untrack = () => {}
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      untrack()
      try { rmSync(dir, { recursive: true, force: true }) } finally { done(r) }
    }
    const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', MSBUILDDISABLENODEREUSE: '1', NO_COLOR: '1', CI: '1' }
    let ch
    try {
      ch = spawn(file, args, { cwd: root, detached: true, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      untrack = track(ch, [dir])
    } catch (e) {
      return finish({ ran: false, error: `could not start dotnet: ${e.message}` })
    }
    const keep = d => { if (output.length < 1 << 21) output += d }
    ch.stdout.on('data', keep)
    ch.stderr.on('data', keep)
    timer = setTimeout(() => {
      timedOut = true
      kill(ch)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    ch.on('error', e => finish({ ran: false, error: e.code === 'ENOENT' ? 'the .NET SDK is not installed (no dotnet on PATH)' : `could not start dotnet: ${e.message}` }))
    ch.on('close', code => {
      if (timedOut) return
      try {
        const reports = existsSync(dir) ? trxFiles(dir) : []
        const results = reports.flatMap(f => parseTrx(readFileSync(f, 'utf8')))
        if (reports.length) return finish({ ran: true, results })
        // No report: the build failed or the run never started.
        const err = buildError(output)
        if (err) return finish({ ran: true, results: [], buildError: err })
        finish({ ran: false, error: code === 0 ? 'dotnet test wrote no report' : firstLine(output.split('\n').filter(l => /error|fail/i.test(l)).join('\n')) || `dotnet test exited with code ${code} and wrote no report` })
      } catch (e) {
        finish({ ran: false, error: `could not read the TRX report: ${e.message}` })
      }
    })
  })
}

export function dotnetRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  const command = commandOf(config)
  return async ({ files, testName, timeoutMs }) => {
    const out = { ran: true, tests: [], broken: [] }
    const byProject = new Map()
    for (const f of files) {
      let src
      try { src = readFileSync(resolve(root, f), 'utf8') } catch (e) { out.broken.push({ file: f, message: `cannot read the spec: ${e.code ?? e.message}` }); continue }
      const classes = classesOf(src)
      if (!classes.length) { out.broken.push({ file: f, message: 'no test class in this file' }); continue }
      const project = projectOf(root, f)
      if (!project) { out.broken.push({ file: f, message: 'no .csproj or .fsproj above this file' }); continue }
      const group = byProject.get(project) ?? []
      group.push({ file: f, classes })
      byProject.set(project, group)
    }
    for (const [project, specs] of byProject) {
      const classes = specs.flatMap(s => s.classes.map(c => ({ ...c, file: s.file })))
      const r = await runDotnet(root, localToForwardSlashes(relative(root, project)) || project, { filter: filterFor(classes, testName), command, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], broken: [], error: r.error }
      if (r.buildError) { out.broken.push(...specs.map(s => ({ file: s.file, message: `does not compile: ${r.buildError}` }))); continue }
      const byFqn = new Map(classes.map(c => [c.fqn, c]))
      const byName = new Map()
      for (const c of classes) byName.set(c.name, byName.has(c.name) ? null : c)
      for (const t of r.results) {
        // Match by full name, else by short name if it's unique.
        const c = byFqn.get(t.className) ?? byName.get(t.className.split('.').at(-1))
        if (!c) continue
        if (testName !== undefined && t.title !== testName) continue
        out.tests.push({ title: t.title, path: [c.title], file: c.file, status: t.status, message: t.message })
      }
    }
    return out
  }
}
