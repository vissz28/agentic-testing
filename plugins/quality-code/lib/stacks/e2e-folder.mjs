// Folder for new e2e specs: playwright.folder, else a literal testDir, else e2e/. Configs are read, never run.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ALWAYS, allowCovers, matches, rulesFor } from '../pipeline/boundary.mjs'
import { runnerOf } from './runners.mjs'
import { hasLineBreak, toForwardSlashes } from '../core/text.mjs'

// Playwright's own lookup order for its default config file.
export const CONFIG_FILES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs']
export const DEFAULT_E2E_FOLDER = 'e2e/'
export const CYPRESS_FOLDER = 'cypress/e2e/'

const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')

/** "/" separators, no leading "./", one trailing "/"; null when unsafe. */
function normFolder(raw) {
  const s = String(raw).trim().replace(/\\+/g, '/').replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  if (!s || s === '.' || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..') || hasLineBreak(s)) return null
  return `${s}/`
}

// The first config's testDir when it is a single literal, else null.
// testDir is relative to its config: e2e/playwright.config.ts + './tests' -> e2e/tests/.
export function readTestDir(root, files = CONFIG_FILES) {
  for (const file of files) {
    let src
    try { src = readFileSync(join(root, file), 'utf8') } catch { continue }
    const text = stripComments(src)
    const all = [...text.matchAll(/\btestDir\s*:/g)].length
    const literals = [...text.matchAll(/\btestDir\s*:\s*(['"`])([^'"`\n]*)\1/g)].map(m => m[2])
    // Computed values (path.join, ${…}) can't be read without running the config.
    if (!all || literals.length !== all || literals.some(v => v.includes('${'))) return null
    const values = [...new Set(literals.map(v => normFolder(dirname(file) === '.' ? v : `${dirname(file)}/${v.replace(/^(?:\.\/)+/, '')}`)))]
    return values.length === 1 && values[0] ? { value: values[0], file } : null
  }
  return null
}

/** → { ok: true, folder, source: 'config' | 'cypress' | 'testDir' | 'default', configFile? } | { ok: false, error } */
export function e2eFolder(root, config) {
  if (!config?.frontend) return { ok: false, error: `the e2e folder is for Playwright projects: this project uses ${config?.backend}` }
  let out
  if (config.playwright?.folder) out = { ok: true, folder: config.playwright.folder, source: 'config' }
  else if (runnerOf(config, 'playwright') === 'cypress') out = { ok: true, folder: CYPRESS_FOLDER, source: 'cypress' }
  else {
    // playwright.configs first: Playwright won't find a config outside the root on its own.
    const t = readTestDir(root, [...new Set([...(config.playwright?.configs ?? []).map(c => c.config), ...CONFIG_FILES])])
    out = t ? { ok: true, folder: t.value, source: 'testDir', configFile: t.file } : { ok: true, folder: DEFAULT_E2E_FOLDER, source: 'default' }
  }
  const f = toForwardSlashes(out.folder).replace(/^(?:\.\/)+/, '')
  const always = ALWAYS.find(a => matches(a, f))
  if (always) return { ok: false, error: `the e2e folder "${out.folder}" is inside "${always}", which a test run never writes: set playwright.folder` }
  const rules = rulesFor(config, root)
  const rule = rules.allow.some(a => matches(a, f)) || allowCovers(rules.allow, f) ? null : rules.forbidden.find(r => matches(r.path, f))
  if (rule) return { ok: false, error: `the e2e folder "${out.folder}" is inside the forbidden "${rule.path}": set playwright.folder, or allow it in boundaries.allow` }
  return out
}

/** Line the CLI prints above the JSON. */
export function e2eFolderLine(r) {
  if (r.source === 'config') return `${r.folder} (from playwright.folder)`
  if (r.source === 'testDir') return `${r.folder} (from testDir in ${r.configFile})`
  if (r.source === 'cypress') return `${r.folder} (Cypress's default)`
  return `${r.folder} (default: no testDir found in a Playwright config)`
}
