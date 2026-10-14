// Find, load and validate the team config. The only module that knows where it lives.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matches } from './checks/boundary.mjs'

export const CONFIG_REL = '.claude/quality-code.json'
const SETUP = 'Run /quality-code:setup.'
const KEY = /^[A-Z][A-Z0-9]+$/
const FIELDS = new Set(['version', 'adapter', 'jira', 'languages', 'features', 'titlePrefixes', 'confluenceSpaces', 'ticketTemplates', 'ticketsDir', 'redact', 'messages', 'boundaries', 'vitest'])
const LANGS = new Set(['en', 'it'])
const SPACE_KEY = /^[A-Za-z0-9_~-]+$/
const PATH_RULE = 'must be a relative path inside the project (no "..", not absolute, one line)'
const LAYER_NAME = /^[a-z][a-z0-9-]{0,30}$/
export const DEFAULT_LAYERS = Object.freeze([Object.freeze({ name: 'unit', folder: 'test/' })])
export const DEFAULT_STRYKER_THRESHOLD = 60
const pathOk = p => typeof p === 'string' && p.trim() !== '' && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..') && !/[\r\n]/.test(p)

export const DEFAULTS = Object.freeze({
  languages: ['en', 'it'],
  features: [],
  titlePrefixes: [],
  ticketsDir: '.claude/quality-code/tickets',
  redact: { customerId: '\\bU\\d{5,}\\b' },
  messages: {},
  ticketTemplates: { bug: null, story: null },
})

/** ticketsDir as every caller uses it: "/" separators, no trailing "/". */
export const normaliseTicketsDir = dir => String(dir).replace(/\\/g, '/').replace(/\/+$/, '')

export const projectRoot = (env = process.env, cwd = process.cwd()) => env.CLAUDE_PROJECT_DIR || cwd
export const configPath = root => join(root, CONFIG_REL)

