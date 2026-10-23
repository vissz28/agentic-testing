// The JUnit runner: runs Java and Kotlin specs with the project's Maven or Gradle (its wrapper when
// it has one) and reads the JUnit XML reports the build writes. Implements the runner contract of the
// shared checks. Writes nothing into the project but the build's own output (target/, build/).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { commandOf, timeoutSecondsOf } from '../../base/config.mjs'
import { structure } from '../../base/dialects/junit.mjs'
import { kill, track } from './tool.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const WIN = process.platform === 'win32'
const OUTPUT_MAX = 1 << 20

// ---------------------------------------------------------------------------------------------
// JUnit XML: surefire's TEST-*.xml and Gradle's test-results/*.xml. Elements, attributes, entities,
// CDATA and comments; no DTD, no namespaces beyond keeping the prefixed name.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Resolves &lt; &amp; &#38; &#x26; (an unknown entity stays as written). */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      try { return String.fromCodePoint(n) } catch { return all }
    }
    return ENTITIES[e] ?? all
  })
}

/** A small XML tree: { name, attrs, children, text }. Throws on a tag left open at the end. */
export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [root]
  const top = () => stack.at(-1)
  let i = 0
  const s = String(xml).replace(/^\uFEFF/, '')
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) { top().text += decodeEntities(s.slice(i)); break }
    if (lt > i) top().text += decodeEntities(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9)
      top().text += s.slice(lt + 9, e < 0 ? s.length : e)
      i = e < 0 ? s.length : e + 3
      continue
    }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); i = e < 0 ? s.length : e + 2; continue }
    if (s.startsWith('<!', lt)) { const e = s.indexOf('>', lt + 2); i = e < 0 ? s.length : e + 1; continue }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt + 2)
      const name = s.slice(lt + 2, e < 0 ? s.length : e).trim()
      while (stack.length > 1 && top().name !== name) stack.pop()
      if (stack.length > 1) stack.pop()
      i = e < 0 ? s.length : e + 1
      continue
    }
    // A start tag: the name, then attributes whose values may hold ">" inside quotes.
    const nm = /^<([^\s/>]+)/.exec(s.slice(lt, lt + 256))
    if (!nm) { top().text += '<'; i = lt + 1; continue }
    const el = { name: nm[1], attrs: {}, children: [], text: '' }
    let j = lt + nm[0].length
    const attr = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')|\s*(\/?>)/y
    let selfClosing = false
    for (;;) {
      attr.lastIndex = j
      const a = attr.exec(s)
      if (!a) { j = s.indexOf('>', j); j = j < 0 ? s.length : j + 1; break }
      j = attr.lastIndex
      if (a[4]) { selfClosing = a[4] === '/>'; break }
      el.attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '')
    }
    top().children.push(el)
    if (!selfClosing) stack.push(el)
    i = j
  }
  if (stack.length > 1) throw new Error(`unclosed <${top().name}>`)
  return root
}

/**
 * The test cases of a JUnit XML report: { classname, name, status, message }. A failure or an error
 * fails the test; skipped skips it; a surefire rerun's flakyFailure leaves its pass a pass.
 */
export function parseJUnitXml(xml) {
  const doc = parseXml(xml)
  const out = []
  const visit = (node, suiteName) => {
    for (const c of node.children) {
      if (c.name === 'testsuite' || c.name === 'testsuites') { visit(c, c.attrs.name ?? suiteName); continue }
      if (c.name !== 'testcase') continue
      const bad = c.children.find(k => k.name === 'failure' || k.name === 'error')
      const skipped = c.children.find(k => k.name === 'skipped')
      const status = bad ? 'failed' : skipped ? 'skipped' : 'passed'
      const message = bad ? firstLine(bad.attrs.message) || firstLine(bad.text) || firstLine(bad.attrs.type) : ''
      out.push({ classname: c.attrs.classname ?? suiteName ?? '', name: c.attrs.name ?? '', status, message, error: bad?.name === 'error' })
    }
  }
  visit(doc, null)
  return out
}

// ---------------------------------------------------------------------------------------------
// Specs to classes.

