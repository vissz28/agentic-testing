// The Stryker runner: mutates one source file with the project's own Stryker (Vitest test runner)
// and reads its JSON mutation report. Stryker's sandbox has to live inside the project (outside it Vitest
// finds no tests), so the runner names one per run and always removes it.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
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
  const total = n.Killed + n.Survived + n.Timeout + n.NoCoverage
  const score = total ? Math.round(((n.Killed + n.Timeout) / total) * 1000) / 10 : null
  return { killed: n.Killed, survived: n.Survived, timeout: n.Timeout, noCoverage: n.NoCoverage, untested, score }
}

// The project's default Vitest config, as Vitest looks for it.
const VITEST_CONFIGS = ['vitest', 'vite'].flatMap(n => ['ts', 'mts', 'js', 'mjs'].map(e => `${n}.config.${e}`))

/**
 * A Vitest config for one Stryker run, written next to the project's (its imports resolve the same):
 * the specs' config with only those specs, and with a key only the key's tests. Without the name filter,
 * Vitest 4 under Stryker's runner ran no test against a mutant and every mutant "survived".
 */
export function vitestConfigSource(base, specs, key) {
  const scope = `include: ${JSON.stringify(specs)}${key ? `, testNamePattern: ${JSON.stringify(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}` : ''}`
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

export function runStryker(root, { target, specs = [], timeoutMs, vitestConfig = null, key = null }) {
  return new Promise(done => {
    const bin = join(root, 'node_modules/.bin/stryker')
    if (!existsSync(bin)) return done({ ran: false, error: 'Stryker is not installed' })
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
    const args = ['run', cfg, '--mutate', target, '--testRunner', 'vitest', '--reporters', 'json', '--concurrency', '2']
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer = null
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        rmSync(dir, { recursive: true, force: true })
        rmSync(join(root, sandbox), { recursive: true, force: true })
        if (scoped) rmSync(join(root, scoped), { force: true })
      } finally { done(r) }
    }
    let child
    try {
      if (scoped) writeFileSync(join(root, scoped), vitestConfigSource(base, specs, key))
      writeFileSync(cfg, strykerConfigSource(root, out, { testFiles: scoped ? [] : specs, tempDirName: sandbox, vitestConfig: scoped, ignore: linkedFolders(root) }))
      child = spawn(bin, args, { cwd: root, detached: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return finish({ ran: false, error: `could not start Stryker: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Stryker: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        let json = null
        try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
        if (!json) return finish({ ran: false, error: errorOf(stderr) || 'Stryker wrote no report' })
        finish({ ran: true, ...parseStrykerReport(json) })
      } catch (e) {
        finish({ ran: false, error: `could not read the Stryker report: ${e.message}` })
      }
    })
  })
}
