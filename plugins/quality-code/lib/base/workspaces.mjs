// Monorepo helpers for setup's detect: the folders an npm (or pnpm) workspaces root holds, each one's own unit
// test config, and the folders detect never reads (build copies such as .build-context/, and what git ignores).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonOr } from '../core/files.mjs'

/** Folders that only hold copies of the code (Docker build contexts, build output): never a boundary, spec folder or project. */
export const BUILD_COPIES = new Set(['.build-context', 'build-context', '.build', '.docker-context'])

const JEST_CONFIG = /^jest\.config\.[cm]?[jt]s$|^jest\.config\.json$/
const VITEST_CONFIG = /^vitest\.config\.[cm]?[jt]s$/

const join2 = (rel, n) => (rel ? `${rel}/${n}` : n)

/** The workspace patterns of a root: package.json "workspaces" (a list, or { packages }), else pnpm-workspace.yaml's packages list; null when none. */
export function workspacePatterns(root, pkg) {
  const w = pkg?.workspaces
  const list = Array.isArray(w) ? w : Array.isArray(w?.packages) ? w.packages : null
  if (list) return list.filter(p => typeof p === 'string')
  try {
    const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    const block = /^packages:[ \t]*\r?\n((?:[ \t]*-[^\n]*\n?)*)/m.exec(yaml)?.[1]
    if (block) return [...block.matchAll(/^[ \t]*-\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/gm)].map(m => m[1].trim())
  } catch {}
  return null
}

const segSource = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
const segments = p => p.replace(/^\.\//, '').replace(/\/+$/, '').split('/').filter(Boolean)

/** The folders (relative, forward slashes) the patterns name that hold a package.json; `ignored` folders are skipped, "!" patterns subtract. */
export function workspaceDirs(root, patterns, ignored = new Set()) {
  const out = new Set()
  const skip = rel => ignored.has(rel) || BUILD_COPIES.has(rel.split('/').pop()) || rel.split('/').pop() === 'node_modules'
  const subdirs = rel => {
    try { return readdirSync(join(root, rel), { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && !skip(join2(rel, e.name))).map(e => e.name).sort() } catch { return [] }
  }
  const expand = (rel, segs) => {
    if (!segs.length) { if (rel && existsSync(join(root, rel, 'package.json'))) out.add(rel); return }
    const [s, ...rest] = segs
    if (s === '**') { expand(rel, rest); for (const d of subdirs(rel)) expand(join2(rel, d), segs); return }
    if (!s.includes('*')) { const p = join2(rel, s); if (!skip(p)) expand(p, rest); return }
    const re = new RegExp(`^${segSource(s)}$`)
    for (const d of subdirs(rel)) if (re.test(d)) expand(join2(rel, d), rest)
  }
  for (const p of patterns.filter(p => !p.startsWith('!'))) expand('', segments(p))
  for (const p of patterns.filter(p => p.startsWith('!'))) {
    const re = new RegExp(`^${segments(p.slice(1)).map(s => (s === '**' ? '.*' : segSource(s))).join('/')}$`)
    for (const d of [...out]) if (re.test(d)) out.delete(d)
  }
  return [...out].sort()
}

/**
 * What each workspace runs its unit tests with: { dir, runner, config } where runner is vitest or jest (Vitest when its
 * dependencies name it) and config the workspace's own config file or, for Jest, its package.json (the "jest" key); null when none.
 */
export function workspaceRunners(root, dirs) {
  const found = []
  for (const dir of dirs) {
    const pkg = readJsonOr(join(root, dir, 'package.json'), null, { whenBroken: 'fallback' })
    if (!pkg) continue
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    let names = []
    try { names = readdirSync(join(root, dir)).sort() } catch {}
    const vitestCfg = names.find(n => VITEST_CONFIG.test(n))
    const jestCfg = names.find(n => JEST_CONFIG.test(n))
    const runner = 'vitest' in deps ? 'vitest' : 'jest' in deps || jestCfg || pkg.jest ? 'jest' : vitestCfg ? 'vitest' : null
    if (!runner) continue
    const own = runner === 'vitest' ? vitestCfg : jestCfg ?? (pkg.jest ? 'package.json' : null)
    found.push({ dir, runner, config: own ? `${dir}/${own}` : null })
  }
  return found
}

/** The unit runner most workspaces use (ties: vitest before jest); null when none. */
export function majorityRunner(found) {
  const n = r => found.filter(f => f.runner === r).length
  return ['vitest', 'jest'].filter(n).sort((a, b) => n(b) - n(a))[0] ?? null
}

/** The dependencies of every workspace, merged: what the monorepo as a whole is tested with. */
export function workspaceDeps(root, dirs) {
  const all = {}
  for (const dir of dirs) { const pkg = readJsonOr(join(root, dir, 'package.json'), null, { whenBroken: 'fallback' }); Object.assign(all, pkg?.dependencies, pkg?.devDependencies) }
  return all
}
