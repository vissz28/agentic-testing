// Setup script: --detect (read-only scan), --write, --smoke, --unit-overlap.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../lib/config/config.mjs'
import { detect, pathProblem, smoke, unitOverlap, write, writePersonal } from '../lib/base/setup.mjs'
import { e2eFolder } from '../lib/stacks/e2e-folder.mjs'
import { RUNNERS, runnerLabel, runnerOf } from '../lib/stacks/runners.mjs'
import { backendOf } from '../lib/stacks/backends.mjs'
import { isMain, tag, printLine } from '../lib/core/script-io.mjs'
import { readJson } from '../lib/core/files.mjs'

function main(argv) {
  // The current dir, not a parent project that projectRoot would find.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  if (argv[0] === '--detect' && (argv.length === 1 || (argv[1] === '--root' && argv.length === 3))) {
    const sub = argv[2] ?? null
    const bad = sub && sub !== '.' && (pathProblem(root, '--root', sub) ?? (existsSync(join(root, sub)) ? null : `--root "${sub}" is not a folder of this repository`))
    if (bad) { printLine(bad); return 2 }
    printLine(tag('SETUP', detect(root, process.env, sub)))
    return 0
  }
  if ((argv[0] === '--write' || argv[0] === '--write-personal') && argv[1]) {
    // Proposal as inline JSON or @file.
    const inline = argv[1].trimStart().startsWith('{')
    const ref = argv[1].startsWith('@') ? argv[1].slice(1) : argv[1]
    let proposal
    try { proposal = inline ? JSON.parse(argv[1]) : readJson(resolve(root, ref)) } catch (err) {
      printLine(`proposal: cannot read ${inline ? 'the inline JSON' : ref} (${err.message})`)
      return 2
    }
    if (argv[0] === '--write-personal' || proposal?.scope === 'personal') {
      const r = writePersonal(proposal?.config)
      if (!r.ok) { printLine(r.errors.join('\n')); return 2 }
      printLine('ok')
      return 0
    }
    const r = write(root, proposal?.config, { templates: proposal?.templates, scaffold: proposal?.scaffold, vitestScaffold: proposal?.vitestScaffold, containersScaffold: proposal?.containersScaffold, colocated: proposal?.colocated })
    if (!r.ok) { printLine(r.errors.join('\n')); return 2 }
    process.stdout.write(`ok\n${r.note ? `${r.note}\n` : ''}`)
    return 0
  }
  if (argv[0] === '--smoke' && argv.slice(1).every(a => a === '--if-first')) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { printLine(cfg.errors.join('\n')); return 2 }
    return smoke(resolve(root, cfg.config.root ?? '.'), cfg.config, { ifFirst: argv.includes('--if-first') }).then(r => { printLine(r.line); return r.code })
  }
  if (argv[0] === '--unit-overlap' && argv.length === 1) {
    const cfg = loadConfig(root)
    if (!cfg.ok) { printLine(cfg.errors.join('\n')); return 2 }
    // pytest, JUnit, Go and .NET never pick up Playwright specs, so their list comes back empty.
    const backend = backendOf(cfg.config)
    const runner = backend && backend !== 'vitest' ? backend : runnerOf(cfg.config, 'vitest')
    const label = RUNNERS[runner]?.label ?? runnerLabel(runner)
    const proj = resolve(root, cfg.config.root ?? '.')
    const e2e = e2eFolder(proj, cfg.config)
    const r = e2e.ok ? unitOverlap(proj, e2e.folder, runner) : { error: e2e.error }
    if (r.error) { printLine(r.error); return 2 }
    if (!r.files.length) { printLine(`ok: ${label} runs none of the specs in ${e2e.folder}`); return 0 }
    printLine(`${label} also runs ${r.files.length} spec(s) in ${e2e.folder}, and fails on them:\n${r.files.map(f => `  ${f}`).join('\n')}`)
    return 1
  }
  printLine("usage: setup.mjs --detect [--root DIR] | --write '<proposal json>'|@proposal.json | --write-personal '<proposal json>'|@proposal.json | --smoke [--if-first] | --unit-overlap")
  return 2
}

if (isMain(import.meta.url)) Promise.resolve(main(process.argv.slice(2))).then(code => { process.exitCode = code })