/** What the runner needs of one spec: its classes by binary name and its tests' names. */
export function specInfo(file, src) {
  const s = structure(src)
  const prefix = s.pkg ? `${s.pkg}.` : ''
  const tops = s.classes.filter(c => !c.parent)
  // A file with no class the dialect can read still runs as the class its name says.
  if (!tops.length) tops.push({ name: basename(file).replace(/\.\w+$/, ''), binary: basename(file).replace(/\.\w+$/, ''), displayName: null, parent: null })
  const classes = new Map()
  for (const c of [...tops, ...s.classes.filter(c => c.parent)]) classes.set(`${prefix}${c.binary}`, c)
  return { file, pkg: s.pkg, tops: tops.map(t => `${prefix}${t.binary}`), classes, tests: s.tests.map(t => ({ ...t, cls: t.cls ? `${prefix}${t.cls}` : null })) }
}

/** A report's test name as the dialect titles it: the method name, from "m()", "m(int)[2]" or a @DisplayName. */
export function titleOf(name, info, classname) {
  const raw = String(name ?? '').trim()
  const own = info?.tests.filter(t => !classname || !t.cls || t.cls === classname) ?? []
  if (own.some(t => t.title === raw)) return raw
  const byDisplay = own.find(t => t.displayName && t.displayName === raw)
  if (byDisplay) return byDisplay.title
  const bare = raw.replace(/\[\d+\]$/, '').replace(/\([^()]*\)$/, '').trim()
  if (own.some(t => t.title === bare)) return bare
  return bare || raw
}

/** The tests of the reports that belong to the requested specs, titled and placed as the checks read them. */
export function collect(cases, infos) {
  const byClass = new Map()
  for (const info of infos) {
    for (const [binary] of info.classes) byClass.set(binary, info)
    // A report that names the class by its @DisplayName (surefire's phrased names) still finds it.
    for (const [binary, c] of info.classes) if (c.displayName && !byClass.has(c.displayName)) byClass.set(c.displayName, { ...info, alias: binary })
  }
  const tests = []
  const broken = []
  for (const c of cases) {
    const hit = byClass.get(c.classname)
    if (!hit) continue
    const info = hit
    const binary = hit.alias ?? c.classname
    const parts = binary.slice(info.pkg ? info.pkg.length + 1 : 0).split('$')
    const top = info.classes.get(`${info.pkg ? `${info.pkg}.` : ''}${parts[0]}`)
    // The top-level group's title is the class's @DisplayName, where the ticket key is (see keys.mjs).
    const path = [top?.displayName ?? parts[0], ...parts.slice(1)]
    const simple = parts.at(-1)
    // A class-level failure (@BeforeAll, a constructor, JUnit 4's initializationError) is no test of its own.
    if (!c.name || c.name === c.classname || c.name === simple || c.name === 'initializationError' || c.name === 'classMethod') {
      if (c.status === 'failed') broken.push({ file: info.file, message: c.message })
      continue
    }
    tests.push({ title: titleOf(c.name, info, binary), path, file: info.file, status: c.status, message: c.status === 'failed' ? c.message : '' })
  }
  return { tests, broken }
}

// ---------------------------------------------------------------------------------------------
// The build.

const BUILD_FILES = [['maven', 'pom.xml'], ['gradle', 'build.gradle.kts'], ['gradle', 'build.gradle']]

/** The build of a spec: the nearest pom.xml or build.gradle(.kts) above it, up to the root; or null. */
export function moduleOf(root, file) {
  const top = resolve(root)
  for (let d = dirname(resolve(top, file)); ; d = dirname(d)) {
    for (const [tool, name] of BUILD_FILES) if (existsSync(join(d, name))) return { tool, dir: d }
    if (d === top || dirname(d) === d || !d.startsWith(top)) return null
  }
}

/** The first of names found from dir up to the root, or null. */
function upTo(root, dir, names) {
  const top = resolve(root)
  for (let d = dir; ; d = dirname(d)) {
    for (const n of names) if (existsSync(join(d, n))) return { dir: d, path: join(d, n) }
    if (d === top || dirname(d) === d || !d.startsWith(top)) return null
  }
}

const toPosix = p => p.split(sep).join('/')

/**
 * How to run one module: { cmd, args, cwd, reports } for Maven or Gradle. A module below the build's top
 * runs from the top (Maven -pl, a Gradle project path), so its siblings it depends on build too.
 */
