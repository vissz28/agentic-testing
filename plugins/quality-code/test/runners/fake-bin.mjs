// Installs a fake executable at <dir>/node_modules/.bin/<name>. Its behaviour comes from
// <dir>/.fake-<name>.json: { report?, reportFor?: { [config or 'default']: report }, exit?, stderr?,
// stdout?, sleepMs?, grandchild?, mutantReport?: { title, status } }. With mutantReport, a call with -t (a mutant run) reports
// that one test with that status for the file in argv[1]. With grandchild, a long-lived child process is started and its pid
// written to <dir>/.fake-<name>.grandchild. Each call's argv is appended as one JSON line to <dir>/.fake-<name>.calls,
// and the report is written to the --outputFile path (or, for Stryker, the fileName its temp config file names).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
const out = (args.find(a => a.startsWith('--outputFile=')) || '').slice(13) || fromCfg
const ci = args.indexOf('--config')
let report = (spec.reportFor && spec.reportFor[ci >= 0 ? args[ci + 1] : 'default']) || spec.report
if (args.includes('-t') && spec.mutantReport) {
  report = { testResults: [{ name: path.resolve(dir, args[1]), status: 'failed', message: '', assertionResults: [{ title: spec.mutantReport.title, status: spec.mutantReport.status, failureMessages: ['mutant'] }] }] }
}
setTimeout(() => {
  if (out && report) fs.writeFileSync(out, JSON.stringify(report))
  if (spec.stdout) process.stdout.write(spec.stdout)
  if (spec.stderr) process.stderr.write(spec.stderr)
  process.exit(spec.exit ?? 0)
}, spec.sleepMs ?? 0)
`

export function fakeBin(dir, name, behaviour) {
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true })
  const p = join(dir, 'node_modules/.bin', name)
  writeFileSync(p, script(name))
  chmodSync(p, 0o755)
  writeFileSync(join(dir, `.fake-${name}.json`), JSON.stringify(behaviour))
  return p
}

export function calls(dir, name) {
  try { return readFileSync(join(dir, `.fake-${name}.calls`), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] }
}
