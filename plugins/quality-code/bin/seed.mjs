#!/usr/bin/env node
// node bin/seed.mjs target | load <file.sql>...   (the local mock-data loader of /quality-code:seed)
// target: runs seed.target and prints the database it reaches. load: the same check, then each file is checked and loaded with
// seed.apply, in order. Exit 0 done, 1 refused or a failed load, 2 a config or usage error.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig, projectRoot, seedOf } from '../lib/config/config.mjs'
import { isLocal, parseTarget, sqlProblems } from '../lib/base/seed.mjs'
import { isMain, lineWriter } from '../lib/core/script-io.mjs'
import { fillPlaceholders, shellQuote } from '../lib/core/shell.mjs'
import { firstLine } from '../lib/core/text.mjs'

const sh = (line, cwd, timeout) => spawnSync(line, { cwd, shell: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const [cmd, ...files] = argv
  if (!((cmd === 'target' && !files.length) || (cmd === 'load' && files.length))) {
    printError('usage: seed.mjs target | seed.mjs load <file.sql>...')
    return 2
  }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root, env)
  if (!cfg.ok) { printError(cfg.errors.join('\n')); return 2 }
  const seed = seedOf(cfg.config)
  if (!seed.target || !seed.apply) {
    stderr('Loading mock data needs "seed.target" and "seed.apply" in the project config.json, for example:\n'
      + '  "seed": { "target": "echo localhost:5432/app", "apply": "psql -h localhost -d app -v ON_ERROR_STOP=1 -f {file}" }\n')
    return 2
  }
  if (env.CI) { printLine('refused: mock data is for a local database, never in CI.'); return 1 }

  const t = sh(seed.target, root, 60_000)
  if (t.status !== 0) { printLine(`refused: seed.target failed (${t.error ? t.error.message : `exit ${t.status}`})${firstLine(t.stderr) ? `: ${firstLine(t.stderr)}` : ''}`); return 1 }
  const lines = String(t.stdout).split('\n').map(l => l.trim()).filter(Boolean)
  const target = parseTarget(lines.at(-1))
  // Never echo the line itself: it may be a URL with a password.
  if (!target) { printLine('refused: seed.target must print the database as host[:port]/database or as a URL; it printed something else.'); return 1 }
  if (!isLocal(target.host)) { printLine(`refused: ${target.shown} is not a local database. Only localhost, 127.x.x.x, ::1 or a container name (one word, like postgres) are written.`); return 1 }
  printLine(`target: ${target.shown}`)
  if (cmd === 'target') return 0

  const paths = files.map(f => resolve(root, f))
  for (const [i, p] of paths.entries()) {
    if (!existsSync(p)) { printLine(`refused: ${files[i]} does not exist.`); return 1 }
    const why = sqlProblems(readFileSync(p, 'utf8'), seed.tenant)
    if (why.length) { printLine(`refused: ${files[i]}: ${why.join('; ')}. Nothing was loaded.`); return 1 }
  }
  for (const [i, p] of paths.entries()) {
    const r = sh(fillPlaceholders(seed.apply, { file: shellQuote(p) }), root, 600_000)
    if (r.stdout) stdout(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`)
    if (r.stderr) stderr(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`)
    if (r.status !== 0) { printLine(`failed: seed.apply ${r.error ? r.error.message : `exited ${r.status}`} on ${files[i]}.`); return 1 }
    printLine(`loaded: ${files[i]}`)
  }
  return 0
}

if (isMain(import.meta.url)) process.exitCode = main()
