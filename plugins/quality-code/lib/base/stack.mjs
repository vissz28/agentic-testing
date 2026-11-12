// Which side of the stack a project, a ticket or a spec is on. A project is frontend (Playwright),
// backend (Vitest, pytest, JUnit, Go or .NET: see backends.mjs) or fullstack (both in one repo). On a
// fullstack project a ticket is frontend, backend or fullstack, and each spec belongs to the adapter
// whose folder or config it is in.
import { configFor } from '../pipeline/runners/playwright.mjs'
import { e2eFolder } from './e2e-folder.mjs'
import { matches } from './boundary.mjs'
import { BACKEND_ADAPTERS, backendOf } from './backends.mjs'
import { toPosix } from '../core/text.mjs'

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

/**
 * How a frontend feature is tested: the feature's own `approach` ("e2e", "unit" or "both"), else e2e. "unit"
 * and "both" need a JavaScript unit runner; where there is none the feature falls back to e2e.
 */
export function approachOf(config, label) {
  const f = (config?.features ?? []).find(x => String(x.label).toLowerCase() === String(label ?? '').toLowerCase())
  const approach = f?.approach ?? 'e2e'
  return approach !== 'e2e' && !unitRunnerOf(config) ? 'e2e' : approach
}

/** The JavaScript unit runner a frontend feature can use for its unit tests: Vitest, else null. */
export const unitRunnerOf = config => (config?.adapter === 'vitest' || (config?.adapter === 'fullstack' && backendOf(config) === 'vitest') || config?.runners?.unit !== undefined ? 'vitest' : null)

/** The project config as a single-adapter project sees it, so every one-adapter module works unchanged. */
export const asAdapter = (config, adapter) => (config.adapter === adapter ? config : { ...config, adapter })

/** The side a ticket's title prefix or labels mark, or null when nothing does. Only for fullstack projects. */
export function ticketSide(config, ticket) {
  if (!isFullstack(config)) return stackOf(config)
  // Each side not set in the config keeps its default marks (FE, BE, FS).
  const sides = { ...DEFAULT_SIDES, ...(config.sides ?? {}) }
  // The mark opens the title as `[FE]`, `FE -`, `FE-` or `FE:` (a dash straight before a digit is a Jira key such as FE-12, not a mark).
  const m = /^\s*(?:\[([^\]]+)\]|([A-Za-z]{1,10})\s*[-–—:](?!\d))/.exec(String(ticket?.summary ?? ''))
  const prefix = (m?.[1] ?? m?.[2])?.trim().toLowerCase()
  const labels = new Set((ticket?.labels ?? []).map(l => String(l).toLowerCase()))
  const marked = SIDES.filter(s => (sides[s] ?? []).some(m => m.toLowerCase() === prefix || labels.has(m.toLowerCase())))
  if (marked.includes('fullstack') || (marked.includes('frontend') && marked.includes('backend'))) return 'fullstack'
  return marked[0] ?? (['frontend', 'backend', 'fullstack'].includes(config.sides?.default) ? config.sides.default : null)
}

/** The adapter a spec runs under. On a fullstack project: Playwright for the e2e folder or a Playwright config match, else the backend. */
export function adapterOfSpec(config, root, spec) {
  if (!isFullstack(config)) return config.adapter
  const backend = backendOf(config)
  const p = toPosix(spec).replace(/^(?:\.\/)+/, '')
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