export function buildCommand(root, mod, selectors) {
  if (mod.tool === 'maven') {
    // The reactor's top: the highest pom.xml between the module and the root.
    let top = mod.dir
    for (let d = dirname(mod.dir); resolve(d).startsWith(resolve(root)); d = dirname(d)) {
      if (existsSync(join(d, 'pom.xml'))) top = d
      if (d === resolve(root) || dirname(d) === d) break
    }
    const wrapper = upTo(root, mod.dir, [WIN ? 'mvnw.cmd' : 'mvnw'])
    const pl = top === mod.dir ? [] : ['-pl', toPosix(relative(top, mod.dir)), '-am']
    return {
      tool: 'maven',
      cmd: wrapper ? wrapper.path : WIN ? 'mvn.cmd' : 'mvn',
      cwd: top,
      args: ['-B', '-q', ...pl, 'test', `-Dtest=${selectors.map(s => (s.method ? `${s.cls}#${s.method}` : s.cls)).join(',')}`,
        '-DfailIfNoTests=false', '-Dsurefire.failIfNoSpecifiedTests=false', '-Dsurefire.rerunFailingTestsCount=0'],
      reports: join(mod.dir, 'target', 'surefire-reports'),
    }
  }
  const wrapper = upTo(root, mod.dir, [WIN ? 'gradlew.bat' : 'gradlew'])
  const settings = upTo(root, mod.dir, ['settings.gradle.kts', 'settings.gradle'])
  const top = wrapper?.dir ?? settings?.dir ?? mod.dir
  const project = toPosix(relative(top, mod.dir)).split('/').filter(Boolean).map(p => `:${p}`).join('')
  // cleanTest: an up-to-date test task would run nothing and leave the last run's reports.
  return {
    tool: 'gradle',
    cmd: wrapper ? wrapper.path : WIN ? 'gradle.bat' : 'gradle',
    cwd: top,
    args: [`${project}:cleanTest`, `${project}:test`, ...selectors.flatMap(s => ['--tests', s.method ? `${s.cls}.${s.method}` : s.cls]), '--console=plain'],
    reports: join(mod.dir, 'build', 'test-results', 'test'),
  }
}

