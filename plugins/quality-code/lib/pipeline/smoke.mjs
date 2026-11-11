// The smoke suite: the specs that carry the @smoke tag, run fast against any environment.
// Playwright tags a test in its title (`test('login @smoke', ...)`) or in its details (`{ tag: '@smoke' }`); both are
// matched by `--grep @smoke`. Pure helpers: the pipeline wires them in (bin/pipeline.mjs --smoke [--url U]).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stripComments } from './checks/external.mjs'

export const SMOKE_TAG = '@smoke'
const TAG = /(?:^|[^\w@])@smoke(?![\w-])/
// Where --grep looks: a test or describe title (not a step's), and a tag: option, one tag or a list.
const TITLE = /(?<![.\w$])(?:test|it|describe)(?:\.(?!step\b)\w+)*\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const TAG_OPT = /(?<![.\w$])tag\s*:\s*(\[[^\]]*\]|(['"`])(?:\\.|(?!\2)[^\\])*\2)/g

/** True when a test title or tag in the source carries the @smoke tag; a comment or another string does not count. */
export const hasSmokeTag = text => {
  const code = stripComments(String(text ?? ''))
  return [...code.matchAll(TITLE)].some(m => TAG.test(m[2])) || [...code.matchAll(TAG_OPT)].some(m => TAG.test(m[1]))
}

/** The specs (paths relative to root) whose source carries the tag; unreadable files are left out. */
export function smokeSpecs(root, specs) {
  return specs.filter(s => { try { return hasSmokeTag(readFileSync(resolve(root, s), 'utf8')) } catch { return false } })
}

/** The URL for --url: http or https, no credentials in it. Returns { url } or { error }. */
export function checkUrl(v) {
  let u
  try { u = new URL(String(v)) } catch { return { error: `--url must be a full address like https://staging.example.com, not "${v}"` } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: `--url must start with http:// or https://, not "${v}"` }
  if (u.username || u.password) return { error: '--url must not carry a user name or password: pass the address only' }
  return { url: u.href }
}

/** The environment the Playwright run gets: only tagged tests, against the URL when one is given. */
export function smokeEnv(url) {
  return { QC_SMOKE_GREP: SMOKE_TAG, ...(url ? { PLAYWRIGHT_TEST_BASE_URL: url, BASE_URL: url } : {}) }
}
