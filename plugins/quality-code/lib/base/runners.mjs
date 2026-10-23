// The test runners a project may use, by the kind of test they run: unit tests of the code (the
// "vitest" adapter) or e2e tests of a screen (the "playwright" adapter). Vitest and Playwright have the
// specialized checks; every other runner gets the generic tier, whose checks read its specs as the
// JavaScript test syntax they all share. The non-JavaScript backends (pytest, JUnit, Go, .NET) are their
// own adapters (backends.mjs), each with its own runner and dialect: specialized too.
import { BACKENDS, isBackend } from './backends.mjs'

export const RUNNERS = Object.freeze({
  vitest: Object.freeze({ kind: 'unit', label: 'Vitest', specialized: true }),
  jest: Object.freeze({ kind: 'unit', label: 'Jest' }),
  mocha: Object.freeze({ kind: 'unit', label: 'Mocha' }),
  playwright: Object.freeze({ kind: 'e2e', label: 'Playwright', specialized: true }),
  cypress: Object.freeze({ kind: 'e2e', label: 'Cypress' }),
})

/** The kind of test an adapter writes: unit (vitest) or e2e (playwright). */
export const KIND_OF = Object.freeze({ vitest: 'unit', playwright: 'e2e' })

/** The runner of an adapter's tests: runners.unit or runners.e2e in the config, else the adapter's own. */
export const runnerOf = (config, adapter = config?.adapter) => config?.runners?.[KIND_OF[adapter]] ?? adapter

export const isSpecialized = runner => Boolean(RUNNERS[runner]?.specialized) || isBackend(runner)

/** The runner's name as a person reads it; the generic tier says so. */
export const runnerLabel = runner => (RUNNERS[runner] ? `${RUNNERS[runner].label}${isSpecialized(runner) ? '' : ' (generic checks)'}` : BACKENDS[runner]?.label ?? String(runner))
