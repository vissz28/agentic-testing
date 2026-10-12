// Find, load and validate the team config. The only module that knows where it lives.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_REL = '.claude/agentic-testing.json'
const SETUP = 'Run /agentic-testing:setup.'
const KEY = /^[A-Z][A-Z0-9]+$/
const FIELDS = new Set(['version', 'adapter', 'jira', 'languages', 'features', 'titlePrefixes', 'ticketTemplates', 'ticketsDir', 'redact', 'messages'])
const LANGS = new Set(['en', 'it'])

export const DEFAULTS = Object.freeze({
  titlePrefixes: ['FE', 'BE', 'FS'],
  ticketsDir: '.claude/agentic-testing/tickets',
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
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /agentic-testing:setup)`)
  if (c.version !== 1) e.push(`version: must be 1 (found ${JSON.stringify(c.version)}); re-run /agentic-testing:setup`)
  if (!['playwright', 'vitest'].includes(c.adapter)) e.push(`adapter: must be "playwright" or "vitest" (found ${JSON.stringify(c.adapter)})`)
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  const j = isObj(c.jira) ? c.jira : {}
  if (!isObj(c.jira)) e.push('jira: must be an object with site, projects and acceptanceCriteriaField')
  else {
    if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
    if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "ABC"')
    else j.projects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.projects[${i}] ${JSON.stringify(p)} must be upper-case letters and digits, like "ABC"`) })
    if (!('acceptanceCriteriaField' in j) || !(j.acceptanceCriteriaField === null || (typeof j.acceptanceCriteriaField === 'string' && /^customfield_\d+$/.test(j.acceptanceCriteriaField))))
      e.push('jira.acceptanceCriteriaField: must be null or like "customfield_10001"')
    if (j.trackingProjects !== undefined) {
      if (!Array.isArray(j.trackingProjects)) e.push('jira.trackingProjects: must be a list of keys')
      else j.trackingProjects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.trackingProjects[${i}] ${JSON.stringify(p)} must be upper-case letters and digits`) })
    }
  }
  if (!Array.isArray(c.languages) || c.languages.length === 0) e.push('languages: must list at least one of "en", "it"')
  else c.languages.forEach((l, i) => { if (!LANGS.has(l)) e.push(`languages[${i}] "${l}" is not supported (supported: en, it)`) })
  if (!Array.isArray(c.features)) e.push('features: must be a list (it may be empty)')
  else {
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
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      jira: { trackingProjects: [], ...j },
      titlePrefixes: c.titlePrefixes ?? DEFAULTS.titlePrefixes,
      ticketsDir: normaliseTicketsDir(c.ticketsDir ?? DEFAULTS.ticketsDir),
      redact: c.redact ?? DEFAULTS.redact,
      messages: c.messages ?? DEFAULTS.messages,
      ticketTemplates: { ...DEFAULTS.ticketTemplates, ...(c.ticketTemplates ?? {}) },
    },
  }
}

export function loadConfig(root) {
  const p = configPath(root)
  if (!existsSync(p)) return { ok: false, missing: true, errors: [`This repo is not set up. ${SETUP}`] }
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, errors: [`${CONFIG_REL} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  return validateConfig(obj)
}
