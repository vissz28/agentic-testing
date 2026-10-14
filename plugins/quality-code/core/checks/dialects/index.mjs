import * as playwright from './playwright.mjs'
import * as vitest from './vitest.mjs'

const DIALECTS = { playwright, vitest }

export function dialectFor(adapter) {
  const d = DIALECTS[adapter]
  if (!d) throw new Error(`no dialect for adapter "${adapter}"`)
  return d
}
