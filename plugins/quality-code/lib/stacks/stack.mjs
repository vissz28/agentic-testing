// Which side a project, ticket or spec is on: frontend (Playwright), backend (backends.mjs) or fullstack.
import { configFor } from '../pipeline/runners/playwright.mjs'
import { e2eFolder } from './e2e-folder.mjs'
import { matches } from '../pipeline/boundary.mjs'
import { BACKEND_ADAPTERS, backendOf } from './backends.mjs'
import { stripDotSlash } from '../core/paths.mjs'

export const SIDES = Object.freeze(['frontend', 'backend', 'fullstack'])
/** Title prefix ([FE]) or label marks that put a ticket on a side. */
export const DEFAULT_SIDES = Object.freeze({ frontend: ['FE'], backend: ['BE'], fullstack: ['FS'] })
const SIDE_OF = { playwright: 'frontend', ...Object.fromEntries(BACKEND_ADAPTERS.map(a => [a, 'backend'])) }

export const isFullstack = config => Boolean(config?.frontend && config?.backend)

/** Backend first, then frontend. */
export const adaptersOf = config => [config?.backend, config?.frontend].filter(Boolean)

export const stackOf = config => (isFullstack(config) ? 'fullstack' : SIDE_OF[config?.frontend ?? config?.backend] ?? null)

export const sideOfAdapter = adapter => SIDE_OF[adapter]

/** An unmarked ticket gets both; the backend defaults to Vitest. */
export function adaptersForSide(side, config = null) {
  const backend = backendOf(config) ?? 'vitest'
  const of = { frontend: ['playwright'], backend: [backend], fullstack: [backend, 'playwright'] }
  return of[side] ?? of.fullstack
}

// The feature's `approach`, else 'both' when there's a JS unit runner, else 'e2e'.
// 'unit' and 'both' fall back to 'e2e' without a unit runner.
export function approachOf(config, label) {
  const f = (config?.features ?? []).find(x => String(x.label).toLowerCase() === String(label ?? '').toLowerCase())
  const approach = f?.approach ?? (unitRunnerOf(config) ? 'both' : 'e2e')
  return approach !== 'e2e' && !unitRunnerOf(config) ? 'e2e' : approach
}

/** Vitest when a frontend feature can have unit tests, else null. */
export const unitRunnerOf = config => (config?.backend === 'vitest' || config?.runners?.unit !== undefined ? 'vitest' : null)

/** The config narrowed to one adapter and its side. */
export const asAdapter = (config, adapter) => (config.adapter === adapter ? config
  : { ...config, adapter, frontend: adapter === 'playwright' ? adapter : undefined, backend: adapter === 'playwright' ? undefined : adapter })

/** On a fullstack project: the side a ticket's title prefix or labels mark, or null. */
export function ticketSide(config, ticket) {
  if (!isFullstack(config)) return stackOf(config)
  const sides = { ...DEFAULT_SIDES, ...(config.sides ?? {}) }
  // `[FE]`, `[FE][BE]`, `FE -`, `FE-` or `FE:`. A dash before a digit is a Jira key (FE-12), not a mark.
  const title = String(ticket?.summary ?? '')
  const brackets = /^\s*((?:\[[^\]]+\]\s*)+)/.exec(title)?.[1]
  const word = brackets ? null : /^\s*([A-Za-z]{1,10})\s*[-–—:](?!\d)/.exec(title)?.[1]
  const prefixes = new Set((brackets ? [...brackets.matchAll(/\[([^\]]+)\]/g)].map(x => x[1]) : word ? [word] : []).map(p => p.trim().toLowerCase()))
  const labels = new Set((ticket?.labels ?? []).map(l => String(l).toLowerCase()))
  const marked = SIDES.filter(s => (sides[s] ?? []).some(m => prefixes.has(m.toLowerCase()) || labels.has(m.toLowerCase())))
  if (marked.includes('fullstack') || (marked.includes('frontend') && marked.includes('backend'))) return 'fullstack'
  return marked[0] ?? (['frontend', 'backend', 'fullstack'].includes(config.sides?.default) ? config.sides.default : null)
}

/** Fullstack: Playwright for the e2e folder or a Playwright config match, else the backend. */
export function adapterOfSpec(config, root, spec) {
  if (!isFullstack(config)) return config.adapter
  const backend = backendOf(config)
  const p = stripDotSlash(spec)
  if (configFor(p, config)) return 'playwright'
  if (backend === 'vitest' && (config.vitest?.configs ?? []).some(c => matches(c.match, p))) return 'vitest'
  const e2e = e2eFolder(root, config)
  return e2e.ok && p.startsWith(e2e.folder) ? 'playwright' : backend
}

/** In adapter order; adapters with no spec are dropped. */
export function specsByAdapter(config, root, specs) {
  const groups = new Map(adaptersOf(config).map(a => [a, []]))
  for (const s of specs) groups.get(adapterOfSpec(config, root, s)).push(s)
  return [...groups].filter(([, list]) => list.length)
}
