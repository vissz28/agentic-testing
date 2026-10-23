import * as dotnet from './dotnet.mjs'
import * as go from './go.mjs'
import * as junit from './junit.mjs'
import * as playwright from './playwright.mjs'
import * as pytest from './pytest.mjs'
import * as vitest from './vitest.mjs'

// One dialect per adapter: Playwright and every backend of backends.mjs.
const DIALECTS = { playwright, vitest, pytest, junit, go, dotnet }

export function dialectFor(adapter) {
  const d = DIALECTS[adapter]
  if (!d) throw new Error(`no dialect for adapter "${adapter}"`)
  return d
}
