// The Vitest runner: runs specs with the project's own Vitest and reads its JSON report.
// Implements the runner contract of the shared checks. Never writes into the project.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { matches } from '../checks/boundary.mjs'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** Vitest matches -t against the full name (describe titles and the test title joined by spaces). */
export const titlePattern = title => `(?:^| )${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

export function configFor(file, config) {
  for (const c of config.vitest?.configs ?? []) if (matches(c.match, file)) return c.config
  return null
}

export function parseReport(json, root) {
  const tests = []
  const broken = []
  for (const tr of json?.testResults ?? []) {
    const file = isAbsolute(tr.name ?? '') ? relative(root, tr.name) : String(tr.name ?? '')
    const ars = tr.assertionResults ?? []
    if (!ars.length && tr.status === 'failed') { broken.push({ file, message: firstLine(tr.message) }); continue }
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
    const child = spawn(bin, args, { cwd: root, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.on('data', d => { if (stderr.length < 65536) stderr += d })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      done(r)
    }
    child.on('error', e => finish({ ran: false, error: `could not start Vitest: ${e.message}` }))
    child.on('close', () => {
      if (timedOut) return finish({ ran: false, error: `took longer than ${Math.round(timeoutMs / 1000)}s` })
      let json = null
      try { json = JSON.parse(readFileSync(out, 'utf8')) } catch {}
      if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Vitest wrote no report' })
      finish({ ran: true, ...parseReport(json, root) })
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
      all.tests.push(...r.tests)
      all.broken.push(...r.broken)
    }
    return all
  }
}
