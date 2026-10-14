// The Stryker runner: mutates one source file with the project's own Stryker (Vitest test runner)
// and reads its JSON mutation report. Never writes into the project.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''

/** Counts the mutants of a mutation-testing-report-schema report. CompileError, RuntimeError, Ignored and Pending do not count. */
export function parseStrykerReport(json) {
  const n = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0 }
  for (const file of Object.values(json?.files ?? {})) {
    for (const m of file?.mutants ?? []) if (m && Object.hasOwn(n, m.status)) n[m.status]++
  }
  const total = n.Killed + n.Survived + n.Timeout + n.NoCoverage
  const score = total ? Math.round((n.Killed / total) * 1000) / 10 : null
  return { killed: n.Killed, survived: n.Survived, timeout: n.Timeout, noCoverage: n.NoCoverage, score }
}

export function runStryker(root, { target, timeoutMs }) {
  return new Promise(done => {
    const bin = join(root, 'node_modules/.bin/stryker')
    if (!existsSync(bin)) return done({ ran: false, error: 'Stryker is not installed' })
    const dir = mkdtempSync(join(tmpdir(), 'qc-stryker-'))
    const out = join(dir, 'mutation.json')
    const args = ['run', '--mutate', target, '--testRunner', 'vitest', '--reporters', 'json',
      '--jsonReporter.fileName', out, '--tempDirName', join(dir, 'stryker-tmp'), '--concurrency', '2']
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
        if (!json) return finish({ ran: false, error: firstLine(stderr) || 'Stryker wrote no report' })
        finish({ ran: true, ...parseStrykerReport(json) })
      } catch (e) {
        finish({ ran: false, error: `could not read the Stryker report: ${e.message}` })
      }
    })
  })
}
