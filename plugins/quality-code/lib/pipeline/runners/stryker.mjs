// The Stryker runner: mutates one source file with the project's own Stryker (Vitest test runner)
// and reads its JSON mutation report. Stryker's sandbox has to live inside the project (outside it Vitest
// finds no tests), so the runner names one per run and always removes it.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { kill, toolScript, track } from './tool.mjs'
import { escapeRegExp, firstLine } from '../../core/text.mjs'
import { tryReadJson } from '../../core/files.mjs'

// Stryker's stderr starts with Node's stack frame; the error it names is the line to show.
const errorOf = s => String(s ?? '').match(/\b[A-Za-z]*Error: [^\n]+/)?.[0] ?? firstLine(s)

/** The project's tracked symlinks to folders, as "/path": Stryker cannot copy them into its sandbox. */
export function linkedFolders(root) {
  let out = ''
  try { out = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }) } catch { return [] }
  return out.split('\n').filter(l => l.startsWith('120000 ')).map(l => l.split('\t')[1]).filter(p => {
    try { return statSync(join(root, p)).isDirectory() } catch { return false }
  }).map(p => `/${p}`)
}

/**
 * Counts the mutants of a mutation-testing-report-schema report. CompileError, RuntimeError, Ignored and
 * Pending do not count; a Timeout is caught, as in Stryker's own score. untested: survivors no test ran on.
 * The score is over the code the tests run (Stryker's score on covered code): the whole file is mutated, and
 * a ticket's tests cover the part it names, so NoCoverage is counted and shown, never held against them.
 */
export function parseStrykerReport(json) {
  const n = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0 }
  let untested = 0
  for (const file of Object.values(json?.files ?? {})) {
    for (const m of file?.mutants ?? []) {
      if (m && Object.hasOwn(n, m.status)) n[m.status]++
      if (m?.status === 'Survived' && m.testsCompleted === 0) untested++
    }
  }
  const total = n.Killed + n.Survived + n.Timeout
  const score = total ? Math.round(((n.Killed + n.Timeout) / total) * 1000) / 10 : null
  return { killed: n.Killed, survived: n.Survived, timeout: n.Timeout, noCoverage: n.NoCoverage, untested, score }
}

/**
 * The 1-based line spans of the named functions or methods in a TypeScript or JavaScript file, read with
 * the project's own TypeScript parser, so Stryker mutates only the code the ticket is about. null when the
 * project has no TypeScript or the file cannot be read; a name not found is left out.
 */
export function functionLines(root, file, names) {
  let ts, text
  try {
    ts = createRequire(join(root, 'package.json'))('typescript')
    text = readFileSync(join(root, file), 'utf8')
  } catch { return null }
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const want = new Set(names)
  const line = pos => src.getLineAndCharacterOfPosition(pos).line + 1
  const isFn = n => n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))
  const found = []
  const visit = n => {
    const named = n.name && ts.isIdentifier(n.name) ? n.name.text : null
    const body = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ? n.body
      : (ts.isVariableDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isPropertyAssignment(n)) && isFn(n.initializer) ? n.initializer : null
    if (named && body && want.has(named)) found.push({ name: named, start: line(n.getStart(src)), end: line(n.getEnd()) })
    else ts.forEachChild(n, visit)
  }
  visit(src)
  return found
}

/**
 * Where Stryker keeps a target's results between runs (its incremental mode), so a run of the same ticket only
 * tries again the code changes whose code or tests changed. node_modules/.cache is never committed.
 * ponytail: a change to a test helper or seed file alone is not seen; delete the file to start over.
 */
export const incrementalFileOf = (root, target) => join(root, 'node_modules', '.cache', 'quality-code', `stryker-${createHash('sha1').update(target).digest('hex').slice(0, 12)}.json`)

// The project's default Vitest config, as Vitest looks for it.
const VITEST_CONFIGS = ['vitest', 'vite'].flatMap(n => ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(e => `${n}.config.${e}`))

/**
 * A Vitest config for one Stryker run, written next to the project's (its imports resolve the same):
 * the specs' config with only those specs, and with a key only the key's tests. Without the name filter,
 * Vitest 4 under Stryker's runner ran no test against a mutant and every mutant "survived".
 */
export function vitestConfigSource(base, specs, key) {
  const scope = `include: ${JSON.stringify(specs)}${key ? `, testNamePattern: ${JSON.stringify(escapeRegExp(key))}` : ''}`
  if (!base) return `export default { test: { ${scope} } }\n`
  // No top-level await: Vite bundles a config as CommonJS in a project without "type": "module".
  return `import own from ${JSON.stringify(`./${base}`)}\nconst scoped = base => ({ ...base, test: { ...base.test, ${scope} } })\nexport default typeof own === 'function' ? env => Promise.resolve(own(env)).then(scoped) : scoped(own)\n`
}

