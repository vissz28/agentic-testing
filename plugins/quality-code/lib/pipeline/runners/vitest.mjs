// Vitest runner via the JSON reporter. Writes nothing into the project.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_ENV } from '../live.mjs'
import { matches } from '../boundary.mjs'
import { originalOf } from '../checks/mutation.mjs'
import { timeoutSecondsOf } from '../../config/config.mjs'
import { kill, toolScript, track } from './tool.mjs'
import { escapeRegExp, firstLine, toForwardSlashes } from '../../core/text.mjs'
import { tryReadJson } from '../../core/files.mjs'
import { leavesFolder } from '../../core/paths.mjs'
import { ERRORS_ENV } from './vitest-errors-reporter.mjs'

/** -t matches the full name: describe titles and test title joined by spaces. */
/** Several titles (a mutation round) match any of them. */
export const titlePattern = title => `(?:^| )${Array.isArray(title) ? `(?:${title.map(escapeRegExp).join('|')})` : escapeRegExp(title)}$`

const LIVE_REPORTER = fileURLToPath(new URL('./live-reporter.mjs', import.meta.url))
const ERRORS_REPORTER = fileURLToPath(new URL('./vitest-errors-reporter.mjs', import.meta.url))

export function configFor(file, config) {
  for (const c of config.vitest?.configs ?? []) if (matches(c.match, originalOf(file))) return c.config
  return null
}

export function parseReport(json, root) {
  const tests = []
  const broken = []
  let base = root
  try { base = realpathSync(root) } catch {}
  const rel = name => {
    const r = relative(base, name)
    return leavesFolder(r) && base !== root ? relative(root, name) : r
  }
  for (const tr of json?.testResults ?? []) {
    // Windows reports backslashes; normalizeSpec uses forward slashes.
    const file = toForwardSlashes(isAbsolute(tr.name ?? '') ? rel(tr.name) : String(tr.name ?? ''))
    const ars = tr.assertionResults ?? []
    if (tr.status === 'failed' && !ars.some(a => a.status === 'failed')) broken.push({ file, message: firstLine(tr.message) })
    for (const a of ars) {
      const status = ['passed', 'failed'].includes(a.status) ? a.status : 'skipped'
      tests.push({ title: a.title, path: a.ancestorTitles ?? [], file, status, message: status === 'failed' ? firstLine(a.failureMessages?.[0]) : '' })
    }
  }
  return { tests, broken }
}

/**
 * Why a run whose JSON report says every test passed is still not green: an error after a test ended
 * (an assertion in a promise not awaited) fails the run but is not in the report. The errors reporter lists them;
 * with no list (a Vitest too old for its hooks), a non-zero exit is all there is to go on.
 */
export function unhandled(errors, code) {
  if (Array.isArray(errors)) return errors.length ? `unhandled error: ${errors[0].name}: ${errors[0].message}` : null
  return code ? `Vitest exited with code ${code} although no test failed: an unhandled error (an assertion in a promise that is not awaited?)` : null
}

export function runVitest(root, files, { config = null, testName, timeoutMs, live = null }) {
  return new Promise(done => {
    const bin = toolScript(root, ['vitest'], 'vitest')
    if (!bin) return done({ ran: false, error: 'Vitest is not installed in this project' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-vitest-'))
    const out = join(dir, 'report.json')
    const errorsFile = join(dir, 'errors.json')
    // Coverage off: it is never read here, and a threshold on this partial run would fail the exit code.
    const args = ['run', ...files, '--reporter=json', `--outputFile=${out}`, `--reporter=${ERRORS_REPORTER}`, '--retry=0', '--coverage.enabled=false']
    if (config) args.push('--config', config)
    if (testName !== undefined) args.push('-t', titlePattern(testName))
    // live: the progress file the band reads; counts each test as it ends.
    if (live) args.push(`--reporter=${LIVE_REPORTER}`)
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
      try { rmSync(dir, { recursive: true, force: true }) } finally { done(r) }
    }
    let child
    try {
      child = spawn(process.execPath, [bin, ...args], { cwd: root, detached: true, windowsHide: true, env: { ...process.env, NO_COLOR: '1', CI: '1', [ERRORS_ENV]: errorsFile, ...(live ? { [LIVE_ENV]: live } : {}) }, stdio: ['ignore', 'ignore', 'pipe'] })
      untrack = track(child, [dir])
    } catch (e) {
      return finish({ ran: false, error: `could not start Vitest: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Vitest: ${e.message}` }))
    child.on('close', code => {
      if (timedOut) return
      try {
        const json = tryReadJson(out, null)
        if (!json) return finish({ ran: false, error: firstLine(stderr) || (existsSync(out) ? 'Vitest wrote a report that is not valid JSON' : 'Vitest wrote no report') })
        const r = parseReport(json, root)
        const why = unhandled(tryReadJson(errorsFile, null), code)
        if (why && !r.broken.length && r.tests.some(t => t.status === 'passed') && !r.tests.some(t => t.status === 'failed')) {
          r.broken = files.map(file => ({ file: toForwardSlashes(file), message: why }))
        }
        finish({ ran: true, ...r })
      } catch (e) {
        finish({ ran: false, error: `could not read the Vitest report: ${e.message}` })
      }
    })
  })
}

export function vitestRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  // testName may be a list (a mutation round): the title filter is a regex.
  return Object.assign(async ({ files, testName, timeoutMs, live }) => {
    const groups = new Map()
    for (const f of files) {
      const c = configFor(f, config)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const all = { ran: true, tests: [], broken: [] }
    for (const [c, fs] of groups) {
      const r = await runVitest(root, fs, { config: c, testName, timeoutMs: timeoutMs ?? defaultMs, live })
      if (!r.ran) return { ran: false, tests: [], error: r.error }
      const want = new Set(fs.map(f => normalize(f)))
      all.tests.push(...r.tests.filter(t => want.has(normalize(t.file))))
      all.broken.push(...r.broken.filter(b => want.has(normalize(b.file))))
    }
    return all
  }, { namesFilter: true })
}
