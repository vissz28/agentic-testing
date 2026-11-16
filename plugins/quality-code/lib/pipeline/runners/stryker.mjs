// Stryker runner (Vitest). The sandbox must be inside the project or Vitest finds no tests, so it's always removed.
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

// stderr starts with a stack frame; show the named error instead.
const errorOf = s => String(s ?? '').match(/\b[A-Za-z]*Error: [^\n]+/)?.[0] ?? firstLine(s)

/** Tracked folder symlinks: Stryker can't copy them into its sandbox. */
export function linkedFolders(root) {
  let out = ''
  try { out = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }) } catch { return [] }
  return out.split('\n').filter(l => l.startsWith('120000 ')).map(l => l.split('\t')[1]).filter(p => {
    try { return statSync(join(root, p)).isDirectory() } catch { return false }
  }).map(p => `/${p}`)
}

/**
 * Score on covered code only, like Stryker's: timeouts count as killed; NoCoverage is reported, not scored,
 * since a ticket's tests cover only part of the file. untested: survivors no test ran on.
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

/** 1-based line spans of the named functions, via the project's TypeScript; null without TypeScript. */
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
 * Incremental results per target, under node_modules/.cache so it's never committed.
 * ponytail: a change to a test helper or seed file alone is not seen; delete the file to start over.
 */
export const incrementalFileOf = (root, target) => join(root, 'node_modules', '.cache', 'quality-code', `stryker-${createHash('sha1').update(target).digest('hex').slice(0, 12)}.json`)

const VITEST_CONFIGS = ['vitest', 'vite'].flatMap(n => ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(e => `${n}.config.${e}`))

/**
 * Scoped Vitest config, written next to the project's so imports resolve the same.
 * testNamePattern is required: without it Vitest 4 under Stryker ran no tests and every mutant "survived".
 */
export function vitestConfigSource(base, specs, key) {
  const scope = `include: ${JSON.stringify(specs)}${key ? `, testNamePattern: ${JSON.stringify(escapeRegExp(key))}` : ''}`
  if (!base) return `export default { test: { ${scope} } }\n`
  // No top-level await: Vite bundles configs as CJS without "type": "module".
  return `import own from ${JSON.stringify(`./${base}`)}\nconst scoped = base => ({ ...base, test: { ...base.test, ${scope} } })\nexport default typeof own === 'function' ? env => Promise.resolve(own(env)).then(scoped) : scoped(own)\n`
}

// In Stryker's lookup order.
const CONFIG_NAMES = ['', '.'].flatMap(p => ['.conf', '.config'].flatMap(s => ['json', 'js', 'mjs', 'cjs'].map(e => `${p}stryker${s}.${e}`)))

export function projectStrykerConfig(root) {
  for (const name of CONFIG_NAMES) if (existsSync(join(root, name))) return join(root, name)
  return null
}

/** Stryker has no CLI flag for the report path, so wrap the project's config in a temp one. */
export function strykerConfigSource(root, out, { testFiles = [], tempDirName, vitestConfig = null, ignore = [] } = {}) {
  const own = projectStrykerConfig(root)
  const load = !own ? 'const base = {}'
    : extname(own) === '.json' ? `import { readFileSync } from 'node:fs'\nconst base = JSON.parse(readFileSync(${JSON.stringify(own)}, 'utf8'))`
      : `import * as own from ${JSON.stringify(pathToFileURL(own).href)}\nconst base = own.default ?? {}`
  // The team's Stryker config wins if it names a Vitest config.
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
    // Stryker needs an all-green first run: run only the specs under test.
    if (!specs.length) return done({ ran: false, error: 'no spec files to run' })
    const sandbox = `.stryker-tmp-qc-${randomBytes(4).toString('hex')}`
    const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-'))
    const out = join(dir, 'mutation.json')
    const cfg = join(dir, 'stryker.config.mjs')
    // If the team's config names a Vitest config, pass specs via testFiles instead.
    const ownVitest = !!(projectStrykerConfig(root) && /configFile/.test(readFileSync(projectStrykerConfig(root), 'utf8')))
    const base = vitestConfig ?? VITEST_CONFIGS.find(n => existsSync(join(root, n))) ?? null
    // mut-tmp-* is git-ignored by setup; removed after every run.
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
