// Installs a fake executable at <dir>/node_modules/.bin/<name>. Its behaviour comes from
// <dir>/.fake-<name>.json: { report?, reportFor?: { [config or 'default']: report }, exit?, stderr?,
// stdout?, sleepMs?, grandchild? }. With grandchild, a long-lived child process is started and its pid
// written to <dir>/.fake-<name>.grandchild. Each call's argv is appended as one JSON line to <dir>/.fake-<name>.calls,
// and the report is written to the --outputFile path.
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
const out = (args.find(a => a.startsWith('--outputFile=')) || '').slice(13)
const ci = args.indexOf('--config')
const report = (spec.reportFor && spec.reportFor[ci >= 0 ? args[ci + 1] : 'default']) || spec.report
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
