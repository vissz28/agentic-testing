// Deterministic half of the setup command: --detect scans the repo (read-only), --write validates and writes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONFIG_REL, DEFAULTS, configPath, normaliseTicketsDir, projectRoot, validateConfig } from './config.mjs'

const TEMPLATE_CANDIDATES = {
  bug: ['.gitlab/issue_templates/Bug.md', '.github/ISSUE_TEMPLATE/bug.md'],
  story: ['.gitlab/issue_templates/Story.md', '.github/ISSUE_TEMPLATE/story.md'],
}
const rawLine = ticketsDir => `${normaliseTicketsDir(typeof ticketsDir === 'string' ? ticketsDir : DEFAULTS.ticketsDir)}/*/raw.json`

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))

function hasLine(path, line) {
  return existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).some(l => l.trim() === line)
}

export function detect(root) {
  let adapter = null
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = readJson(pkgPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const pw = '@playwright/test' in deps
      const vt = 'vitest' in deps
      adapter = pw && vt ? 'both' : pw ? 'playwright' : vt ? 'vitest' : null
    } catch { adapter = null }
  }
  const templates = {}
  for (const [kind, paths] of Object.entries(TEMPLATE_CANDIDATES)) {
    templates[kind] = paths.find(p => existsSync(join(root, p))) ?? null
  }
  let existing = null
  let existingError
  const cp = configPath(root)
  if (existsSync(cp)) {
    try { existing = readJson(cp) } catch (err) { existingError = `${CONFIG_REL} is not valid JSON (${err.message})` }
  }
  const result = { adapter, templates, existing, gitignore: hasLine(join(root, '.gitignore'), rawLine(existing?.ticketsDir)) }
  if (existingError) result.existingError = existingError
  return result
}

// A path the proposal names must stay inside the project root.
function pathProblem(root, label, p) {
  if (typeof p !== 'string' || !p.trim()) return `${label}: must be a non-empty relative path`
  if (isAbsolute(p) || p.split(/[\\/]/).includes('..')) return `${label} "${p}" must be a relative path inside the project (no ".." or absolute paths)`
  const rel = relative(resolve(root), resolve(root, p))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return `${label} "${p}" is outside the project`
  return null
}

export function write(root, config, { templates, gitignoreLine } = {}) {
  const v = validateConfig(config)
  if (!v.ok) return { ok: false, errors: v.errors }
  const errors = []
  const named = [['ticketsDir', config.ticketsDir], ...Object.entries(config.ticketTemplates ?? {}).filter(([, p]) => p !== null).map(([k, p]) => [`ticketTemplates.${k}`, p])]
  for (const [label, p] of named) if (p !== undefined) { const m = pathProblem(root, label, p); if (m) errors.push(m) }
  if (gitignoreLine !== undefined && typeof gitignoreLine !== 'string') errors.push('gitignoreLine: must be text')
  if (errors.length) return { ok: false, errors }

  const found = detect(root).templates
  const toWrite = []
  const paths = { bug: found.bug, story: found.story }
  for (const kind of ['bug', 'story']) {
    if (typeof templates?.[kind] !== 'string' || found[kind]) continue
    const p = TEMPLATE_CANDIDATES[kind][0]
    paths[kind] = p
    toWrite.push([p, templates[kind]])
  }
  const out = { ...config }
  if (out.ticketTemplates === undefined && (paths.bug || paths.story)) out.ticketTemplates = { bug: paths.bug, story: paths.story }

  let step = ''
  try {
    for (const [p, body] of toWrite) {
      const full = join(root, p)
      step = p
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body.endsWith('\n') ? body : `${body}\n`, { flag: 'wx' })
    }
    step = CONFIG_REL
    mkdirSync(join(root, dirname(CONFIG_REL)), { recursive: true })
    writeFileSync(configPath(root), `${JSON.stringify(out, null, 2)}\n`)

    const line = gitignoreLine ?? rawLine(config.ticketsDir)
    const gi = join(root, '.gitignore')
    step = '.gitignore'
    if (!hasLine(gi, line)) {
      const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
      writeFileSync(gi, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`)
    }
  } catch (err) {
    return { ok: false, errors: [`${step}: ${err.message}`] }
  }
  return { ok: true }
}

function main(argv) {
  const root = projectRoot()
  if (argv[0] === '--detect') {
    process.stdout.write(`SETUP_JSON:${JSON.stringify(detect(root))}\n`)
    return 0
  }
  if (argv[0] === '--write' && argv[1]) {
    const ref = argv[1].startsWith('@') ? argv[1].slice(1) : argv[1]
    let proposal
    try { proposal = readJson(resolve(root, ref)) } catch (err) {
      process.stdout.write(`proposal: cannot read ${ref} (${err.message})\n`)
      return 2
    }
    const r = write(root, proposal?.config, { templates: proposal?.templates })
    if (!r.ok) { process.stdout.write(`${r.errors.join('\n')}\n`); return 2 }
    process.stdout.write('ok\n')
    return 0
  }
  process.stdout.write('usage: setup.mjs --detect | --write @proposal.json\n')
  return 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main(process.argv.slice(2))
