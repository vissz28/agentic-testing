// Maps a branch's changed paths to sides and specs, so CI runs only what changed. Never reads contents.
import { BACKENDS, backendOf, isBackend } from '../stacks/backends.mjs'
import { layersOf } from '../config/config.mjs'
import { e2eFolder } from '../stacks/e2e-folder.mjs'
import { adaptersOf, asAdapter } from '../stacks/stack.mjs'

// Dependency, compiler and runner config: a change can break either side without touching a spec.
export const SHARED_CONFIG = /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|vitest\.config\.[^/]+|vite\.config\.[^/]+|playwright\.config\.[^/]+|pom\.xml|build\.gradle(?:\.kts)?|go\.(?:mod|sum)|requirements[^/]*\.txt|pyproject\.toml|[^/]+\.(?:csproj|fsproj|sln)|\.claude\/quality-code\.json)$/
// Must match branch.mjs kindOf.
const SPEC_NAME = /\.(spec|test|cy)\.[^/]+$/
const FRONT_EXT = /\.(?:vue|svelte|astro|html|css|scss|less|tsx|jsx)$/
const FRONT_DIR = /(?:^|\/)(?:frontend|front|client|web|ui|app|pages|components|public|e2e)(?:\/|$)/i
const BACK_DIR = /(?:^|\/)(?:backend|back|server|api|services?|domain|db|migrations?)(?:\/|$)/i

/** 'frontend', 'backend', or 'both' when the path doesn't say. */
export function sideOfCode(path, config) {
  const has = adaptersOf(config)
  const front = has.includes('playwright')
  const back = has.some(isBackend)
  if (front && !back) return 'frontend'
  if (back && !front) return 'backend'
  const own = backendOf(config)
  if (own && own !== 'vitest' && BACKENDS[own].codeFile.test(path)) return 'backend'
  const f = FRONT_EXT.test(path) || FRONT_DIR.test(path)
  const b = BACK_DIR.test(path)
  return f && !b ? 'frontend' : b && !f ? 'backend' : 'both'
}

/** Backend layer name, or the first folder under the e2e folder. */
export function moduleOf(config, root, spec, adapter) {
  if (adapter === 'playwright') {
    const folder = e2eFolder(root, asAdapter(config, 'playwright')).folder ?? 'e2e/'
    const rest = spec.startsWith(folder) ? spec.slice(folder.length) : spec
    const [first, ...more] = rest.split('/')
    return more.length ? first : 'e2e'
  }
  const hit = layersOf(asAdapter(config, adapter)).find(l => spec.startsWith(l.folder))
  return hit?.name ?? 'tests'
}

// files: [{ path, status, kind }]; known: the project's specs [{ path, adapter }].
// Per side: changed (not deleted) specs by module, and whether source or shared config changed.
export function planChanges(files, config, known) {
  const bySpec = new Map(known.map(s => [s.path, s.adapter]))
  const sides = {
    backend: { specs: new Map(), source: false, shared: false },
    frontend: { specs: new Map(), source: false, shared: false },
  }
  const modules = new Map()
  for (const f of files) {
    if (f.kind === 'test') {
      // Page object, fixture or helper: counts as source of its side.
      if (!bySpec.has(f.path) && !SPEC_NAME.test(f.path) && !BACKENDS[backendOf(config)]?.testFile.test(f.path)) {
        const s = sideOfCode(f.path, config)
        for (const side of s === 'both' ? ['backend', 'frontend'] : [s]) sides[side].source = true
        continue
      }
      if (f.status === 'D' || !bySpec.has(f.path)) continue
      const adapter = bySpec.get(f.path)
      const side = adapter === 'playwright' ? 'frontend' : 'backend'
      const mod = modules.get(f.path) ?? null
      sides[side].specs.set(f.path, mod)
    } else if (SHARED_CONFIG.test(f.path)) {
      sides.backend.shared = sides.frontend.shared = true
    } else if (f.kind === 'code') {
      const s = sideOfCode(f.path, config)
      for (const side of s === 'both' ? ['backend', 'frontend'] : [s]) sides[side].source = true
    }
  }
  return sides
}
