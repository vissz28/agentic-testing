import * as dotnet from './dotnet.mjs'
import * as go from './go.mjs'
import * as junit from './junit.mjs'
import * as playwright from './playwright.mjs'
import * as pytest from './pytest.mjs'
import * as vitest from './vitest.mjs'
import { generic } from './generic.mjs'
import { RUNNERS } from '../runners.mjs'

// Jest, Mocha and Cypress have no dialect of their own: they use the generic one of their kind.
const DIALECTS = { playwright, vitest, pytest, junit, go, dotnet }
const GENERIC = { unit: generic('unit'), e2e: generic('e2e') }

export function dialectFor(runner) {
  const d = DIALECTS[runner] ?? GENERIC[RUNNERS[runner]?.kind]
  if (!d) throw new Error(`no dialect for runner "${runner}"`)
  return d
}
