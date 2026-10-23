// The pytest runner: runs specs with the project's own Python and pytest and reads its JUnit XML report.
// Implements the runner contract of the shared checks: pytestRunner(root, config) returns
// ({ files, testName, timeoutMs }) => { ran, tests: [{ title, path, file, status, message }], broken, error }.
// Never writes into the project: the report and coverage data go to a temp folder, the pytest cache and
// the bytecode cache are off.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { adapterOptions, commandOf, timeoutSecondsOf } from '../../base/config.mjs'
import { classTitles, locate } from '../../base/dialects/pytest.mjs'
import { result } from '../../base/result.mjs'
import { kill, track } from './tool.mjs'

const LABEL = 'pytest'
const CAP = 1 << 20
const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const slash = p => String(p).replace(/\\/g, '/').replace(/^\.\//, '')
const took = ms => `took longer than ${ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`}`

// ---- JUnit XML ----

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Entities of XML text: the five named ones and numeric ones (&#10; &#x41;); an unknown one is kept. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try { return String.fromCodePoint(n) } catch { return m }
    }
    return ENTITIES[e] ?? m
  })
}

/**
 * A small XML reader, enough for a JUnit report: elements { name, attrs, children, text }, with the
 * declaration, comments, DOCTYPE and processing instructions skipped, CDATA read as text. Returns the
 * root element, or null when there is none. It reads a report; it does not validate one.
 */
export function parseXml(xml) {
  const top = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [top]
  const s = String(xml)
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    const cur = stack.at(-1)
    if (lt < 0) { cur.text += decodeEntities(s.slice(i)); break }
    if (lt > i) cur.text += decodeEntities(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9)
      cur.text += s.slice(lt + 9, e < 0 ? s.length : e)
      i = e < 0 ? s.length : e + 3
      continue
    }
    if (s[lt + 1] === '?' || s[lt + 1] === '!') { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; continue }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt)
      const name = s.slice(lt + 2, e < 0 ? s.length : e).trim()
      // Close up to the matching element; a stray end tag closes nothing.
      const at = stack.map(x => x.name).lastIndexOf(name)
      if (at > 0) stack.length = at
      i = e < 0 ? s.length : e + 1
      continue
    }
    // A start tag: its attributes may hold ">" inside quotes.
    let j = lt + 1
    let quote = null
    for (; j < s.length; j++) {
      if (quote) { if (s[j] === quote) quote = null } else if (s[j] === '"' || s[j] === "'") quote = s[j]
      else if (s[j] === '>') break
    }
    const body = s.slice(lt + 1, j)
    const selfClosing = body.endsWith('/')
    const name = /^[^\s/>]+/.exec(body)?.[0] ?? ''
    const attrs = {}
    for (const m of body.slice(name.length).matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '')
    const el = { name, attrs, children: [], text: '' }
    cur.children.push(el)
    if (!selfClosing) stack.push(el)
    i = j + 1
  }
  return top.children.find(c => c.name) ?? null
}

function* elements(el, name) {
  if (!el) return
  if (el.name === name) yield el
  for (const c of el.children) yield* elements(c, name)
}

/**
 * The spec file and the classes of a JUnit classname (tests.test_orders.TestTotal): the given file
 * whose module path lines up with the classname's leading parts, from either end (pytest names it from
 * its rootdir, which may sit above or below the project root). Returns { file, classes }, or null.
 */
export function resolveClassname(classname, files) {
  const cp = String(classname).split('.').filter(Boolean)
  let best = null
  for (const f of files) {
    const fp = slash(f).replace(/\.py$/, '').split('/').filter(Boolean)
    for (let k = cp.length; k >= 1; k--) {
      const mod = cp.slice(0, k)
      const n = Math.min(mod.length, fp.length)
      if (mod.slice(-n).join('/') !== fp.slice(-n).join('/')) continue
      if (!best || n > best.n) best = { n, file: f, classes: cp.slice(k) }
      break
    }
  }
  return best && { file: best.file, classes: best.classes }
}

/** The message of a failure or an error: its message attribute's first line, else the first "E   " line, else its text's. */
function messageOf(el) {
  const fromText = /^E\s+(.+)$/m.exec(el.text ?? '')?.[1]?.trim()
  const attr = firstLine(el.attrs.message)
  if (el.attrs.message === 'collection failure' && fromText) return fromText
  return attr || fromText || firstLine(el.text)
}

/**
 * Tests and broken files of a JUnit report. files: the specs as they were given (a test's file is one
 * of them); titlesOf(file): the top-level class titles of a spec, by class name, so a test's path holds
 * its group's title as the checks read it. A collection error makes its file broken.
 */
export function parseReport(xml, files, titlesOf = () => new Map()) {
  const root = typeof xml === 'string' ? parseXml(xml) : xml
  const tests = []
  const broken = []
  for (const tc of elements(root, 'testcase')) {
    const name = tc.attrs.name ?? ''
    const classname = tc.attrs.classname ?? ''
    const fail = tc.children.find(c => c.name === 'failure')
    const error = tc.children.find(c => c.name === 'error')
    const skipped = tc.children.find(c => c.name === 'skipped')
    // A collection error: pytest's "collection failure", reported under the module's name with no class.
    if (error && (error.attrs.message === 'collection failure' || !classname)) {
      const where = tc.attrs.file ? { file: slash(tc.attrs.file) } : resolveClassname(classname || name, files)
      broken.push({ file: where?.file ?? slash(classname || name), message: messageOf(error) })
      continue
    }
    const where = resolveClassname(classname, files)
    // A file attribute (xunit1) names the file outright.
    const file = tc.attrs.file ? files.find(f => normalize(f) === normalize(slash(tc.attrs.file))) ?? slash(tc.attrs.file) : where?.file
    if (!file) continue
    const titles = titlesOf(file)
    const path = (where?.classes ?? []).map((c, i) => (i === 0 ? titles.get(c) ?? c : c))
    const status = fail || error ? 'failed' : skipped ? 'skipped' : 'passed'
    tests.push({ title: name, path, file, status, message: status === 'failed' ? messageOf(fail ?? error) : '' })
  }
  return { tests, broken }
}

// ---- Running ----

/** A test's name without its parametrize id: test_total[a-1] is a case of test_total. */
export const baseName = title => String(title).replace(/\[.*\]$/, '')

/** The node ids of the test `name` in the files (file::Class::name), from their source; [] when none is found. */
export function nodeIds(root, files, name) {
  const ids = []
  for (const f of files) {
    let src
    try { src = readFileSync(join(root, f), 'utf8') } catch { continue }
    for (const t of locate(src)) if (t.name === baseName(name)) ids.push([slash(f), ...t.classes, name].join('::'))
  }
  return ids
}

/** Words of a one-line command: quotes group, a backslash escapes outside single quotes; no shell. */
export function splitCommand(line) {
  const out = []
  let cur = null
  let quote = null
  const s = String(line)
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i]
      else cur += c
    } else if (c === '"' || c === "'") { quote = c; cur ??= '' }
    else if (c === '\\' && i + 1 < s.length) cur = (cur ?? '') + s[++i]
    else if (/\s/.test(c)) { if (cur !== null) out.push(cur); cur = null }
    else cur = (cur ?? '') + c
  }
  if (cur !== null) out.push(cur)
  return out
}

/**
 * The words of a command template: {files} as a word of its own gives one word per target, inside a
 * word they join with spaces; {report} is the report path; {test} the test name. Without a test, a
 * {test} word goes, with the option before it (-k {test}).
 */
export function fillTemplate(template, { targets, report, testName }) {
  const words = splitCommand(template)
  const out = []
  for (const w of words) {
    if (w === '{files}') { out.push(...targets); continue }
    if (w.includes('{test}') && testName === undefined) {
      if (w === '{test}' && out.length && out.at(-1).startsWith('-')) out.pop()
      continue
    }
    out.push(w.replace(/\{files\}/g, targets.join(' ')).replace(/\{report\}/g, report).replace(/\{test\}/g, testName ?? ''))
  }
  return out
}

const isWin = process.platform === 'win32'
const venvBin = (root, name) => {
  for (const v of ['.venv', 'venv']) {
    const p = join(root, v, isWin ? 'Scripts' : 'bin', isWin ? `${name}.exe` : name)
    if (existsSync(p)) return p
  }
  return null
}

/** The Pythons to try, in order: the project's virtualenv, then python, then python3. */
export function pythons(root) {
  const v = venvBin(root, 'python')
  return [...(v ? [v] : []), 'python', 'python3']
}

/** One run of a command: { code, output, spawnError, timedOut }. */
function exec(root, cmd, args, { env, timeoutMs, temp }) {
  return new Promise(done => {
    let output = ''
    let settled = false
    let timer = null
    let untrack = () => {}
    const finish = r => { if (settled) return; settled = true; clearTimeout(timer); untrack(); done(r) }
    let child
    try {
      child = spawn(cmd, args, { cwd: root, detached: !isWin, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      untrack = track(child, temp)
    } catch (e) {
      return finish({ code: null, output: '', spawnError: e })
    }
    const read = d => { if (output.length < CAP) output += d }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    timer = setTimeout(() => { kill(child); finish({ code: null, output, timedOut: true }) }, timeoutMs)
    child.on('error', e => finish({ code: null, output, spawnError: e }))
    child.on('close', code => finish({ code, output }))
  })
}

/** The line of pytest's output that says what went wrong: an ERROR line, else an "E   " line, else the last line. */
function errorLine(output) {
  const lines = String(output).split('\n').map(l => l.trim()).filter(Boolean)
  return lines.find(l => /^(?:ERROR|E)\b/.test(l))?.replace(/^E\s+/, '') ?? lines.at(-1) ?? 'no output'
}

const MISSING_PYTEST = /No module named pytest/

/**
 * Runs pytest on the files (or on the one test testName) and reads its report. config: the project
 * config (pytest.command). Returns { ran, tests, broken, error }.
 */
export async function runPytest(root, files, { config = null, testName, timeoutMs }) {
  const dir = mkdtempSync(join(tmpdir(), 'qc-pytest-'))
  const report = join(dir, 'report.xml')
  try {
    // One test: its node ids (exact, a class and a parametrized test's every case); the files when it is not found.
    const ids = testName === undefined ? [] : nodeIds(root, files, testName)
    const targets = ids.length ? ids : files.map(slash)
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', COVERAGE_FILE: join(dir, '.coverage'), NO_COLOR: '1', PY_COLORS: '0' }
    const template = commandOf(config)
    let runs
    if (template) {
      const words = fillTemplate(template, { targets, report, testName })
      if (!template.includes('{report}')) words.push(`--junitxml=${report}`)
      const [cmd, ...args] = words
      runs = [[/[\\/]/.test(cmd) ? cmd : venvBin(root, cmd) ?? cmd, args]]
    } else {
      const args = ['-m', 'pytest', ...targets, `--junitxml=${report}`, '-p', 'no:cacheprovider', '-q', '-o', 'junit_family=xunit2', '--continue-on-collection-errors']
      runs = pythons(root).map(py => [py, args])
    }
    let last = null
    for (const [cmd, args] of runs) {
      const r = await exec(root, cmd, args, { env, timeoutMs, temp: [dir] })
      if (r.timedOut) return { ran: false, tests: [], broken: [], error: took(timeoutMs) }
      // A missing python, or one without pytest: the next one may have it.
      if (r.spawnError?.code === 'ENOENT' || (!existsSync(report) && MISSING_PYTEST.test(r.output))) { last = r; continue }
      if (r.spawnError) return { ran: false, tests: [], broken: [], error: `could not start ${LABEL}: ${r.spawnError.message}` }
      let xml = null
      try { xml = readFileSync(report, 'utf8') } catch {}
      if (xml === null) return { ran: false, tests: [], broken: [], error: firstLine(errorLine(r.output)) || `${LABEL} wrote no report` }
      const titles = new Map()
      const titlesOf = f => {
        if (!titles.has(f)) { try { titles.set(f, classTitles(readFileSync(join(root, f), 'utf8'))) } catch { titles.set(f, new Map()) } }
        return titles.get(f)
      }
      const parsed = parseReport(xml, files.map(slash), titlesOf)
      // Interrupted (2) or a usage error (4) before any test: every file is broken, for the reason pytest gave.
      if (!parsed.tests.length && !parsed.broken.length && (r.code === 2 || r.code === 4)) {
        return { ran: true, tests: [], broken: files.map(f => ({ file: slash(f), message: errorLine(r.output) })) }
      }
      const want = new Set(files.map(f => normalize(slash(f))))
      let tests = parsed.tests.filter(t => want.has(normalize(t.file)))
      // A test run by name reports under that name, its parametrized cases too: the checks match on it.
      if (testName !== undefined) tests = tests.filter(t => t.title === testName || baseName(t.title) === testName).map(t => ({ ...t, title: testName }))
      return { ran: true, tests, broken: parsed.broken.filter(b => want.has(normalize(b.file))) }
    }
    const why = last?.spawnError ? 'Python is not installed (no python or python3 on PATH)' : `${LABEL} is not installed for this project's Python`
    return { ran: false, tests: [], broken: [], error: why }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

