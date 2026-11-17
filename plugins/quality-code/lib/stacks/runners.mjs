// JS test runners. Vitest and Playwright get specialized checks, the rest the generic tier.
// Non-JS backends (pytest, JUnit, Go, .NET) live in backends.mjs and are specialized too.
import { BACKENDS, isBackend } from './backends.mjs'

export const RUNNERS = Object.freeze({
  vitest: Object.freeze({ kind: 'unit', label: 'Vitest', specialized: true }),
  jest: Object.freeze({ kind: 'unit', label: 'Jest' }),
  mocha: Object.freeze({ kind: 'unit', label: 'Mocha' }),
  node: Object.freeze({ kind: 'unit', label: 'node --test' }),
  playwright: Object.freeze({ kind: 'e2e', label: 'Playwright', specialized: true }),
  cypress: Object.freeze({ kind: 'e2e', label: 'Cypress' }),
})

export const KIND_OF = Object.freeze({ vitest: 'unit', playwright: 'e2e' })

/** config.runners.unit / .e2e, else the adapter itself. */
export const runnerOf = (config, adapter = config?.adapter) => config?.runners?.[KIND_OF[adapter]] ?? adapter

export const isSpecialized = runner => Boolean(RUNNERS[runner]?.specialized) || isBackend(runner)

export const runnerLabel = runner => (RUNNERS[runner] ? `${RUNNERS[runner].label}${isSpecialized(runner) ? '' : ' (generic checks)'}` : BACKENDS[runner]?.label ?? String(runner))
