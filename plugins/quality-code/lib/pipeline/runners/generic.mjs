// The generic tier's runner: runs specs with the project's own Jest, Mocha, node --test or Cypress and
// reads one result per test, the runner contract of the shared checks. Jest's JSON report has the shape
// Vitest's copies; Mocha has a JSON reporter; node --test takes the plugin's own reporter; Cypress gives
// its results through its Module API. Never writes into the project: reports and artifacts go to a temp
// folder that is always deleted.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFor as unitConfigFor, parseReport as parseJest, titlePattern } from './vitest.mjs'
import { configFor as e2eConfigFor } from './playwright.mjs'
import { timeoutSecondsOf } from '../../base/config.mjs'
import { RUNNERS } from '../../base/runners.mjs'
import { kill, toolScript, track } from './tool.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
// Cypress checks its baseUrl before any spec and, when the app is down, says so only on its output.
const APP_DOWN = /could not verify that this server is running:\s*>\s*(\S+)/i
const CYPRESS_RUN = fileURLToPath(new URL('./cypress-run.mjs', import.meta.url))
const NODE_REPORTER = fileURLToPath(new URL('./node-test-reporter.mjs', import.meta.url))

// The node flags a test script may need to load its specs (a TypeScript loader, a setup file, an env
// file), each with its value when it takes one. Every other flag of the script is left out.
const NODE_FLAG_VALUE = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--env-file', '--conditions', '-C'])
const NODE_FLAG = /^(?:--import|--require|-r|--loader|--experimental-loader|--env-file|--conditions|-C|--experimental-[\w-]+|--no-warnings|--enable-source-maps)(?:=|$)/

/** The loading flags of the project's node --test script (its "test" script first), so the specs load as they do there. */
export function nodeFlags(root) {
  let scripts = {}
  try { scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {} } catch {}
  const all = Object.entries(scripts).sort(([a], [b]) => (a === 'test' ? -1 : b === 'test' ? 1 : 0)).map(([, s]) => String(s))
  for (const script of all) {
    const command = script.split(/&&|\|\||;|\|/).map(c => c.trim().split(/\s+/)).find(t => t[0] === 'node' && t.includes('--test'))
    if (!command) continue
    const flags = []
    for (let i = 1; i < command.length; i++) {
      if (!NODE_FLAG.test(command[i])) continue
      flags.push(command[i])
      if (NODE_FLAG_VALUE.has(command[i]) && command[i + 1]) flags.push(command[++i])
    }
    return flags
  }
  return []
}

/** A path the runner reported, relative to the project (it may report the real path of a symlinked root). */
function relativeTo(root) {
  let base = root
  try { base = realpathSync(root) } catch {}
  return p => {
    const s = String(p ?? '')
    if (!isAbsolute(s)) return s.split('\\').join('/')
    const r = relative(base, s)
    return (r.startsWith('..') && base !== root ? relative(root, s) : r).split('\\').join('/')
  }
}

/** Mocha's JSON reporter: every test with its full title and file; failures and pending name the red and the skipped. */
export function parseMocha(json, root) {
  const rel = relativeTo(root)
  const id = t => `${t.file}\0${t.fullTitle}`
  const failed = new Map((json?.failures ?? []).map(f => [id(f), f]))
  const pending = new Set((json?.pending ?? []).map(id))
  const all = json?.tests ?? []
  const tests = all.map(t => {
    const status = failed.has(id(t)) ? 'failed' : pending.has(id(t)) ? 'skipped' : 'passed'
    // Mocha names no group by itself: the full title less the test's own is its describe path.
    const parent = String(t.fullTitle ?? '').slice(0, -String(t.title ?? '').length || undefined).trim()
    return { title: t.title, path: parent ? [parent] : [], file: rel(t.file), status, message: status === 'failed' ? firstLine(failed.get(id(t)).err?.message) : '' }
  })
  // A failed hook (before all) is a failure with no test of its own: the tests of its file never ran.
  const broken = [...failed.values()].filter(f => !all.some(t => id(t) === id(f))).map(f => ({ file: rel(f.file), message: firstLine(f.err?.message) }))
  return { tests, broken }
}

/** The plugin's node --test reporter: { tests, broken } with absolute files. */
export function parseNodeTest(json, root) {
  const rel = relativeTo(root)
  return {
    tests: (json?.tests ?? []).map(t => ({ title: t.title, path: t.path ?? [], file: rel(t.file), status: t.status, message: firstLine(t.message) })),
    broken: (json?.broken ?? []).map(b => ({ file: rel(b.file), message: firstLine(b.message) || 'the file did not load' })),
  }
}

