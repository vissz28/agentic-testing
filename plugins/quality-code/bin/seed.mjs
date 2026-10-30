#!/usr/bin/env node
// node bin/seed.mjs target | load <file.sql>...   (the local mock-data loader of /quality-code:seed)
// target: runs seed.target and prints the database it reaches. load: the same check, then each file is checked and loaded with
// seed.apply, in order. Exit 0 done, 1 refused or a failed load, 2 a config or usage error.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot, seedOf } from '../lib/base/config.mjs'
import { isLocal, parseTarget, sqlProblems } from '../lib/base/seed.mjs'

const quote = s => (process.platform === 'win32' ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`)
const sh = (line, cwd, timeout) => spawnSync(line, { cwd, shell: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
const firstLine = s => String(s ?? '').split('\n').find(l => l.trim())?.trim() ?? ''

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const [cmd, ...files] = argv
  if (!((cmd === 'target' && !files.length) || (cmd === 'load' && files.length))) {
    stderr('usage: seed.mjs target | seed.mjs load <file.sql>...\n')
    return 2
  }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root, env)
  if (!cfg.ok) { stderr(`${cfg.errors.join('\n')}\n`); return 2 }
  const seed = seedOf(cfg.config)
  if (!seed.target || !seed.apply) {
    stderr('Loading mock data needs "seed.target" and "seed.apply" in .claude/quality-code.json, for example:\n'
      + '  "seed": { "target": "echo localhost:5432/app", "apply": "psql -h localhost -d app -v ON_ERROR_STOP=1 -f {file}" }\n')
    return 2
  }
  if (env.CI) { stdout('refused: mock data is for a local database, never in CI.\n'); return 1 }

  const t = sh(seed.target, root, 60_000)
  if (t.status !== 0) { stdout(`refused: seed.target failed (${t.error ? t.error.message : `exit ${t.status}`})${firstLine(t.stderr) ? `: ${firstLine(t.stderr)}` : ''}\n`); return 1 }
  const lines = String(t.stdout).split('\n').map(l => l.trim()).filter(Boolean)
  const target = parseTarget(lines.at(-1))
  // Never echo the line itself: it may be a URL with a password.
  if (!target) { stdout('refused: seed.target must print the database as host[:port]/database or as a URL; it printed something else.\n'); return 1 }
  if (!isLocal(target.host)) { stdout(`refused: ${target.shown} is not a local database. Only localhost, 127.x.x.x, ::1 or a container name (one word, like postgres) are written.\n`); return 1 }
  stdout(`target: ${target.shown}\n`)
  if (cmd === 'target') return 0

  const paths = files.map(f => resolve(root, f))
  for (const [i, p] of paths.entries()) {
    if (!existsSync(p)) { stdout(`refused: ${files[i]} does not exist.\n`); return 1 }
    const why = sqlProblems(readFileSync(p, 'utf8'), seed.tenant)
    if (why.length) { stdout(`refused: ${files[i]}: ${why.join('; ')}. Nothing was loaded.\n`); return 1 }
  }
  for (const [i, p] of paths.entries()) {
    const r = sh(seed.apply.replace(/\{file\}/g, () => quote(p)), root, 600_000)
    if (r.stdout) stdout(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`)
    if (r.stderr) stderr(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`)
    if (r.status !== 0) { stdout(`failed: seed.apply ${r.error ? r.error.message : `exited ${r.status}`} on ${files[i]}.\n`); return 1 }
    stdout(`loaded: ${files[i]}\n`)
  }
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main()
