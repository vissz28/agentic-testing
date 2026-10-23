// The .NET runner: runs the specs' test classes with `dotnet test` on their test project and reads its
// TRX report (xUnit, NUnit and MSTest all write one). Implements the runner contract of the shared
// checks. The build output stays in the project's bin/ and obj/; the report goes to a temp folder.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { classesOf } from '../../base/dialects/dotnet.mjs'
import { commandOf, timeoutSecondsOf } from '../../base/config.mjs'
import { kill, track } from './tool.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const posix = p => p.split(sep).join('/')

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m)

/** A small XML tree: { name, attrs, children, text }. Enough for a TRX file; no namespaces, no DTD. */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    const top = stack.at(-1)
    if (m[1] !== undefined) top.text += m[1]
    else if (m[6] !== undefined) top.text += decode(m[6])
    else if (m[3] && m[2] === '/') { if (stack.length > 1) stack.pop() }
    else if (m[3]) {
      const attrs = {}
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^\w+:/, '')] = decode(a[2] ?? a[3])
      const node = { name: m[3].replace(/^\w+:/, ''), attrs, children: [], text: '' }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    }
  }
  return root
}

const all = (node, name, out = []) => {
  for (const c of node.children) { if (c.name === name) out.push(c); all(c, name, out) }
  return out
}
const child = (node, name) => node?.children.find(c => c.name === name)

/** A method's name as the dialect reads it: no parameters (a theory's case), no class in front. */
export const methodTitle = name => String(name ?? '').split('(')[0].trim().split('.').at(-1)

/** A class's full name as the specs declare it: no assembly, no generic arity; a nested class keeps its own name. */
const className = name => String(name ?? '').split(',')[0].split('(')[0].replace(/`\d+/g, '').replace(/\+/g, '.').trim()

const STATUS = { Passed: 'passed', PassedButRunAborted: 'passed', Completed: 'passed', Failed: 'failed', Error: 'failed', Timeout: 'failed', Aborted: 'failed' }

/**
 * The results of a TRX file: [{ className, title, status, message }]. A data-driven MSTest result
 * counts its inner results; NotExecuted, Inconclusive and the like are skipped.
 */
export function parseTrx(xml) {
  const doc = parseXml(xml)
  const defs = new Map()
  for (const ut of all(doc, 'UnitTest')) {
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

/** The first compiler error of a failed build: "File.cs(12,5): error CS1002: ; expected", without the project. */
export function buildError(text) {
  const m = /^.*?\berror (?:CS|FS|BC)\d+:.*$/m.exec(String(text ?? ''))
  if (!m) return null
  return m[0].replace(/\s*\[[^\]]*\.(?:cs|fs|vb)proj(?:::[^\]]*)?\]\s*$/, '').replace(/^\s*\d+>/, '').trim()
}

/** The nearest *.csproj or *.fsproj above a spec, up to the project root; null when there is none. */
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

/** A --filter value: one FullyQualifiedName~ clause per class (per class and method for one test). */
export function filterFor(classes, testName) {
  return classes.map(c => `FullyQualifiedName~${c.fqn}.${testName === undefined ? '' : testName}`).join('|')
}

const quote = s => (/^[\w./:=~|-]+$/.test(s) ? s : `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`)

/** Every .trx file under a folder (the report, and one per target framework when there are several). */
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

/** One `dotnet test` on one project: { ran, results, buildError, error }. */
export function runDotnet(root, project, { filter, command = null, timeoutMs }) {
  return new Promise(done => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-dotnet-'))
    const report = join(dir, 'report.trx')
    const logger = ['--logger', `trx;LogFileName=${report}`, '--results-directory', dir]
    let file
    let args
    if (command) {
      // The project's own command: {files} is the test project, {report} the TRX path, {test} the filter.
      let line = command.replaceAll('{files}', quote(project)).replaceAll('{report}', quote(report)).replaceAll('{test}', quote(filter))
      if (!command.includes('{report}')) line += ` ${logger.map(quote).join(' ')}`
      if (!command.includes('{test}')) line += ` --filter ${quote(filter)}`
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
        // No report: a build that failed (the specs do not compile), or a run that never started.
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
    // Each spec's test classes and test project.
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
      const r = await runDotnet(root, posix(relative(root, project)) || project, { filter: filterFor(classes, testName), command, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], broken: [], error: r.error }
      if (r.buildError) { out.broken.push(...specs.map(s => ({ file: s.file, message: `does not compile: ${r.buildError}` }))); continue }
      const byFqn = new Map(classes.map(c => [c.fqn, c]))
      const byName = new Map()
      for (const c of classes) byName.set(c.name, byName.has(c.name) ? null : c)
      for (const t of r.results) {
        // The class by its full name, else by its own name when only one spec declares it.
        const c = byFqn.get(t.className) ?? byName.get(t.className.split('.').at(-1))
        if (!c) continue
        if (testName !== undefined && t.title !== testName) continue
        out.tests.push({ title: t.title, path: [c.title], file: c.file, status: t.status, message: t.message })
      }
    }
    return out
  }
}