/** Cypress's Module API results: one run per spec, each test with its title path and state. */
export function parseCypress(json) {
  if (!Array.isArray(json?.runs)) return { tests: [], broken: [], error: firstLine(json?.message) || 'Cypress ran no spec' }
  const tests = []
  const broken = []
  for (const run of json.runs) {
    const file = String(run.spec?.relative ?? '').split('\\').join('/')
    if (run.error) broken.push({ file, message: firstLine(run.error) })
    for (const t of run.tests ?? []) {
      const title = Array.isArray(t.title) ? t.title : [String(t.title ?? '')]
      const status = t.state === 'passed' ? 'passed' : t.state === 'failed' ? 'failed' : 'skipped'
      tests.push({ title: title.at(-1), path: title.slice(0, -1), file, status, message: status === 'failed' ? firstLine(t.displayError) : '' })
    }
  }
  return { tests, broken }
}

// How each runner runs some specs: the package that must be installed, the script to start, its
// arguments, and how to read the report it writes to `out`.
export const HOW = Object.freeze({
  jest: {
    packages: ['jest'],
    args: ({ files, out, config, testName }) => ['--ci', '--json', `--outputFile=${out}`, ...(config ? ['--config', config] : []), ...(testName !== undefined ? ['-t', titlePattern(testName)] : []), '--runTestsByPath', ...files],
    parse: parseJest,
  },
  mocha: {
    packages: ['mocha'],
    args: ({ files, out, config, testName }) => [...files, '--reporter', 'json', '--reporter-option', `output=${out}`, ...(config ? ['--config', config] : []), ...(testName !== undefined ? ['--grep', titlePattern(testName)] : [])],
    parse: parseMocha,
  },
  // Node's own runner: no package, the plugin's reporter, and the loading flags of the project's script.
  node: {
    packages: null,
    args: ({ files, out, testName, root }) => [...nodeFlags(root), '--test', `--test-reporter=${NODE_REPORTER}`, `--test-reporter-destination=${out}`, ...(testName !== undefined ? [`--test-name-pattern=${titlePattern(testName)}`] : []), ...files],
    parse: parseNodeTest,
  },
  // ponytail: Cypress has no title filter without the @cypress/grep plugin, so a mutant runs its whole spec file.
  cypress: {
    packages: ['cypress'],
    script: CYPRESS_RUN,
    args: ({ files, out, config }) => [out, config ?? '', ...files],
    parse: json => parseCypress(json),
  },
})

export function runGeneric(root, runner, files, { config = null, testName, timeoutMs }) {
  const how = HOW[runner]
  const label = RUNNERS[runner]?.label ?? runner
  return new Promise(done => {
    if (!how) return done({ ran: false, error: `no runner for ${runner}` })
    // node --test is Node itself: nothing to install.
    const bin = how.packages ? toolScript(root, how.packages, runner) : null
    if (how.packages && !bin) return done({ ran: false, error: `${label} is not installed in this project` })
    const dir = mkdtempSync(join(tmpdir(), `qc-${runner}-`))
    const out = join(dir, 'report.json')
    const args = [...(how.script ? [how.script] : bin ? [bin] : []), ...how.args({ files, out, config, testName, root })]
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
    let child
    try {
      // A run started from inside a node:test process must not inherit its marker: node --test would
      // take itself for a nested run and run nothing.
      const env = { ...process.env, NO_COLOR: '1', CI: '1' }
      delete env.NODE_TEST_CONTEXT
      child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      untrack = track(child, [dir])
    } catch (e) {
      return finish({ ran: false, error: `could not start ${label}: ${e.message}` })
    }
    const keep = d => { if (output.length < 65536) output += d }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start ${label}: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        let json = null
        try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
        const down = APP_DOWN.exec(output)
        if (down) return finish({ ran: false, error: `the app is not reachable at ${down[1]}: start it, then run again` })
        if (!json) return finish({ ran: false, error: firstLine(output) || `${label} wrote no report` })
        const r = how.parse(json, root)
        if (r.error) return finish({ ran: false, error: r.error })
        finish({ ran: true, tests: r.tests, broken: r.broken })
      } catch (e) {
        finish({ ran: false, error: `could not read the ${label} report: ${e.message}` })
      }
    })
  })
}

/** The runner contract for a generic runner: specs grouped by the config that runs them (vitest.configs or playwright.configs). */
export function genericRunner(root, config, runner) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  const configFor = RUNNERS[runner]?.kind === 'e2e' ? e2eConfigFor : unitConfigFor
  return async ({ files, testName, timeoutMs }) => {
    const groups = new Map()
    for (const f of files) {
      const c = configFor(f, config)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const all = { ran: true, tests: [], broken: [] }
    for (const [c, fs] of groups) {
      const r = await runGeneric(root, runner, fs, { config: c, testName, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], error: r.error }
      const want = new Set(fs.map(f => normalize(f)))
      all.tests.push(...r.tests.filter(t => want.has(normalize(t.file))))
      all.broken.push(...r.broken.filter(b => want.has(normalize(b.file))))
    }
    return all
  }
}
