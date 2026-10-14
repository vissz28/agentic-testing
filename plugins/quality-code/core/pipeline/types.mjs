// Type-check step: the project's own tsc, --noEmit, on its tsconfig.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { result } from '../checks/result.mjs'

const TS = /\.(ts|tsx|mts|cts)$/

export function typeCheck(root, config, specs, { timeoutMs = (config.vitest?.timeoutSeconds ?? 300) * 1000 } = {}) {
  const tsconfig = config.vitest?.tsconfig ?? 'tsconfig.json'
  const hasTs = specs.some(s => TS.test(s))
  const has = existsSync(join(root, tsconfig))
  if (!has && !hasTs) return Promise.resolve(result('types', 'pass', 'no TypeScript specs: nothing to type-check', [], { applicable: false }))
  if (!has) return Promise.resolve(result('types', 'not_run', `no ${tsconfig}: cannot type-check the TypeScript specs`))
  const bin = join(root, 'node_modules/.bin/tsc')
  if (!existsSync(bin)) return Promise.resolve(result('types', 'not_run', 'TypeScript is not installed in this project: run npm install'))
  return new Promise(done => {
    const tmp = mkdtempSync(join(tmpdir(), 'qc-tsc-'))
    let out = ''
    let timedOut = false
    let settled = false
    let timer = null
    const finish = r => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { rmSync(tmp, { recursive: true, force: true }) } finally { done(r) }
    }
    let child
    try {
      child = spawn(bin, ['--noEmit', '-p', tsconfig, '--incremental', '--tsBuildInfoFile', join(tmp, 'qc.tsbuildinfo')], { cwd: root, detached: true, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return finish(result('types', 'not_run', `could not start tsc: ${e.message}`))
    }
    const keep = d => { if (out.length < 65536) out += d }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
      finish(result('types', 'not_run', `took longer than ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`}`))
    }, timeoutMs)
    child.on('error', e => finish(result('types', 'not_run', `could not start tsc: ${e.message}`)))
    child.on('close', code => {
      if (timedOut) return
      try {
        if (code === 0) return finish(result('types', 'pass', 'compiles', [], { applicable: true }))
        const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
        const first = lines.find(l => /error TS\d+/.test(l)) ?? lines[0] ?? `tsc exited with ${code}`
        finish(result('types', 'fail', first, [{ kind: 'compile error', detail: first }], { applicable: true }))
      } catch (e) {
        finish(result('types', 'not_run', `could not read the tsc output: ${e.message}`))
      }
    })
  })
}
