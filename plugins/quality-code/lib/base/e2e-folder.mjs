// Where /quality-code:write puts new Playwright specs: playwright.folder, else the testDir of the
// project's default Playwright config when it is one plain string, else e2e/. The config is read as
// text, never run.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ALWAYS, matches, rulesFor } from './boundary.mjs'

// Playwright's own lookup order for its default config file.
export const CONFIG_FILES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mts', 'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs']
export const DEFAULT_E2E_FOLDER = 'e2e/'

const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')

/** A folder as the rest of the plugin writes it: "/" separators, no leading "./", one trailing "/". */
function normFolder(raw) {
  const s = String(raw).trim().replace(/\\+/g, '/').replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  if (!s || s === '.' || s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..') || /[\r\n]/.test(s)) return null
  return `${s}/`
}

/**
 * { value, file } when the first Playwright config there is sets testDir to one literal; else null.
 * `files` are tried in order: by default Playwright's own names at the root. A testDir is relative to
 * its config file, so a config in e2e/ with testDir './tests' gives e2e/tests/.
 */
export function readTestDir(root, files = CONFIG_FILES) {
  for (const file of files) {
    let src
    try { src = readFileSync(join(root, file), 'utf8') } catch { continue }
    const text = stripComments(src)
    const all = [...text.matchAll(/\btestDir\s*:/g)].length
    const literals = [...text.matchAll(/\btestDir\s*:\s*(['"`])([^'"`\n]*)\1/g)].map(m => m[2])
    // A computed value (path.join, a template with ${…}) cannot be read without running the file.
    if (!all || literals.length !== all || literals.some(v => v.includes('${'))) return null
    const values = [...new Set(literals.map(v => normFolder(dirname(file) === '.' ? v : `${dirname(file)}/${v.replace(/^(?:\.\/)+/, '')}`)))]
    return values.length === 1 && values[0] ? { value: values[0], file } : null
  }
  return null
}

/** → { ok: true, folder, source: 'config' | 'testDir' | 'default', configFile? } | { ok: false, error } */
export function e2eFolder(root, config) {
  if (config?.adapter !== 'playwright' && config?.adapter !== 'fullstack') return { ok: false, error: `the e2e folder is for Playwright projects: this project uses ${config?.adapter}` }
  let out
  if (config.playwright?.folder) out = { ok: true, folder: config.playwright.folder, source: 'config' }
  else {
    // A config named in playwright.configs comes first: Playwright does not find one outside the root.
    const t = readTestDir(root, [...new Set([...(config.playwright?.configs ?? []).map(c => c.config), ...CONFIG_FILES])])
    out = t ? { ok: true, folder: t.value, source: 'testDir', configFile: t.file } : { ok: true, folder: DEFAULT_E2E_FOLDER, source: 'default' }
  }
  const f = out.folder.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const always = ALWAYS.find(a => matches(a, f))
  if (always) return { ok: false, error: `the e2e folder "${out.folder}" is inside "${always}", which a test run never writes: set playwright.folder` }
  const rules = rulesFor(config, root)
  const rule = rules.allow.some(a => matches(a, f)) ? null : rules.forbidden.find(r => matches(r.path, f))
  if (rule) return { ok: false, error: `the e2e folder "${out.folder}" is inside the forbidden "${rule.path}": set playwright.folder, or allow it in boundaries.allow` }
  return out
}

/** The one plain line the CLI prints above the JSON. */
export function e2eFolderLine(r) {
  if (r.source === 'config') return `${r.folder} (from playwright.folder)`
  if (r.source === 'testDir') return `${r.folder} (from testDir in ${r.configFile})`
  return `${r.folder} (default: no testDir found in a Playwright config)`
}
