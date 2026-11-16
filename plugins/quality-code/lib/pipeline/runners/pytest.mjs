// pytest runner via JUnit XML. Writes nothing into the project: temp report/coverage, no pytest or bytecode cache.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { adapterOptions, commandOf, timeoutSecondsOf } from '../../config/config.mjs'
import { classTitles, locate } from '../../stacks/dialects/pytest.mjs'
import { result } from '../result.mjs'
import { kill, track } from './tool.mjs'
import { firstLine } from '../../core/text.mjs'
import { fillPlaceholders } from '../../core/shell.mjs'
import { stripDotSlash } from '../../core/paths.mjs'
import { descendants, parseXml } from '../../core/xml.mjs'

const LABEL = 'pytest'
const CAP = 1 << 20
const slash = p => stripDotSlash(p)
const took = ms => `took longer than ${ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`}`

/**
 * Match a classname (tests.test_orders.TestTotal) to a spec file by module path, aligned from either end:
 * pytest's rootdir may sit above or below the project root.
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

/** message attribute, else the first "E   " line, else the text. */
function messageOf(el) {
  const fromText = /^E\s+(.+)$/m.exec(el.text ?? '')?.[1]?.trim()
  const attr = firstLine(el.attrs.message)
  if (el.attrs.message === 'collection failure' && fromText) return fromText
  return attr || fromText || firstLine(el.text)
}

/** titlesOf(file) maps class names to group titles so test paths match what the checks read. */
export function parseReport(xml, files, titlesOf = () => new Map()) {
  const tests = []
  const broken = []
  for (const tc of descendants(parseXml(xml), 'testcase')) {
    const name = tc.attrs.name ?? ''
    const classname = tc.attrs.classname ?? ''
    const fail = tc.children.find(c => c.name === 'failure')
    const error = tc.children.find(c => c.name === 'error')
    const skipped = tc.children.find(c => c.name === 'skipped')
    // Collection errors come under the module name with no class.
    if (error && (error.attrs.message === 'collection failure' || !classname)) {
      const where = tc.attrs.file ? { file: slash(tc.attrs.file) } : resolveClassname(classname || name, files)
      broken.push({ file: where?.file ?? slash(classname || name), message: messageOf(error) })
      continue
    }
    const where = resolveClassname(classname, files)
    // xunit1 has a file attribute.
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

/** test_total[a-1] -> test_total */
export const baseName = title => String(title).replace(/\[.*\]$/, '')

/** file::Class::name ids for `name`, read from source. */
export function nodeIds(root, files, name) {
  const ids = []
  for (const f of files) {
    let src
    try { src = readFileSync(join(root, f), 'utf8') } catch { continue }
    for (const t of locate(src)) if (t.name === baseName(name)) ids.push([slash(f), ...t.classes, name].join('::'))
  }
  return ids
}

/** Shell-like word split without a shell: quotes group, backslash escapes outside single quotes. */
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

/** A standalone {files} expands to one word per target. Without a test, `-k {test}` is dropped. */
export function fillTemplate(template, { targets, report, testName }) {
  const words = splitCommand(template)
  const out = []
  for (const w of words) {
    if (w === '{files}') { out.push(...targets); continue }
    if (w.includes('{test}') && testName === undefined) {
      if (w === '{test}' && out.length && out.at(-1).startsWith('-')) out.pop()
      continue
    }
    out.push(fillPlaceholders(w, { files: targets.join(' '), report, test: testName ?? '' }))
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

/** venv first, then python, then python3. */
export function pythons(root) {
  const v = venvBin(root, 'python')
  return [...(v ? [v] : []), 'python', 'python3']
}

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

/** ERROR line, else an "E   " line, else the last line. */
function errorLine(output) {
  const lines = String(output).split('\n').map(l => l.trim()).filter(Boolean)
  return lines.find(l => /^(?:ERROR|E)\b/.test(l))?.replace(/^E\s+/, '') ?? lines.at(-1) ?? 'no output'
}

const MISSING_PYTEST = /No module named pytest/

export async function runPytest(root, files, { config = null, testName, timeoutMs }) {
  const dir = mkdtempSync(join(tmpdir(), 'qc-pytest-'))
  const report = join(dir, 'report.xml')
  try {
    // Run one test by node id (all parametrized cases); fall back to the files if not found.
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
      // No python, or no pytest in it: try the next one.
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
      // Exit 2 (interrupted) or 4 (usage error) with no tests: every file is broken.
      if (!parsed.tests.length && !parsed.broken.length && (r.code === 2 || r.code === 4)) {
        return { ran: true, tests: [], broken: files.map(f => ({ file: slash(f), message: errorLine(r.output) })) }
      }
      const want = new Set(files.map(f => normalize(slash(f))))
      let tests = parsed.tests.filter(t => want.has(normalize(t.file)))
      // Report parametrized cases under the requested name; the checks match on it.
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

/** mypy-style: path:line[:col]: error: text */
const TYPE_ERROR = /^(.+?):(\d+)(?::\d+)?: error: (.*)$/

/** Runs pytest.typeCheck (e.g. mypy {files}); only errors in the specs fail. */
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
