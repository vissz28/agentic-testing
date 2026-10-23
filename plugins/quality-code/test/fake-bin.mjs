// Installs a fake tool: the package that has the bin <name> (vitest, playwright, stryker, tsc), in
// <dir>/node_modules, as the runners look for it. Its behaviour comes from
// <dir>/.fake-<name>.json: { report?, reportFor?: { [config or 'default']: report }, exit?, stderr?,
// stdout?, sleepMs?, grandchild?, mkdir? (Stryker: create the sandbox its temp config names), mutantReport?: { title, status } }. With mutantReport, a call with -t (a mutant run) reports
// that one test with that status for the file in argv[1]. With grandchild, a long-lived child process is started and its pid
// written to <dir>/.fake-<name>.grandchild. Each call's argv is appended as one JSON line to <dir>/.fake-<name>.calls,
// and the report is written to the --outputFile path (or, for Stryker, the fileName its temp config file names,
// or the PLAYWRIGHT_JSON_OUTPUT_NAME path, for Playwright, or Mocha's output= reporter option). With -g (a Playwright mutant run) and mutantReport,
// the report is Playwright-shaped, for the file whose pattern is argv[1]. With recordEnv, each call's CI,
// FORCE_COLOR, NO_COLOR, PLAYWRIGHT_BROWSERS_PATH and report path are appended as one JSON line to <dir>/.fake-<name>.env.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

const script = name => `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const dir = process.cwd()
const spec = JSON.parse(fs.readFileSync(path.join(dir, '.fake-${name}.json'), 'utf8'))
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, '.fake-${name}.calls'), JSON.stringify(args) + '\\n')
if (spec.grandchild) {
  const gc = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: false, stdio: 'ignore' })
  fs.writeFileSync(path.join(dir, '.fake-${name}.grandchild'), String(gc.pid))
}
const cfg = args[0] === 'run' && /\\.mjs$/.test(args[1] || '') ? args[1] : ''
const fromCfg = cfg ? JSON.parse((/^const fileName = (".*")$/m.exec(fs.readFileSync(cfg, 'utf8')) || [0, '""'])[1]) : ''
if (cfg && spec.mkdir) {
  const run = JSON.parse((/^const run = (.*)$/m.exec(fs.readFileSync(cfg, 'utf8')) || [0, '{}'])[1])
  if (run.tempDirName) fs.mkdirSync(path.join(dir, run.tempDirName, 'sandbox'), { recursive: true })
}
const out = (args.find(a => a.startsWith('--outputFile=')) || '').slice(13) || (args.find(a => a.startsWith('output=')) || '').slice(7) || fromCfg || process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || ''
if (spec.recordEnv) {
  const e = process.env
  fs.appendFileSync(path.join(dir, '.fake-${name}.env'), JSON.stringify({ CI: e.CI ?? null, FORCE_COLOR: e.FORCE_COLOR ?? null, NO_COLOR: e.NO_COLOR ?? null, PLAYWRIGHT_BROWSERS_PATH: e.PLAYWRIGHT_BROWSERS_PATH ?? null, report: out }) + '\\n')
}
const ci = args.indexOf('--config')
let report = (spec.reportFor && spec.reportFor[ci >= 0 ? args[ci + 1] : 'default']) || spec.report
if (args.includes('-t') && spec.mutantReport) {
  report = { testResults: [{ name: path.resolve(dir, args[1]), status: 'failed', message: '', assertionResults: [{ title: spec.mutantReport.title, status: spec.mutantReport.status, failureMessages: ['mutant'] }] }] }
}
if (args.includes('-g') && spec.mutantReport) {
  const file = args[1].replace(/^\\(\\?:\\^\\|\\/\\)/, '').replace(/\\$$/, '').replace(/\\\\(.)/g, '$1')
  const st = spec.mutantReport.status
  const t = { projectName: '', expectedStatus: 'passed', status: st === 'passed' ? 'expected' : 'unexpected', results: [{ status: st, error: st === 'failed' ? { message: 'mutant' } : undefined }] }
  report = { config: { rootDir: dir }, errors: [], suites: [{ title: file, file, specs: [{ title: spec.mutantReport.title, file, tags: [], tests: [t] }], suites: [] }] }
}
setTimeout(() => {
  if (out && report) fs.writeFileSync(out, JSON.stringify(report))
  if (spec.stdout) process.stdout.write(spec.stdout)
  if (spec.stderr) process.stderr.write(spec.stderr)
  process.exit(spec.exit ?? 0)
}, spec.sleepMs ?? 0)
`

const PACKAGE = { vitest: 'vitest', playwright: '@playwright/test', stryker: '@stryker-mutator/core', tsc: 'typescript', jest: 'jest', mocha: 'mocha' }

export function fakeBin(dir, name, behaviour) {
  const pkg = join(dir, 'node_modules', PACKAGE[name])
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: PACKAGE[name], bin: { [name]: 'fake.cjs' } }))
  const p = join(pkg, 'fake.cjs')
  writeFileSync(p, script(name))
  writeFileSync(join(dir, `.fake-${name}.json`), JSON.stringify(behaviour))
  return p
}

/** A fake command first on PATH (gh): act(sh) sets the sh script it runs, restore() puts PATH back. */
export function fakeCommand(name) {
  const dir = mkdtempSync(join(tmpdir(), `qc-${name}-`))
  const before = process.env.PATH
  process.env.PATH = `${dir}${delimiter}${before}`
  return {
    act: sh => writeFileSync(join(dir, name), `#!/bin/sh\n${sh}\n`, { mode: 0o755 }),
    restore: () => { process.env.PATH = before },
  }
}

export function calls(dir, name) {
  try { return readFileSync(join(dir, `.fake-${name}.calls`), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
}