/** The project's junit.command with its placeholders filled; each value quoted for the shell. */
export function fillCommand(template, { files, report, tool, selectors }) {
  const q = s => (WIN ? `"${String(s).replace(/"/g, '""')}"` : `'${String(s).replace(/'/g, `'\\''`)}'`)
  const test = tool === 'gradle'
    ? selectors.map(s => `--tests ${q(s.method ? `${s.cls}.${s.method}` : s.cls)}`).join(' ')
    : `-Dtest=${q(selectors.map(s => (s.method ? `${s.cls}#${s.method}` : s.cls)).join(','))}`
  return template.replace(/\{files\}/g, files.map(q).join(' ')).replace(/\{report\}/g, q(report)).replace(/\{test\}/g, test)
}

/** The first compiler error of the build output, the one naming the spec when there is one. */
export function compileError(output, file) {
  const lines = String(output ?? '').split('\n').map(l => l.trim())
  const errs = lines.filter(l => /^\[ERROR\]\s+\S/.test(l) || /^e:\s+\S/.test(l) || /\.(?:java|kt):\d+(?::\d+)?:?\s*error:/.test(l) || /^error:/.test(l))
  const name = basename(file)
  return errs.find(l => l.includes(name)) ?? errs[0] ?? ''
}

/** Every *.xml under dir (one level of subfolders too) written at or after `since`. */
function reportFiles(dir, since = 0) {
  const out = []
  const visit = (d, depth) => {
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory() && depth < 1) visit(p, depth + 1)
      else if (st.isFile() && n.endsWith('.xml') && st.mtimeMs >= since) out.push(p)
    }
  }
  visit(dir, 0)
  return out
}

/** Removes the last run's reports of these classes, so only this run's are read back. */
function clearReports(dir, classes) {
  let names = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    const m = /^TEST-(.+)\.xml$/.exec(n)
    if (m && classes.some(c => m[1] === c || m[1].startsWith(`${c}$`))) try { unlinkSync(join(dir, n)) } catch {}
  }
}

function spawnTool({ cmd, args, cwd, shell = false, timeoutMs, temp = [] }) {
  return new Promise(done => {
    let output = ''
    let settled = false
    let timer = null
    let untrack = () => {}
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      untrack()
      done({ ...r, output })
    }
    let child
    try {
      child = spawn(cmd, args, { cwd, shell, detached: !WIN, windowsHide: true, env: { ...process.env, CI: '1', NO_COLOR: '1', TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] })
      untrack = track(child, temp)
    } catch (e) {
      return finish({ started: false, error: e.message })
    }
    const take = d => { if (output.length < OUTPUT_MAX) output += d }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    timer = setTimeout(() => {
      kill(child)
      finish({ started: true, timedOut: true })
    }, timeoutMs)
    child.on('error', e => finish({ started: false, error: e.code === 'ENOENT' ? 'ENOENT' : e.message }))
    child.on('close', code => finish({ started: true, code }))
  })
}

const LABEL = { maven: 'Maven', gradle: 'Gradle' }
const MISSING = { maven: 'Maven is not installed: no mvnw in the project and no mvn on PATH', gradle: 'Gradle is not installed: no gradlew in the project and no gradle on PATH' }
const took = ms => `took longer than ${ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`}`

/** The classes and methods one run selects: a whole class, or the methods named testName in it. */
export function selectorsFor(infos, testName) {
  const out = []
  for (const info of infos) {
    if (testName === undefined) { out.push(...info.tops.map(cls => ({ cls }))); continue }
    const own = info.tests.filter(t => t.title === testName && t.cls)
    const classes = own.length ? [...new Set(own.map(t => t.cls))] : info.tops
    out.push(...classes.map(cls => ({ cls, method: testName })))
  }
  return out
}

async function runModule(root, mod, infos, { testName, timeoutMs, template }) {
  const selectors = selectorsFor(infos, testName)
  const b = buildCommand(root, mod, selectors)
  const start = Date.now()
  let r
  let dirs = [b.reports]
  const dir = template ? mkdtempSync(join(tmpdir(), 'qc-junit-')) : null
  try {
    if (template) {
      const line = fillCommand(template, { files: infos.map(i => i.file), report: dir, tool: b.tool, selectors })
      if (template.includes('{report}')) dirs = [dir]
      else clearReports(b.reports, selectors.map(s => s.cls))
      r = await spawnTool({ cmd: line, args: [], cwd: resolve(root), shell: true, timeoutMs, temp: [dir] })
    } else {
      clearReports(b.reports, selectors.map(s => s.cls))
      r = await spawnTool({ ...b, timeoutMs })
    }
    if (!r.started) return { ran: false, error: r.error === 'ENOENT' ? MISSING[b.tool] : `could not start ${LABEL[b.tool]}: ${r.error}` }
    if (r.timedOut) return { ran: false, error: took(timeoutMs) }
    const cases = []
    // A second's slack: some file systems keep whole-second times.
    for (const f of dirs.flatMap(d => reportFiles(d, start - 1000))) {
      try { cases.push(...parseJUnitXml(readFileSync(f, 'utf8'))) } catch {}
    }
    const { tests, broken } = collect(cases, infos)
    // A file with no result from a failed build never ran: a compile error, most of the time.
    if (r.code !== 0) {
      for (const info of infos) {
        if (tests.some(t => t.file === info.file) || broken.some(x => x.file === info.file)) continue
        broken.push({ file: info.file, message: compileError(r.output, info.file) || `${LABEL[b.tool]} exited with code ${r.code}` })
      }
    }
    return { ran: true, tests, broken }
  } finally {
    if (dir) try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

export function junitRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  const template = commandOf(config)
  return async ({ files, testName, timeoutMs }) => {
    const all = { ran: true, tests: [], broken: [] }
    const groups = new Map()
    for (const f of files) {
      let src
      try { src = readFileSync(resolve(root, f), 'utf8') } catch (e) {
        all.broken.push({ file: f, message: `cannot read the spec: ${firstLine(e.message)}` })
        continue
      }
      const mod = moduleOf(root, f)
      if (!mod && !template) return { ran: false, tests: [], broken: [], error: `no pom.xml or build.gradle above ${f}` }
      const key = mod ? `${mod.tool}\0${mod.dir}` : `none\0${root}`
      const g = groups.get(key) ?? { mod: mod ?? { tool: 'maven', dir: resolve(root) }, infos: [] }
      g.infos.push(specInfo(f, src))
      groups.set(key, g)
    }
    for (const { mod, infos } of groups.values()) {
      const r = await runModule(root, mod, infos, { testName, timeoutMs: timeoutMs ?? defaultMs, template })
      if (!r.ran) return { ran: false, tests: [], broken: [], error: r.error }
      all.tests.push(...r.tests)
      all.broken.push(...r.broken)
    }
    return all
  }
}
