// Local git facts for /agentic-testing:start: the branch, its base, what changed, and ticket keys.
// Read-only and offline. Never reads diff contents. --detect prints one BRANCH_JSON: line.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/
const TEST_NAME = /\.(spec|test)\.[^/]+$/
const PW_CONFIGS = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']
const KEY = /(?<![A-Z0-9])([A-Z][A-Z0-9]+)-(\d+)(?!\d)/g

/** The origin URL without any user:password@ part. */
export function stripCredentials(url) {
  if (!url) return null
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1')
}

/** Ticket keys of the configured projects, in the order found, each once. */
export function keyCandidates(texts, projects) {
  const allowed = new Set(projects)
  const out = []
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(KEY)) {
      const key = `${m[1]}-${m[2]}`
      if (allowed.has(m[1]) && !out.includes(key)) out.push(key)
    }
  }
  return out
}

/** Playwright test folders: testDir from the config when it is a plain string, else e2e/ and tests/. */
export function playwrightTestDirs(root) {
  for (const name of PW_CONFIGS) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(/testDir\s*:\s*['"`]([^'"`$]+)['"`]/)
    if (m) return [m[1].replace(/^\.\//, '').replace(/\/?$/, '/')]
  }
  return ['e2e/', 'tests/']
}

export function kindOf(path, adapter, testDirs = []) {
  if (TEST_NAME.test(path)) return 'test'
  if (adapter === 'playwright' && testDirs.some(d => path.startsWith(d))) return 'test'
  return CODE_EXT.test(path) ? 'code' : 'other'
}

/** `git status --porcelain=v1 -z` → files. Untracked counts as added; a rename is followed by its old path. */
export function parseStatusZ(out) {
  const t = String(out ?? '').split('\0')
  const files = []
  for (let i = 0; i < t.length; i++) {
    const e = t[i]
    if (!e) continue
    const xy = e.slice(0, 2)
    if (/[RC]/.test(xy)) i++
    const status = xy === '??' ? 'A' : xy.includes('D') ? 'D' : xy.includes('R') ? 'R' : xy.includes('A') ? 'A' : 'M'
    files.push({ path: e.slice(3), status })
  }
  return files
}

/** `git diff --name-status -z -M` → files. Renames keep the new path; copies count as added. */
export function parseNameStatusZ(out) {
  const t = String(out ?? '').split('\0')
  const files = []
  for (let i = 0; i < t.length; i++) {
    const code = t[i]
    if (!code) continue
    if (/^[RC]/.test(code)) {
      files.push({ path: t[i + 2], status: code[0] === 'R' ? 'R' : 'A' })
      i += 2
    } else {
      files.push({ path: t[i + 1], status: 'ADM'.includes(code[0]) ? code[0] : 'M' })
      i += 1
    }
  }
  return files
}