export function pytestRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  return ({ files, testName, timeoutMs }) => runPytest(root, files, { config, testName, timeoutMs: timeoutMs ?? defaultMs })
}

// ---- The types step ----

/** mypy-style lines: path:line: error: text, or path:line:col: error: text. */
const TYPE_ERROR = /^(.+?):(\d+)(?::\d+)?: error: (.*)$/

/**
 * The types step: the command of pytest.typeCheck (mypy {files}) on the specs; only an error in a spec
 * fails it. With no command configured, Python has no type step: a pass that says so.
 */
export async function typeCheck(root, config, specs) {
  const template = adapterOptions(config).typeCheck
  if (typeof template !== 'string' || !template.trim()) return result('types', 'pass', 'not applicable: no type-check for Python', [], { applicable: false })
  const words = fillTemplate(template, { targets: specs.map(slash), report: '', testName: undefined })
  if (!template.includes('{files}')) words.push(...specs.map(slash))
  const [cmd, ...args] = words
  const name = cmd.split(/[\\/]/).at(-1)
  const dir = mkdtempSync(join(tmpdir(), 'qc-pytypes-'))
  try {
    const r = await exec(root, /[\\/]/.test(cmd) ? cmd : venvBin(root, cmd) ?? cmd, args, {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', MYPY_CACHE_DIR: join(dir, 'mypy'), NO_COLOR: '1' }, timeoutMs: timeoutSecondsOf(config) * 1000, temp: [dir],
    })
    if (r.timedOut) return result('types', 'not_run', took(timeoutSecondsOf(config) * 1000))
    if (r.spawnError) return result('types', 'not_run', `could not start ${name}: ${r.spawnError.code === 'ENOENT' ? 'not installed' : r.spawnError.message}`)
    const errors = r.output.split('\n').map(l => TYPE_ERROR.exec(l.trim())).filter(Boolean).map(m => ({ file: slash(m[1]), line: m[0].trim() }))
    const want = new Set(specs.map(s => normalize(slash(s))))
    const inSpec = errors.filter(e => want.has(normalize(e.file)))
    if (inSpec.length) return result('types', 'fail', inSpec[0].line, inSpec.map(e => ({ file: e.file, kind: 'type error', detail: e.line })), { applicable: true })
    if (r.code === 0) return result('types', 'pass', `${name}: no type errors`, [], { applicable: true })
    if (!errors.length) return result('types', 'not_run', `${name} exited with ${r.code}: ${firstLine(r.output) || 'no output'}`)
    return result('types', 'pass', `${name}: no type errors in the specs; ${errors.length} in other files`, [], { applicable: true, otherErrors: errors.length })
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}
