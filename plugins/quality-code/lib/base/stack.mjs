// Which side of the stack a project, a ticket or a spec is on. A project is frontend (Playwright),
// backend (Vitest, pytest, JUnit, Go or .NET: see backends.mjs) or fullstack (both in one repo). On a
// fullstack project a ticket is frontend, backend or fullstack, and each spec belongs to the adapter
// whose folder or config it is in.
import { configFor } from '../pipeline/runners/playwright.mjs'
import { e2eFolder } from './e2e-folder.mjs'
import { matches } from './boundary.mjs'
import { BACKEND_ADAPTERS, backendOf } from './backends.mjs'

export const SIDES = Object.freeze(['frontend', 'backend', 'fullstack'])
/** A ticket marked with one of these (title prefix in brackets, or label) is on that side. */
export const DEFAULT_SIDES = Object.freeze({ frontend: ['FE'], backend: ['BE'], fullstack: ['FS'] })
const SIDE_OF = { playwright: 'frontend', fullstack: 'fullstack', ...Object.fromEntries(BACKEND_ADAPTERS.map(a => [a, 'backend'])) }

export const isFullstack = config => config?.adapter === 'fullstack'

/** The adapters a project runs: one, or its backend and Playwright on a fullstack project. */
export const adaptersOf = config => (isFullstack(config) ? [backendOf(config), 'playwright'] : [config.adapter])

/** frontend, backend or fullstack: what the project is. */
export const stackOf = config => SIDE_OF[config?.adapter] ?? null

/** The side an adapter writes for: Playwright is the frontend, every backend runner the backend. */
export const sideOfAdapter = adapter => SIDE_OF[adapter]

/**
 * The adapters a ticket's side needs: the project's backend (Vitest when the config names none) and
 * Playwright. No side (unmarked ticket): both.
 */
export function adaptersForSide(side, config = null) {
  const backend = backendOf(config) ?? 'vitest'
  const of = { frontend: ['playwright'], backend: [backend], fullstack: [backend, 'playwright'] }
  return of[side] ?? of.fullstack
}

/** The project config as a single-adapter project sees it, so every one-adapter module works unchanged. */
export const asAdapter = (config, adapter) => (config.adapter === adapter ? config : { ...config, adapter })

/** The side a ticket's title prefix or labels mark, or null when nothing does. Only for fullstack projects. */
export function ticketSide(config, ticket) {
  if (!isFullstack(config)) return stackOf(config)
  // Each side not set in the config keeps its default marks (FE, BE, FS).
  const sides = { ...DEFAULT_SIDES, ...(config.sides ?? {}) }
  const prefix = /^\s*\[([^\]]+)\]/.exec(String(ticket?.summary ?? ''))?.[1]?.trim().toLowerCase()
  const labels = new Set((ticket?.labels ?? []).map(l => String(l).toLowerCase()))
  const marked = SIDES.filter(s => (sides[s] ?? []).some(m => m.toLowerCase() === prefix || labels.has(m.toLowerCase())))
  if (marked.includes('fullstack') || (marked.includes('frontend') && marked.includes('backend'))) return 'fullstack'
  return marked[0] ?? null
}

/** The adapter a spec runs under. On a fullstack project: Playwright for the e2e folder or a Playwright config match, else the backend. */
export function adapterOfSpec(config, root, spec) {
  if (!isFullstack(config)) return config.adapter
  const backend = backendOf(config)
  const p = String(spec).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  if (configFor(p, config)) return 'playwright'
  if (backend === 'vitest' && (config.vitest?.configs ?? []).some(c => matches(c.match, p))) return 'vitest'
  const e2e = e2eFolder(root, config)
  return e2e.ok && p.startsWith(e2e.folder) ? 'playwright' : backend
}

/** Specs grouped by adapter, in the adapters' order; an adapter with no spec is left out. */
export function specsByAdapter(config, root, specs) {
  const groups = new Map(adaptersOf(config).map(a => [a, []]))
  for (const s of specs) groups.get(adapterOfSpec(config, root, s)).push(s)
  return [...groups].filter(([, list]) => list.length)
}
