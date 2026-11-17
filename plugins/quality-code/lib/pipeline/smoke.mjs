// @smoke suite. Playwright's `--grep @smoke` matches the tag in a title or in `{ tag: '@smoke' }`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stripComments } from './checks/external.mjs'

export const SMOKE_TAG = '@smoke'
const TAG = /(?:^|[^\w@])@smoke(?![\w-])/
// What --grep sees: a test/describe title (not a step's) and a `tag:` option, single or array.
const TITLE = /(?<![.\w$])(?:test|it|describe)(?:\.(?!step\b)\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const TAG_OPT = /(?<![.\w$])tag\s*:\s*(\[[^\]]*\]|(['"`])(?:\\.|(?!\2)[^\\])*\2)/g

/** Only a title or tag counts, not a comment or some other string. */
export const hasSmokeTag = text => {
  const code = stripComments(String(text ?? ''))
  return [...code.matchAll(TITLE)].some(m => TAG.test(m[2])) || [...code.matchAll(TAG_OPT)].some(m => TAG.test(m[1]))
}

export function smokeSpecs(root, specs) {
  return specs.filter(s => { try { return hasSmokeTag(readFileSync(resolve(root, s), 'utf8')) } catch { return false } })
}

export function checkUrl(v) {
  let u
  try { u = new URL(String(v)) } catch { return { error: `--url must be a full address like https://staging.example.com, not "${v}"` } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: `--url must start with http:// or https://, not "${v}"` }
  if (u.username || u.password) return { error: '--url must not carry a user name or password: pass the address only' }
  return { url: u.href }
}

export function smokeEnv(url) {
  return { QC_SMOKE_GREP: SMOKE_TAG, ...(url ? { PLAYWRIGHT_TEST_BASE_URL: url, BASE_URL: url } : {}) }
}
