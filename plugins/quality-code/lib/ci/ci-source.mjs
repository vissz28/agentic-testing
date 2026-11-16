// Where CI clones the plugin from. Mirrors override via ci.pluginSource or QUALITY_CODE_PLUGIN_URL/_REF.
export const DEFAULT_PLUGIN_URL = 'https://github.com/vissz28/agentic-testing.git'

// https, no credentials, and only characters safe inside a shell command.
const URL_OK = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?(\/[A-Za-z0-9._~%+-]+)+$/
const REF_OK = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/

export const urlOk = u => typeof u === 'string' && URL_OK.test(u) && !u.includes('..')
export const refOk = r => typeof r === 'string' && REF_OK.test(r) && !r.includes('..') && !r.endsWith('/') && !r.endsWith('.lock')

export function ciErrors(ci) {
  if (ci === undefined) return []
  if (!ci || typeof ci !== 'object' || Array.isArray(ci)) return ['ci: must be an object with an optional "pluginSource"']
  const e = []
  for (const k of Object.keys(ci)) if (k !== 'pluginSource') e.push(`ci.${k}: unknown field (only "pluginSource")`)
  const s = ci.pluginSource
  if (s === undefined) return e
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [...e, 'ci.pluginSource: must be { "url": "https://...", "ref": "<tag or branch>" }']
  for (const k of Object.keys(s)) if (k !== 'url' && k !== 'ref') e.push(`ci.pluginSource.${k}: unknown field (only "url" and "ref")`)
  if (s.url !== undefined && !urlOk(s.url)) e.push(`ci.pluginSource.url ${JSON.stringify(s.url)} must be an https address with no credentials, like "https://git.example.com/team/agentic-testing.git"`)
  if (s.ref !== undefined && !refOk(s.ref)) e.push(`ci.pluginSource.ref ${JSON.stringify(s.ref)} must be a tag or branch name (letters, digits, ".", "_", "-", "/")`)
  return e
}

/** Env wins over config, config over the default (this version's tag). */
export function pluginSource(config, env, version) {
  const c = config?.ci?.pluginSource ?? {}
  const url = env.QUALITY_CODE_PLUGIN_URL || c.url || DEFAULT_PLUGIN_URL
  const ref = env.QUALITY_CODE_PLUGIN_REF || c.ref || `quality-code--v${version}`
  if (!urlOk(url)) return { error: `the plugin source ${JSON.stringify(url)} must be an https address with no credentials (ci.pluginSource.url or QUALITY_CODE_PLUGIN_URL)` }
  if (!refOk(ref)) return { error: `the plugin ref ${JSON.stringify(ref)} must be a tag or branch name (ci.pluginSource.ref or QUALITY_CODE_PLUGIN_REF)` }
  return { url, ref, custom: url !== DEFAULT_PLUGIN_URL }
}
