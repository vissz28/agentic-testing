// The generic tier's runner: runs specs with the project's own Jest, Mocha or Cypress and reads one
// result per test, the runner contract of the shared checks. Jest's JSON report has the shape Vitest's
// copies; Mocha has a JSON reporter; Cypress gives its results through its Module API. Never writes
// into the project: reports and artifacts go to a temp folder that is always deleted.
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
    const bin = toolScript(root, how.packages, runner)
    if (!bin) return done({ ran: false, error: `${label} is not installed in this project` })
    const dir = mkdtempSync(join(tmpdir(), `qc-${runner}-`))
    const out = join(dir, 'report.json')
    const args = [how.script ?? bin, ...how.args({ files, out, config, testName })]
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
      child = spawn(process.execPath, args, { cwd: root, detached: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