export function validateConfig(input) {
  const e = []
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /quality-code:setup)`)
  if (c.version !== 1) e.push(`version: must be 1 (found ${JSON.stringify(c.version)}); re-run /quality-code:setup`)
  if (!['playwright', 'vitest'].includes(c.adapter)) e.push(`adapter: must be "playwright" or "vitest" (found ${JSON.stringify(c.adapter)})`)
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  const j = isObj(c.jira) ? c.jira : {}
  if (!isObj(c.jira)) e.push('jira: must be an object with site and projects')
  else {
    if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
    if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "ABC"')
    else j.projects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.projects[${i}] ${JSON.stringify(p)} must be upper-case letters and digits, like "ABC"`) })
    if ('acceptanceCriteriaField' in j && !(j.acceptanceCriteriaField === null || (typeof j.acceptanceCriteriaField === 'string' && /^customfield_\d+$/.test(j.acceptanceCriteriaField))))
      e.push('jira.acceptanceCriteriaField: must be null or like "customfield_10001"')
    if (j.trackingProjects !== undefined) {
      if (!Array.isArray(j.trackingProjects)) e.push('jira.trackingProjects: must be a list of keys')
      else j.trackingProjects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.trackingProjects[${i}] ${JSON.stringify(p)} must be upper-case letters and digits`) })
    }
  }
  if (c.languages !== undefined && (!Array.isArray(c.languages) || c.languages.length === 0)) e.push('languages: must list at least one of "en", "it"')
  else if (c.languages !== undefined) c.languages.forEach((l, i) => { if (!LANGS.has(l)) e.push(`languages[${i}] "${l}" is not supported (supported: en, it)`) })
  if (c.features !== undefined && !Array.isArray(c.features)) e.push('features: must be a list (it may be empty)')
  else if (c.features !== undefined) {
    const seen = new Set()
    c.features.forEach((f, i) => {
      if (!f || typeof f.label !== 'string' || !f.label.trim()) e.push(`features[${i}].label: must be a non-empty text`)
      else if (seen.has(f.label)) e.push(`features[${i}].label "${f.label}" appears twice`)
      else seen.add(f.label)
      if (f?.qaPlanSearch !== undefined && (typeof f.qaPlanSearch !== 'string' || !f.qaPlanSearch.trim())) e.push(`features[${i}].qaPlanSearch: must be a non-empty text (the words to search for the QA plan)`)
      if (f?.route != null) {
        if (typeof f.route !== 'string') e.push(`features[${i}].route: must be text starting with "/"`)
        else if (!f.route.startsWith('/')) e.push(`features[${i}].route "${f.route}" must start with "/"`)
      }
    })
  }
  if (c.titlePrefixes !== undefined) {
    if (!Array.isArray(c.titlePrefixes)) e.push('titlePrefixes: must be a list of non-empty texts')
    else c.titlePrefixes.forEach((t, i) => { if (typeof t !== 'string' || !t.trim()) e.push(`titlePrefixes[${i}]: must be a non-empty text`) })
  }
  // Absent means the QA-plan search looks in every Confluence space.
  if (c.confluenceSpaces !== undefined) {
    if (!Array.isArray(c.confluenceSpaces)) e.push('confluenceSpaces: must be a list of Confluence space keys like "ABC"')
    else if (!c.confluenceSpaces.length) e.push('confluenceSpaces: must name at least one space; leave it out to search all spaces')
    else c.confluenceSpaces.forEach((k, i) => {
      if (typeof k !== 'string' || !SPACE_KEY.test(k)) e.push(`confluenceSpaces[${i}] ${JSON.stringify(k)} must be a Confluence space key: letters, digits, "_", "~" or "-", like "ABC"`)
    })
  }
  if (c.ticketsDir !== undefined) {
    if (typeof c.ticketsDir !== 'string' || !normaliseTicketsDir(c.ticketsDir).trim()) e.push('ticketsDir: must be a non-empty text')
    else if (/[\r\n]/.test(c.ticketsDir)) e.push('ticketsDir: must be on one line (no line breaks)')
  }
  if (c.ticketTemplates !== undefined) {
    if (!isObj(c.ticketTemplates)) e.push('ticketTemplates: must be an object with optional "bug" and "story"')
    else for (const [k, v] of Object.entries(c.ticketTemplates)) {
      if (k !== 'bug' && k !== 'story') e.push(`ticketTemplates.${k}: unknown field (only "bug" and "story")`)
      else if (v !== null && typeof v !== 'string') e.push(`ticketTemplates.${k}: must be text or null`)
    }
  }
  if (c.redact !== undefined) {
    if (!isObj(c.redact)) e.push('redact: must be an object of name to regular expression')
    else for (const [name, src] of Object.entries(c.redact)) {
      if (typeof src !== 'string') { e.push(`redact.${name}: must be a text (a regular expression)`); continue }
      let re
      try { re = new RegExp(src) } catch { e.push(`redact.${name}: not a valid regular expression`); continue }
      if (re.test('')) e.push(`redact.${name}: must not match empty text (it would insert the mask between every character)`)
    }
  }
  if (c.messages !== undefined && !isObj(c.messages)) e.push('messages: must be an object')
  else if (c.messages?.jiraFillMark !== undefined && (typeof c.messages.jiraFillMark !== 'string' || !c.messages.jiraFillMark.trim()))
    e.push('messages.jiraFillMark: must be a non-empty text (the line above what a fill-in adds to Jira)')
  if (c.boundaries !== undefined) {
    if (!isObj(c.boundaries)) e.push('boundaries: must be an object with "forbidden" and/or "allow"')
    else {
      for (const k of Object.keys(c.boundaries)) if (k !== 'forbidden' && k !== 'allow') e.push(`boundaries.${k}: unknown field (only "forbidden" and "allow")`)
      const f = c.boundaries.forbidden
      if (f !== undefined) {
        if (!Array.isArray(f) || f.length === 0) e.push('boundaries.forbidden: must be a non-empty list of { "path", "why" }')
        else f.forEach((r, i) => {
          if (!isObj(r)) { e.push(`boundaries.forbidden[${i}]: must be an object with "path" and an optional "why"`); return }
          if (!pathOk(r.path)) e.push(`boundaries.forbidden[${i}].path ${JSON.stringify(r.path)} ${PATH_RULE}`)
          if (r.why !== undefined && (typeof r.why !== 'string' || !r.why.trim() || /[\r\n]/.test(r.why))) e.push(`boundaries.forbidden[${i}].why: must be one non-empty line`)
          for (const k of Object.keys(r)) if (k !== 'path' && k !== 'why') e.push(`boundaries.forbidden[${i}].${k}: unknown field (only "path" and "why")`)
        })
      }
      const a = c.boundaries.allow
      if (a !== undefined) {
        if (!Array.isArray(a)) e.push('boundaries.allow: must be a list of path patterns')
        else a.forEach((p, i) => { if (!pathOk(p)) e.push(`boundaries.allow[${i}] ${JSON.stringify(p)} ${PATH_RULE}`) })
      }
    }
  }
  if (c.vitest !== undefined) {
    if (c.adapter !== 'vitest') e.push('vitest: only allowed with "adapter": "vitest"')
    else if (!isObj(c.vitest)) e.push('vitest: must be an object')
    else {
      for (const k of Object.keys(c.vitest)) if (!['configs', 'tsconfig', 'timeoutSeconds', 'layers', 'stryker'].includes(k)) e.push(`vitest.${k}: unknown field (only "configs", "tsconfig", "timeoutSeconds", "layers" and "stryker")`)
      const cf = c.vitest.configs
      if (cf !== undefined) {
        if (!Array.isArray(cf)) e.push('vitest.configs: must be a list of { "match", "config" }')
        else cf.forEach((x, i) => {
          if (!isObj(x)) { e.push(`vitest.configs[${i}]: must be an object with "match" and "config"`); return }
          for (const f of ['match', 'config']) if (!pathOk(x[f])) e.push(`vitest.configs[${i}].${f} ${JSON.stringify(x[f])} ${PATH_RULE}`)
        })
      }
      if (c.vitest.tsconfig !== undefined && !pathOk(c.vitest.tsconfig)) e.push(`vitest.tsconfig ${JSON.stringify(c.vitest.tsconfig)} ${PATH_RULE}`)
      const t = c.vitest.timeoutSeconds
      if (t !== undefined && !(Number.isInteger(t) && t >= 10 && t <= 3600)) e.push('vitest.timeoutSeconds: must be a whole number from 10 to 3600')
      const ls = c.vitest.layers
      if (ls !== undefined) {
        if (!Array.isArray(ls) || ls.length < 1 || ls.length > 5) e.push('vitest.layers: must be a list of 1 to 5 { "name", "folder", "guide" }')
        else {
          // The default boundary when none is configured; the CI files never hold a folder of tests.
          const forbidden = Array.isArray(c.boundaries?.forbidden) ? c.boundaries.forbidden.filter(r => isObj(r) && pathOk(r.path)) : [{ path: 'src/' }, { path: '.env' }, { path: '.env.*' }]
          const allow = Array.isArray(c.boundaries?.allow) ? c.boundaries.allow.filter(pathOk) : []
          const seen = new Set()
          ls.forEach((l, i) => {
            if (!isObj(l)) { e.push(`vitest.layers[${i}]: must be an object with "name", "folder" and an optional "guide"`); return }
            for (const k of Object.keys(l)) if (!['name', 'folder', 'guide'].includes(k)) e.push(`vitest.layers[${i}].${k}: unknown field (only "name", "folder" and "guide")`)
            if (typeof l.name !== 'string' || !LAYER_NAME.test(l.name)) e.push(`vitest.layers[${i}].name ${JSON.stringify(l.name)} must be lower-case letters, digits and "-", starting with a letter, like "unit"`)
            else if (seen.has(l.name)) e.push(`vitest.layers[${i}].name "${l.name}" appears twice`)
            else seen.add(l.name)
            if (!pathOk(l.folder)) e.push(`vitest.layers[${i}].folder ${JSON.stringify(l.folder)} ${PATH_RULE}`)
            else if (!l.folder.endsWith('/')) e.push(`vitest.layers[${i}].folder "${l.folder}" must end with "/"`)
            else {
              const f = l.folder.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
              const rule = allow.some(a => matches(a, f)) ? null : forbidden.find(r => matches(r.path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, ''), f))
              if (rule) e.push(`vitest.layers[${i}].folder "${l.folder}" is inside the forbidden "${rule.path}"`)
            }
            if (l.guide !== undefined && !(pathOk(l.guide) && /\.md$/i.test(l.guide))) e.push(`vitest.layers[${i}].guide ${JSON.stringify(l.guide)} must be a relative path to a .md file inside the project`)
          })
        }
      }
      const st = c.vitest.stryker
      if (st !== undefined) {
        if (!isObj(st)) e.push('vitest.stryker: must be an object with an optional "threshold"')
        else {
          for (const k of Object.keys(st)) if (k !== 'threshold') e.push(`vitest.stryker.${k}: unknown field (only "threshold")`)
          if (st.threshold !== undefined && !(Number.isInteger(st.threshold) && st.threshold >= 0 && st.threshold <= 100)) e.push('vitest.stryker.threshold: must be a whole number from 0 to 100')
        }
      }
    }
  }
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      jira: { trackingProjects: [], ...j },
      languages: c.languages ?? DEFAULTS.languages,
      features: c.features ?? DEFAULTS.features,
      titlePrefixes: c.titlePrefixes ?? DEFAULTS.titlePrefixes,
      ticketsDir: normaliseTicketsDir(c.ticketsDir ?? DEFAULTS.ticketsDir),
      redact: c.redact ?? DEFAULTS.redact,
      messages: c.messages ?? DEFAULTS.messages,
      ticketTemplates: { ...DEFAULTS.ticketTemplates, ...(c.ticketTemplates ?? {}) },
    },
  }
}

/** The test folders a writing run may use: the configured layers, else one "unit" layer in test/. */
export const layersOf = config => config?.vitest?.layers ?? DEFAULT_LAYERS

/** The share of Stryker mutants the tests must catch, as a whole percentage. */
export const strykerThreshold = config => config?.vitest?.stryker?.threshold ?? DEFAULT_STRYKER_THRESHOLD

export function loadConfig(root) {
  const p = configPath(root)
  if (!existsSync(p)) return { ok: false, missing: true, errors: [`This repo is not set up. ${SETUP}`] }
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, errors: [`${CONFIG_REL} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  return validateConfig(obj)
}