// The config file names Stryker looks for, in its own order.
const CONFIG_NAMES = ['', '.'].flatMap(p => ['.conf', '.config'].flatMap(s => ['json', 'js', 'mjs', 'cjs'].map(e => `${p}stryker${s}.${e}`)))

/** The project's own Stryker config file (absolute), or null. */
export function projectStrykerConfig(root) {
  for (const name of CONFIG_NAMES) if (existsSync(join(root, name))) return join(root, name)
  return null
}

/**
 * A Stryker config module for one run: the project's own config, with the JSON report sent to `out`.
 * Stryker has no command-line option for the report file, so it goes through a temp config file.
 */
export function strykerConfigSource(root, out, { testFiles = [], tempDirName, vitestConfig = null, ignore = [] } = {}) {
  const own = projectStrykerConfig(root)
  const load = !own ? 'const base = {}'
    : extname(own) === '.json' ? `import { readFileSync } from 'node:fs'\nconst base = JSON.parse(readFileSync(${JSON.stringify(own)}, 'utf8'))`
      : `import * as own from ${JSON.stringify(pathToFileURL(own).href)}\nconst base = own.default ?? {}`
  // The specs' own Vitest config (vitest.configs) unless the team's Stryker config names one.
  const extra = [
    vitestConfig ? `vitest: { configFile: ${JSON.stringify(vitestConfig)}, ...(base.vitest ?? {}) }` : null,
    ignore.length ? `ignorePatterns: [...(base.ignorePatterns ?? []), ...${JSON.stringify(ignore)}]` : null,
  ].filter(Boolean).map(x => `, ${x}`).join('')
  return `${load}\nconst fileName = ${JSON.stringify(out)}\nconst run = ${JSON.stringify({ ...(testFiles.length ? { testFiles } : {}), ...(tempDirName ? { tempDirName, cleanTempDir: 'always' } : {}) })}\nexport default { ...base, ...run${extra}, jsonReporter: { ...(base.jsonReporter ?? {}), fileName } }\n`
}

export function runStryker(root, { target, mutate = [target], specs = [], timeoutMs, vitestConfig = null, key = null }) {
  return new Promise(done => {
    const bin = toolScript(root, ['@stryker-mutator/core'], 'stryker')
    if (!bin) return done({ ran: false, error: 'Stryker is not installed' })
    // Stryker's first run must be all green: only the specs under test run, never a red bug spec elsewhere.
    if (!specs.length) return done({ ran: false, error: 'no spec files to run' })
    const sandbox = `.stryker-tmp-qc-${randomBytes(4).toString('hex')}`
    const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-'))
    const out = join(dir, 'mutation.json')
    const cfg = join(dir, 'stryker.config.mjs')
    // The team's Stryker config may name its own Vitest config; then the specs go through testFiles.
    const ownVitest = !!(projectStrykerConfig(root) && /configFile/.test(readFileSync(projectStrykerConfig(root), 'utf8')))
    const base = vitestConfig ?? VITEST_CONFIGS.find(n => existsSync(join(root, n))) ?? null
    // mut-tmp-*: the name setup already git-ignores; removed after every run.
    const scoped = ownVitest ? null : `mut-tmp-stryker-${randomBytes(4).toString('hex')}.vitest.config${base ? extname(base) : '.mjs'}`
    const incremental = incrementalFileOf(root, target)
    const args = ['run', cfg, '--mutate', mutate.join(','), '--testRunner', 'vitest', '--reporters', 'json', '--concurrency', '2', '--incremental', '--incrementalFile', incremental]
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
      try {
        rmSync(dir, { recursive: true, force: true })
        rmSync(join(root, sandbox), { recursive: true, force: true })
        if (scoped) rmSync(join(root, scoped), { force: true })
      } finally { done(r) }
    }
    let child
    try {
      mkdirSync(dirname(incremental), { recursive: true })
      if (scoped) writeFileSync(join(root, scoped), vitestConfigSource(base, specs, key))
      writeFileSync(cfg, strykerConfigSource(root, out, { testFiles: scoped ? [] : specs, tempDirName: sandbox, vitestConfig: scoped, ignore: linkedFolders(root) }))
      child = spawn(process.execPath, [bin, ...args], { cwd: root, detached: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
      untrack = track(child, [dir, join(root, sandbox), ...(scoped ? [join(root, scoped)] : [])])
    } catch (e) {
      return finish({ ran: false, error: `could not start Stryker: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Stryker: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        const json = tryReadJson(out, null)
        if (!json) return finish({ ran: false, error: errorOf(stderr) || (existsSync(out) ? 'Stryker wrote a report that is not valid JSON' : 'Stryker wrote no report') })
        finish({ ran: true, ...parseStrykerReport(json) })
      } catch (e) {
        finish({ ran: false, error: `could not read the Stryker report: ${e.message}` })
      }
    })
  })
}
