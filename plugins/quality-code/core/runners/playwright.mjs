// The Playwright runner: runs specs with the project's own Playwright and reads its JSON report.
// Implements the runner contract of the shared checks. Never writes into the project: the report
// and Playwright's artifacts go to a temp folder that is always deleted.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { matches } from '../checks/boundary.mjs'
import { originalOf } from '../checks/mutation.mjs'
import { timeoutSecondsOf } from '../config.mjs'

const ESC = /[.*+?^${}()|[\]\\]/g
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const firstLine = s => String(s ?? '').replace(ANSI, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const REFUSED = /ERR_CONNECTION_REFUSED|ECONNREFUSED/

/** Playwright reads a file argument as a regular expression over the path: anchor it to whole segments. */
export const filePattern = file => `(?:^|/)${String(file).split('\\').join('/').replace(ESC, '\\$&')}$`

/** -g sees the full title (project, file, describe titles, title) with the tags appended. */
export const titlePattern = title => `(?:^| )${String(title).replace(ESC, '\\$&')}(?: @\\S+)*$`

export function configFor(file, config) {
  for (const c of config.playwright?.configs ?? []) if (matches(c.match, originalOf(file))) return c.config
  return null
}

function statusOf(t) {
  if (t.status === 'skipped') return 'skipped'
  if (t.status === 'expected') return t.expectedStatus === 'skipped' ? 'skipped' : 'passed'
  return 'failed'
}

/** { tests, broken, error? }: one result per file and title path, merged across projects. */
export function parseReport(json, root) {
  let base = root
  try { base = realpathSync(root) } catch {}
  const rel = abs => {
    const r = relative(base, abs)
    return r.startsWith('..') && base !== root ? relative(root, abs) : r
  }
  const rootDir = typeof json?.config?.rootDir === 'string' && json.config.rootDir ? json.config.rootDir : root
  const fileOf = f => {
    const p = String(f ?? '')
    return rel(isAbsolute(p) ? p : resolve(rootDir, p)).split('\\').join('/')
  }
  const merged = new Map()
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      const file = fileOf(spec.file ?? suite.file)
      const id = `${file}\0${[...path, spec.title].join('\0')}`
      const row = merged.get(id) ?? { title: spec.title, file, runs: [] }
      for (const t of spec.tests ?? []) {
        const last = (t.results ?? []).at(-1) ?? {}
        const status = statusOf(t)
        const message = status === 'failed' ? firstLine(last.error?.message ?? last.errors?.[0]?.message) || String(last.status ?? 'failed') : ''
        row.runs.push({ project: t.projectName ?? '', status, message })
      }
      merged.set(id, row)
    }
    for (const s of suite.suites ?? []) walk(s, [...path, s.title])
  }
  for (const s of json?.suites ?? []) walk(s, [])
  const tests = [...merged.values()].map(({ title, file, runs }) => {
    const several = new Set(runs.map(r => r.project)).size > 1
    const failed = runs.find(r => r.status === 'failed')
    const status = failed ? 'failed' : runs.some(r => r.status === 'passed') ? 'passed' : 'skipped'
    const message = failed ? `${several && failed.project ? `[${failed.project}] ` : ''}${failed.message}` : ''
    return { title, file, status, message }
  })
  const broken = []
  let error
  for (const e of json?.errors ?? []) {
    if (e?.location?.file) {
      const file = fileOf(e.location.file)
      if (!broken.some(b => b.file === file)) broken.push({ file, message: firstLine(e.message) })
    } else if (error === undefined) error = firstLine(e?.message) || 'Playwright reported an error'
  }
  const out = { tests, broken }
  if (error !== undefined && !tests.length && !broken.length) out.error = error
  return out
}

export function runPlaywright(root, files, { config = null, projects = [], testName, timeoutMs }) {
  return new Promise(done => {
    const bin = join(root, 'node_modules/.bin/playwright')
    if (!existsSync(bin)) return done({ ran: false, error: 'Playwright is not installed in this project: run npm install' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-playwright-'))
    const out = join(dir, 'report.json')
    const args = ['test', ...files.map(filePattern), '--reporter=json', '--retries=0', '--output', join(dir, 'output')]
    if (config) args.push('--config', config)
    for (const p of projects) args.push('--project', p)
    if (testName !== undefined) args.push('-g', titlePattern(testName))
    // CI is left as it is: Playwright configs often read it to stop reusing a running dev server.
    const env = { ...process.env, NO_COLOR: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out }
    delete env.FORCE_COLOR
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer = null
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { rmSync(dir, { recursive: true, force: true }) } finally { done(r) }
    }
    let child
    try {
      child = spawn(bin, args, { cwd: root, detached: true, env, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return finish({ ran: false, error: `could not start Playwright: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Playwright: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        let json = null
        try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
        if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Playwright wrote no report' })
        const r = parseReport(json, root)
        if (r.error) return finish({ ran: false, error: r.error })
        const failed = r.tests.filter(t => t.status === 'failed')
        // Every test failed on a refused connection: the app is down, which says nothing about the tests.
        if (failed.length && !r.tests.some(t => t.status === 'passed') && failed.every(t => REFUSED.test(t.message))) {
          return finish({ ran: false, error: `the app is not reachable: ${failed[0].message.replace(/^\[[^\]]*\] /, '')}` })
        }
        finish({ ran: true, tests: r.tests, broken: r.broken })
      } catch (e) {
        finish({ ran: false, error: `could not read the Playwright report: ${e.message}` })
      }
    })
  })
}

export function playwrightRunner(root, config) {
  const defaultMs = timeoutSecondsOf(config) * 1000
  const projects = config.playwright?.projects ?? []
  return async ({ files, testName, timeoutMs }) => {
    const groups = new Map()
    for (const f of files) {
      const c = configFor(f, config)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const all = { ran: true, tests: [], broken: [] }
    for (const [c, fs] of groups) {
      const r = await runPlaywright(root, fs, { config: c, projects, testName, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], error: r.error }
      const want = new Set(fs.map(f => normalize(f)))
      all.tests.push(...r.tests.filter(t => want.has(normalize(t.file))))
      all.broken.push(...r.broken.filter(b => want.has(normalize(b.file))))
    }
    return all
  }
}
