import * as playwright from './playwright.mjs'
import * as vitest from './vitest.mjs'
import { generic } from './generic.mjs'
import { RUNNERS } from '../runners.mjs'

const DIALECTS = { playwright, vitest }
const GENERIC = { unit: generic('unit'), e2e: generic('e2e') }

/** The syntax the checks read a runner's specs in: Vitest's and Playwright's own, else the generic one of its kind. */
export function dialectFor(runner) {
  const d = DIALECTS[runner] ?? GENERIC[RUNNERS[runner]?.kind]
  if (!d) throw new Error(`no dialect for runner "${runner}"`)
  return d
}
