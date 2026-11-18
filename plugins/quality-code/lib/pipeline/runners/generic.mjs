// Generic runner for Jest, Mocha, node --test and Cypress. Reports go to a temp dir that is always deleted.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFor as unitConfigFor, parseReport as parseJest, titlePattern } from './vitest.mjs'
import { configFor as e2eConfigFor } from './playwright.mjs'
import { timeoutSecondsOf } from '../../config/config.mjs'
import { RUNNERS } from '../../stacks/runners.mjs'
import { kill, toolScript, track } from './tool.mjs'
import { firstLine, toForwardSlashes } from '../../core/text.mjs'
import { tryReadJson } from '../../core/files.mjs'
import { leavesFolder } from '../../core/paths.mjs'

// Cypress reports an unreachable baseUrl only on stdout, before any spec runs.
const APP_DOWN = /could not verify that this server is running:\s*>\s*(\S+)/i
const CYPRESS_RUN = fileURLToPath(new URL('./cypress-run.mjs', import.meta.url))
const NODE_REPORTER = fileURLToPath(new URL('./node-test-reporter.mjs', import.meta.url))

// Loader/setup/env flags the project's test script needs to load specs; everything else is dropped.
const NODE_FLAG_VALUE = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--env-file', '--conditions', '-C'])
const NODE_FLAG = /^(?:--import|--require|-r|--loader|--experimental-loader|--env-file|--conditions|-C|--experimental-[\w-]+|--no-warnings|--enable-source-maps)(?:=|$)/

/** Loader flags from the project's node --test script ("test" checked first). */
export function nodeFlags(root) {
  const scripts = tryReadJson(join(root, 'package.json'), null)?.scripts ?? {}
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

/** Runners may report the realpath of a symlinked root. */
function relativeTo(root) {
  let base = root
  try { base = realpathSync(root) } catch {}
  return p => {
    const s = String(p ?? '')
    if (!isAbsolute(s)) return toForwardSlashes(s)
    const r = relative(base, s)
    return toForwardSlashes(leavesFolder(r) && base !== root ? relative(root, s) : r)
  }
}

export function parseMocha(json, root) {
  const rel = relativeTo(root)
  const id = t => `${t.file}\0${t.fullTitle}`
  const failed = new Map((json?.failures ?? []).map(f => [id(f), f]))
  const pending = new Set((json?.pending ?? []).map(id))
  const all = json?.tests ?? []
  const tests = all.map(t => {
    const status = failed.has(id(t)) ? 'failed' : pending.has(id(t)) ? 'skipped' : 'passed'
    // Mocha has no describe path: derive it from fullTitle minus title.
    const parent = String(t.fullTitle ?? '').slice(0, -String(t.title ?? '').length || undefined).trim()
    return { title: t.title, path: parent ? [parent] : [], file: rel(t.file), status, message: status === 'failed' ? firstLine(failed.get(id(t)).err?.message) : '' }
  })
  // A failed before-all hook has no test of its own: its file never ran.
  const broken = [...failed.values()].filter(f => !all.some(t => id(t) === id(f))).map(f => ({ file: rel(f.file), message: firstLine(f.err?.message) }))
  return { tests, broken }
}

export function parseNodeTest(json, root) {
  const rel = relativeTo(root)
  return {
    tests: (json?.tests ?? []).map(t => ({ title: t.title, path: t.path ?? [], file: rel(t.file), status: t.status, message: firstLine(t.message) })),
    broken: (json?.broken ?? []).map(b => ({ file: rel(b.file), message: firstLine(b.message) || 'the file did not load' })),
  }
}

export function parseCypress(json) {
  if (!Array.isArray(json?.runs)) return { tests: [], broken: [], error: firstLine(json?.message) || 'Cypress ran no spec' }
  const tests = []
  const broken = []
  for (const run of json.runs) {
    const file = toForwardSlashes(run.spec?.relative ?? '')
    if (run.error) broken.push({ file, message: firstLine(run.error) })
    for (const t of run.tests ?? []) {
      const title = Array.isArray(t.title) ? t.title : [String(t.title ?? '')]
      const status = ['passed', 'failed'].includes(t.state) ? t.state : 'skipped'
      tests.push({ title: title.at(-1), path: title.slice(0, -1), file, status, message: status === 'failed' ? firstLine(t.displayError) : '' })
    }
  }
  return { tests, broken }
}

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
      // Inheriting NODE_TEST_CONTEXT makes node --test think it's nested and run nothing.
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
        const json = tryReadJson(out, null)
        const down = APP_DOWN.exec(output)
        if (down) return finish({ ran: false, error: `the app is not reachable at ${down[1]}: start it, then run again` })
        if (!json) return finish({ ran: false, error: firstLine(output) || (existsSync(out) ? `${label} wrote a report that is not valid JSON` : `${label} wrote no report`) })
        const r = how.parse(json, root)
        if (r.error) return finish({ ran: false, error: r.error })
        finish({ ran: true, tests: r.tests, broken: r.broken })
      } catch (e) {
        finish({ ran: false, error: `could not read the ${label} report: ${e.message}` })
      }
    })
  })
}

/** Specs grouped by their config (vitest.configs or playwright.configs). */
export function genericRunner(root, config, runner) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  const configFor = RUNNERS[runner]?.kind === 'e2e' ? e2eConfigFor : unitConfigFor
  // Jest, Mocha and node --test filter by a title regex, so testName may be a list (a mutation round).
  return Object.assign(async ({ files, testName, timeoutMs }) => {
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
  }, { namesFilter: Boolean(HOW[runner]) })
}
