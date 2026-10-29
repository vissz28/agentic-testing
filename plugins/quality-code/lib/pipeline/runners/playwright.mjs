// The Playwright runner: runs specs with the project's own Playwright and reads its JSON report.
// Implements the runner contract of the shared checks. Never writes into the project: the report
// and Playwright's artifacts go to a temp folder that is always deleted.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { matches } from '../../base/boundary.mjs'
import { originalOf } from '../checks/mutation.mjs'
import { timeoutSecondsOf } from '../../base/config.mjs'
import { findUp, kill, toolScript, track } from './tool.mjs'

const ESC = /[.*+?^${}()|[\]\\]/g
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const firstLine = s => String(s ?? '').replace(ANSI, '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
const REFUSED = /ERR_CONNECTION_REFUSED|ECONNREFUSED/
const LOCAL_BROWSERS = 'node_modules/playwright-core/.local-browsers'

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

const clipText = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * What a red Playwright test can tell: the step it was on (the failing line), the locator it waited for, and the page it was on
 * (URL and some text) when Playwright kept a snapshot (error-context.md). Only what is recorded: nothing is guessed. A timeout with
 * none of it gets a hint on how to record it.
 */
export function contextOf(result, { read = () => null, rel = p => p } = {}) {
  const err = result?.error ?? result?.errors?.[0] ?? {}
  const msg = String(err.message ?? '').replace(ANSI, '')
  const out = {}
  const loc = err.location?.file ? `${rel(err.location.file)}:${err.location.line ?? '?'}` : null
  const step = String(err.snippet ?? '').replace(ANSI, '').split('\n').find(l => /^\s*>\s*\d+\s*\|/.test(l))?.replace(/^\s*>\s*\d+\s*\|\s*/, '').trim()
  if (loc || step) out.at = [loc, step && clipText(step, 100)].filter(Boolean).join(' · ')
  const locator = /(?:^|\n)\s*Locator:\s*(.+)/.exec(msg)?.[1] ?? /waiting for ((?:getBy\w+|locator|frameLocator|page\.)[^\n]*)/.exec(msg)?.[1]
  if (locator) out.locator = clipText(locator.trim(), 140)
  const nav = /navigating to "([^"]+)"/.exec(msg)?.[1]
  const attach = (result?.attachments ?? []).find(a => a?.name === 'error-context' && a.path)
  const snap = attach ? read(attach.path) : null
  if (snap) {
    const url = /(?:page url|url)\s*[:=]\s*(\S+)/i.exec(snap)?.[1] ?? nav
    if (url) out.url = url.replace(/[`'")\],]+$/, '')
    const words = [...snap.matchAll(/(?:heading|button|link|text|textbox|cell|tab|option)\s+"([^"]{2,80})"/g)].map(m => m[1])
    const text = [...new Set(words)].join(' · ')
    if (text) out.text = clipText(text, 200)
  } else if (nav) out.url = nav
  if (!out.url && !out.text && /timeout/i.test(msg)) out.hint = "No page was recorded. Set use: { trace: 'retain-on-failure' } in the Playwright config (it also writes the page snapshot) and run again."
  return Object.keys(out).length ? out : null
}

/** { tests, broken, error? }: one result per file and title path, merged across projects. */
export function parseReport(json, root, { read } = {}) {
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
      const row = merged.get(id) ?? { title: spec.title, path, file, runs: [] }
      for (const t of spec.tests ?? []) {
        const last = (t.results ?? []).at(-1) ?? {}
        const status = statusOf(t)
        const message = status === 'failed' ? firstLine(last.error?.message ?? last.errors?.[0]?.message) || String(last.status ?? 'failed') : ''
        row.runs.push({ project: t.projectName ?? '', status, message, context: status === 'failed' ? contextOf(last, { read, rel: p => fileOf(p) }) : null })
      }
      merged.set(id, row)
    }
    for (const s of suite.suites ?? []) walk(s, [...path, s.title])
  }
  for (const s of json?.suites ?? []) walk(s, [])
  const tests = [...merged.values()].map(({ title, path, file, runs }) => {
    const several = new Set(runs.map(r => r.project)).size > 1
    const failed = runs.find(r => r.status === 'failed')
    const status = failed ? 'failed' : runs.some(r => r.status === 'passed') ? 'passed' : 'skipped'
    const message = failed ? `${several && failed.project ? `[${failed.project}] ` : ''}${failed.message}` : ''
    return { title, path, file, status, message, ...(failed?.context ? { context: failed.context } : {}) }
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
    const bin = toolScript(root, ['@playwright/test', 'playwright'], 'playwright')
    if (!bin) return done({ ran: false, error: 'Playwright is not installed in this project' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-playwright-'))
    const out = join(dir, 'report.json')
    const args = ['test', ...files.map(filePattern), '--reporter=json', '--retries=0', '--output', join(dir, 'output')]
    if (config) args.push('--config', config)
    for (const p of projects) args.push('--project', p)
    if (testName !== undefined) args.push('-g', titlePattern(testName))
    // CI is left as it is: Playwright configs often read it to stop reusing a running dev server.
    const env = { ...process.env, NO_COLOR: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: out }
    delete env.FORCE_COLOR
    // Browsers installed with PLAYWRIGHT_BROWSERS_PATH=0 live in node_modules, where only that setting finds them.
    if (env.PLAYWRIGHT_BROWSERS_PATH === undefined && findUp(root, LOCAL_BROWSERS)) env.PLAYWRIGHT_BROWSERS_PATH = '0'
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
      child = spawn(process.execPath, [bin, ...args], { cwd: root, detached: true, windowsHide: true, env, stdio: ['ignore', 'ignore', 'pipe'] })
      untrack = track(child, [dir])
    } catch (e) {
      return finish({ ran: false, error: `could not start Playwright: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      kill(child)
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Playwright: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        let json = null
        try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
        if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Playwright wrote no report' })
        const r = parseReport(json, root, { read: p => { try { return readFileSync(p, 'utf8') } catch { return null } } })
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
