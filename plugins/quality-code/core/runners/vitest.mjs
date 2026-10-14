// The Vitest runner: runs specs with the project's own Vitest and reads its JSON report.
// Implements the runner contract of the shared checks. Never writes into the project.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { matches } from '../checks/boundary.mjs'
import { originalOf } from '../checks/mutation.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** Vitest matches -t against the full name (describe titles and the test title joined by spaces). */
export const titlePattern = title => `(?:^| )${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

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
    return r.startsWith('..') && base !== root ? relative(root, name) : r
  }
  for (const tr of json?.testResults ?? []) {
    const file = isAbsolute(tr.name ?? '') ? rel(tr.name) : String(tr.name ?? '')
    const ars = tr.assertionResults ?? []
    if (tr.status === 'failed' && !ars.some(a => a.status === 'failed')) broken.push({ file, message: firstLine(tr.message) })
    for (const a of ars) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped'
      tests.push({ title: a.title, file, status, message: status === 'failed' ? firstLine(a.failureMessages?.[0]) : '' })
    }
  }
  return { tests, broken }
}

export function runVitest(root, files, { config = null, testName, timeoutMs }) {
  return new Promise(done => {
    const bin = join(root, 'node_modules/.bin/vitest')
    if (!existsSync(bin)) return done({ ran: false, error: 'Vitest is not installed in this project: run npm install' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-vitest-'))
    const out = join(dir, 'report.json')
    const args = ['run', ...files, '--reporter=json', `--outputFile=${out}`, '--retry=0']
    if (config) args.push('--config', config)
    if (testName !== undefined) args.push('-t', titlePattern(testName))
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
      child = spawn(bin, args, { cwd: root, detached: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return finish({ ran: false, error: `could not start Vitest: ${e.message}` })
    }
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
      finish({ ran: false, error: `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}` })
    }, timeoutMs)
    child.on('error', e => finish({ ran: false, error: `could not start Vitest: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return
      try {
        let json = null
        try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
        if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Vitest wrote no report' })
        finish({ ran: true, ...parseReport(json, root) })
      } catch (e) {
        finish({ ran: false, error: `could not read the Vitest report: ${e.message}` })
      }
    })
  })
}

export function vitestRunner(root, config) {
  const defaultMs = (config.vitest?.timeoutSeconds ?? 300) * 1000
  return async ({ files, testName, timeoutMs }) => {
    const groups = new Map()
    for (const f of files) {
      const c = configFor(f, config)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const all = { ran: true, tests: [], broken: [] }
    for (const [c, fs] of groups) {
      const r = await runVitest(root, fs, { config: c, testName, timeoutMs: timeoutMs ?? defaultMs })
      if (!r.ran) return { ran: false, tests: [], error: r.error }
      const want = new Set(fs.map(f => normalize(f)))
      all.tests.push(...r.tests.filter(t => want.has(normalize(t.file))))
      all.broken.push(...r.broken.filter(b => want.has(normalize(b.file))))
    }
    return all
  }
}
