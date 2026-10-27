// Find, load and validate the team config. The only module that knows where it lives.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { matches } from './boundary.mjs'
import { BACKEND_ADAPTERS, BACKENDS, backendOf, isBackend } from './backends.mjs'
import { RUNNERS } from './runners.mjs'
import { placeDirs, placeOf } from './places.mjs'
import { FLOWS } from './conventions.mjs'

export const CONFIG_REL = '.claude/quality-code.json'
const SETUP = 'Run /quality-code:setup.'
const KEY = /^[A-Z][A-Z0-9_]+$/
const FIELDS = new Set(['$schema', 'root', 'git', 'version', 'adapter', 'runners', 'jira', 'languages', 'features', 'titlePrefixes', 'confluenceSpaces', 'ticketTemplates', 'ticketsDir', 'testFlow', 'redact', 'messages', 'boundaries', 'vitest', 'playwright', 'seed', 'sides', 'qaPlans', 'xray', 'confluence', 'backend', ...BACKEND_ADAPTERS])
const LANGS = new Set(['en', 'it'])
const ADAPTERS = ['playwright', ...BACKEND_ADAPTERS, 'fullstack']
// The backends other than Vitest: each has a block of its own options, named after it.
const OTHER_BACKENDS = BACKEND_ADAPTERS.filter(a => a !== 'vitest')
// The placeholders a backend's own test command may hold.
const COMMAND_SLOTS = new Set(['files', 'report', 'test'])
const quoted = list => list.map(a => `"${a}"`)
const orList = list => `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`
const SPACE_KEY = /^[A-Za-z0-9_~-]+$/
const PATH_RULE = 'must be a relative path inside the project (no "..", not absolute, one line)'
const LAYER_NAME = /^[a-z][a-z0-9-]{0,30}$/
export const DEFAULT_LAYERS = Object.freeze([Object.freeze({ name: 'unit', folder: 'test/' })])
export const DEFAULT_STRYKER_THRESHOLD = 60
// Stryker reruns the tests once per code change: minutes on a database-backed suite, so not the tests' limit.
export const DEFAULT_STRYKER_TIMEOUT_SECONDS = 1800
// The XRay CSV's columns in order, with their default header; "data" is no column: it is the word
// before a step's data in the action cell. A team's importer mapping may want other headers.
export const XRAY_HEADERS = Object.freeze({ tcid: 'TC ID', summary: 'Summary', description: 'Description', step: 'Step', action: 'Action', expected: 'Expected Result', label: 'Label', priority: 'Priority', component: 'Component', ticket: 'Linked Issues', epic: 'Epic', testType: 'Test Type', data: 'Data' })
export const XRAY_COLUMNS = Object.freeze(Object.keys(XRAY_HEADERS).filter(k => k !== 'data'))
// The tags write puts on red Playwright tests: a ticket scenario's and an extra probe's.
export const DEFAULT_RED_TAGS = Object.freeze({ scenario: '@anchor', extra: '@finding' })
// Jira statuses that say the work is finished: a red run then warns that the bug is still there.
export const DEFAULT_DONE_STATUSES = Object.freeze(['Test OK', 'Done', 'Ready for test', 'Closed', 'Resolved', 'Chiuso', 'Risolto'])
const pathOk = p => typeof p === 'string' && p.trim() !== '' && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split(/[\\/]/).includes('..') && !/[\r\n]/.test(p)

export const DEFAULTS = Object.freeze({
  languages: ['en'],
  features: [],
  titlePrefixes: [],
  ticketsDir: '.quality-code/tickets',
  redact: { customerId: '\\bU\\d{5,}\\b' },
  messages: {},
  ticketTemplates: { bug: null, story: null },
})

/** ticketsDir as every caller uses it: "/" separators, no leading "./", no trailing "/". */
export const normaliseTicketsDir = dir => String(dir).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')

const hasConfig = dir => existsSync(join(dir, CONFIG_REL))

/** The nearest folder at or above dir that holds the config, or null. */
function findHome(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (hasConfig(d)) return d
    if (dirname(d) === d) return null
  }
}

/** The project of the config in home: the folder its root field names (an app in web/), else home. A bad root is left to validateConfig. */
function withRoot(home) {
  let r
  try { r = JSON.parse(readFileSync(join(home, CONFIG_REL), 'utf8'))?.root } catch {}
  return pathOk(r) ? resolve(home, r) : home
}

/** The project dir is in: that of the nearest config at or above it, or null. */
export function findRoot(dir) {
  const home = findHome(dir)
  return home && withRoot(home)
}

/** The folder whose config governs the project at root: root itself, else the one above whose root field names it. */
export function configHome(root) {
  if (hasConfig(root)) return root
  const up = findHome(dirname(resolve(root)))
  return up && withRoot(up) === resolve(root) ? up : root
}

/**
 * The project: CLAUDE_PROJECT_DIR when it holds the config, else the nearest folder up from cwd that
 * does (a script run from src/, a package of a monorepo); with no config anywhere, CLAUDE_PROJECT_DIR
 * or cwd, where setup writes it. A config whose root field names a subfolder makes that the project.
 */
export function projectRoot(env = process.env, cwd = process.cwd()) {
  const dir = env.CLAUDE_PROJECT_DIR
  if (dir && hasConfig(dir)) return withRoot(dir)
  return findRoot(cwd) ?? (dir || cwd)
}
export const configPath = root => join(root, CONFIG_REL)

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The fields the vitest and playwright blocks share: configs, tsconfig, timeoutSeconds. */
function runnerFields(b, name, e) {
  const cf = b.configs
  if (cf !== undefined) {
    if (!Array.isArray(cf)) e.push(`${name}.configs: must be a list of { "match", "config" }`)
    else cf.forEach((x, i) => {
      if (!isObject(x)) { e.push(`${name}.configs[${i}]: must be an object with "match" and "config"`); return }
      for (const f of ['match', 'config']) if (!pathOk(x[f])) e.push(`${name}.configs[${i}].${f} ${JSON.stringify(x[f])} ${PATH_RULE}`)
    })
  }
  if (b.tsconfig !== undefined && !pathOk(b.tsconfig)) e.push(`${name}.tsconfig ${JSON.stringify(b.tsconfig)} ${PATH_RULE}`)
  const t = b.timeoutSeconds
  if (t !== undefined && !(Number.isInteger(t) && t >= 10 && t <= 3600)) e.push(`${name}.timeoutSeconds: must be a whole number from 10 to 3600`)
}

/** The rules a test folder is checked against: the configured boundaries, else the default ones. */
function folderRules(c) {
  // The default boundary when none is configured; the CI files never hold a folder of tests.
  const forbidden = Array.isArray(c.boundaries?.forbidden) ? c.boundaries.forbidden.filter(r => isObject(r) && pathOk(r.path)) : [{ path: 'src/' }, { path: '.env' }, { path: '.env.*' }]
  const allow = Array.isArray(c.boundaries?.allow) ? c.boundaries.allow.filter(pathOk) : []
  return { forbidden, allow }
}

/** A folder a writing run writes in: relative, ending in "/", not inside a forbidden rule unless allowed. */
function folderErrors(folder, name, rules, e) {
  if (!pathOk(folder)) return e.push(`${name} ${JSON.stringify(folder)} ${PATH_RULE}`)
  if (!folder.endsWith('/')) return e.push(`${name} "${folder}" must end with "/"`)
  const f = folder.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  const rule = rules.allow.some(a => matches(a, f)) ? null : rules.forbidden.find(r => matches(r.path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, ''), f))
  if (rule) e.push(`${name} "${folder}" is inside the forbidden "${rule.path}"`)
}

const guideOk = g => pathOk(g) && /\.md$/i.test(g)

/** The layers of a backend block: 1 to 5 { name, folder, guide }, names unique, folders writable. */
function layerErrors(ls, name, rules, e) {
  if (ls === undefined) return
  if (!Array.isArray(ls) || ls.length < 1 || ls.length > 5) return e.push(`${name}.layers: must be a list of 1 to 5 { "name", "folder", "guide" }`)
  const seen = new Set()
  ls.forEach((l, i) => {
    if (!isObject(l)) { e.push(`${name}.layers[${i}]: must be an object with "name", "folder" and an optional "guide"`); return }
    for (const k of Object.keys(l)) if (!['name', 'folder', 'guide'].includes(k)) e.push(`${name}.layers[${i}].${k}: unknown field (only "name", "folder" and "guide")`)
    if (typeof l.name !== 'string' || !LAYER_NAME.test(l.name)) e.push(`${name}.layers[${i}].name ${JSON.stringify(l.name)} must be lower-case letters, digits and "-", starting with a letter, like "unit"`)
    else if (seen.has(l.name)) e.push(`${name}.layers[${i}].name "${l.name}" appears twice`)
    else seen.add(l.name)
    folderErrors(l.folder, `${name}.layers[${i}].folder`, rules, e)
    if (l.guide !== undefined && !guideOk(l.guide)) e.push(`${name}.layers[${i}].guide ${JSON.stringify(l.guide)} must be a relative path to a .md file inside the project`)
  })
}

/** One line of shell text, not empty. */
const lineOk = v => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v)

/** The block of a backend other than Vitest: layers, timeoutSeconds, command (and pytest's typeCheck). */
function otherBackendErrors(b, name, e) {
  const fields = ['layers', 'timeoutSeconds', 'command', ...(name === 'pytest' ? ['typeCheck'] : [])]
  for (const k of Object.keys(b)) if (!fields.includes(k)) e.push(`${name}.${k}: unknown field (only ${orList(quoted(fields))})`)
  const t = b.timeoutSeconds
  if (t !== undefined && !(Number.isInteger(t) && t >= 10 && t <= 3600)) e.push(`${name}.timeoutSeconds: must be a whole number from 10 to 3600`)
  // The test file names are the backend's own, so a layer may sit in a code folder (src/test/java/, Go's
  // tests beside the code): the boundary lets test files through by their name, see boundary.mjs.
  layerErrors(b.layers, name, { forbidden: [], allow: [] }, e)
  if (b.command !== undefined) {
    if (!lineOk(b.command)) e.push(`${name}.command: must be one line of text, the project's test command, like "${name === 'pytest' ? 'poetry run pytest {files} --junitxml={report}' : 'make test'}"`)
    else for (const m of b.command.matchAll(/\{([^}]*)\}/g)) if (!COMMAND_SLOTS.has(m[1])) e.push(`${name}.command: unknown placeholder {${m[1]}} (only {files}, {report} and {test})`)
  }
  if (b.typeCheck !== undefined && !lineOk(b.typeCheck)) e.push(`${name}.typeCheck: must be one line of text, the type-check command, like "mypy {files}"`)
}

export function validateConfig(input, { allowAbsoluteTicketsDir = false } = {}) {
  const e = []
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  for (const k of Object.keys(c)) if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /quality-code:setup)`)
  if (c.version !== 1) e.push(`version: must be 1 (found ${JSON.stringify(c.version)}); re-run /quality-code:setup`)
  if (c.root !== undefined && !pathOk(c.root)) e.push(`root ${JSON.stringify(c.root)} must be a folder inside the repository, like "web" (no "..", not absolute, one line)`)
  if (!ADAPTERS.includes(c.adapter)) e.push(`adapter: must be "playwright" (frontend), ${orList(quoted(BACKEND_ADAPTERS))} (backend) or "fullstack" (both) (found ${JSON.stringify(c.adapter)})`)
  // The backend side of a fullstack project: the "backend" field, else Vitest.
  const backend = c.adapter === 'fullstack' ? (isBackend(c.backend) ? c.backend : 'vitest') : c.adapter
  const uses = a => c.adapter === a || (c.adapter === 'fullstack' && (a === 'playwright' || a === backend))
  if (c.backend !== undefined) {
    if (c.adapter !== 'fullstack') e.push('backend: only allowed with "adapter": "fullstack" (on a backend project the adapter names the runner)')
    else if (!isBackend(c.backend)) e.push(`backend: must be ${orList(quoted(BACKEND_ADAPTERS))} (found ${JSON.stringify(c.backend)})`)
  }
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  const j = isObj(c.jira) ? c.jira : {}
  if (!isObj(c.jira)) e.push('jira: must be an object with site and projects')
  else {
    if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+(?:\/\S*)?$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
    if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "ABC"')
    else j.projects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.projects[${i}] ${JSON.stringify(p)} must be upper-case letters, digits and "_", like "ABC"`) })
    if ('acceptanceCriteriaField' in j && !(j.acceptanceCriteriaField === null || (typeof j.acceptanceCriteriaField === 'string' && /^customfield_\d+$/.test(j.acceptanceCriteriaField))))
      e.push('jira.acceptanceCriteriaField: must be null or like "customfield_10001"')
    if (j.bugTypes !== undefined && (!Array.isArray(j.bugTypes) || !j.bugTypes.length || !j.bugTypes.every(t => typeof t === 'string' && t.trim())))
      e.push('jira.bugTypes: must be a non-empty list of issue type names, like ["Bug", "Defect"]')
    if (j.doneStatuses !== undefined && (!Array.isArray(j.doneStatuses) || j.doneStatuses.some(s => typeof s !== 'string' || !s.trim())))
      e.push('jira.doneStatuses: must be a list of Jira status names, like ["Done", "Closed"]')
    if (j.trackingProjects !== undefined) {
      if (!Array.isArray(j.trackingProjects)) e.push('jira.trackingProjects: must be a list of keys')
      else j.trackingProjects.forEach((p, i) => { if (typeof p !== 'string' || !KEY.test(p)) e.push(`jira.trackingProjects[${i}] ${JSON.stringify(p)} must be upper-case letters, digits and "_"`) })
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
  if (c.confluence !== undefined && typeof c.confluence !== 'boolean') e.push('confluence: must be true or false (false: the team has no Confluence, so no QA plan is looked for or scored)')
  // Absent means the QA-plan search looks in every Confluence space.
  if (c.confluenceSpaces !== undefined) {
    if (!Array.isArray(c.confluenceSpaces)) e.push('confluenceSpaces: must be a list of Confluence space keys like "ABC"')
    else if (!c.confluenceSpaces.length) e.push('confluenceSpaces: must name at least one space; leave it out to search all spaces')
    else c.confluenceSpaces.forEach((k, i) => {
      if (typeof k !== 'string' || !SPACE_KEY.test(k)) e.push(`confluenceSpaces[${i}] ${JSON.stringify(k)} must be a Confluence space key: letters, digits, "_", "~" or "-", like "ABC"`)
    })
  }
  if (c.testFlow !== undefined && !FLOWS.includes(c.testFlow)) e.push(`testFlow ${JSON.stringify(c.testFlow)}: must be "project" (follow the project's own tests) or "quality-code"`)
  if (c.ticketsDir !== undefined) {
    if (typeof c.ticketsDir !== 'string' || !normaliseTicketsDir(c.ticketsDir).trim()) e.push('ticketsDir: must be a non-empty text')
    else if (/[\r\n]/.test(c.ticketsDir)) e.push('ticketsDir: must be on one line (no line breaks)')
    else {
      const absOk = allowAbsoluteTicketsDir && isAbsolute(c.ticketsDir) && !normaliseTicketsDir(c.ticketsDir).split('/').includes('..')
      if (!absOk && !pathOk(c.ticketsDir)) e.push(`ticketsDir ${JSON.stringify(c.ticketsDir)} ${PATH_RULE}`)
    }
  }
  // The branch a feature branch starts from, when origin/HEAD is not it (gitflow: develop).
  if (c.git !== undefined) {
    if (!isObj(c.git)) e.push('git: must be an object with an optional "base"')
    else {
      for (const k of Object.keys(c.git)) if (k !== 'base') e.push(`git.${k}: unknown field (only "base")`)
      const b = c.git.base
      if (b !== undefined && (typeof b !== 'string' || !b.trim() || b.startsWith('-') || /[\s~^:?*[\\]/.test(b))) e.push(`git.base ${JSON.stringify(b)} must be a branch name, like "develop"`)
    }
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
  if (c.runners !== undefined) {
    if (!isObj(c.runners)) e.push('runners: must be an object with "unit" and/or "e2e"')
    else for (const [kind, name] of Object.entries(c.runners)) {
      const ok = Object.keys(RUNNERS).filter(r => RUNNERS[r].kind === kind)
      if (!ok.length) e.push(`runners.${kind}: unknown field (only "unit" and "e2e")`)
      else if (!ok.includes(name)) e.push(`runners.${kind}: must be ${ok.map(r => `"${r}"`).join(', ')} (found ${JSON.stringify(name)})`)
      // Jest and Mocha run JavaScript: a pytest, JUnit, Go or .NET backend has its own runner already.
      else if (kind === 'unit' && isBackend(backend) && backend !== 'vitest') e.push(`runners.unit: ${JSON.stringify(name)} runs JavaScript tests, and this project's backend is ${BACKENDS[backend].label}, which runs its own tests: leave runners.unit out (it is only for a Vitest backend)`)
      else if (!uses(kind === 'unit' ? 'vitest' : 'playwright')) e.push(`runners.${kind}: only allowed with "adapter": "${kind === 'unit' ? 'vitest' : 'playwright'}" or "fullstack"`)
    }
  }
  if (c.vitest !== undefined) {
    if (!uses('vitest')) e.push('vitest: only allowed with "adapter": "vitest" or "fullstack"')
    else if (!isObj(c.vitest)) e.push('vitest: must be an object')
    else {
      for (const k of Object.keys(c.vitest)) if (!['configs', 'tsconfig', 'timeoutSeconds', 'layers', 'stryker'].includes(k)) e.push(`vitest.${k}: unknown field (only "configs", "tsconfig", "timeoutSeconds", "layers" and "stryker")`)
      runnerFields(c.vitest, 'vitest', e)
      layerErrors(c.vitest.layers, 'vitest', folderRules(c), e)
      const st = c.vitest.stryker
      if (st !== undefined) {
        if (!isObj(st)) e.push('vitest.stryker: must be an object with an optional "threshold" and "timeoutSeconds"')
        else {
          for (const k of Object.keys(st)) if (k !== 'threshold' && k !== 'timeoutSeconds') e.push(`vitest.stryker.${k}: unknown field (only "threshold" and "timeoutSeconds")`)
          if (st.threshold !== undefined && !(Number.isInteger(st.threshold) && st.threshold >= 0 && st.threshold <= 100)) e.push('vitest.stryker.threshold: must be a whole number from 0 to 100')
          if (st.timeoutSeconds !== undefined && !(Number.isInteger(st.timeoutSeconds) && st.timeoutSeconds >= 60 && st.timeoutSeconds <= 7200)) e.push('vitest.stryker.timeoutSeconds: must be a whole number from 60 to 7200')
        }
      }
    }
  }
  for (const name of OTHER_BACKENDS) {
    if (c[name] === undefined) continue
    if (!uses(name)) e.push(`${name}: only allowed with "adapter": "${name}", or "fullstack" with "backend": "${name}"`)
    else if (!isObj(c[name])) e.push(`${name}: must be an object`)
    else otherBackendErrors(c[name], name, e)
  }
  if (c.playwright !== undefined) {
    if (!uses('playwright')) e.push('playwright: only allowed with "adapter": "playwright" or "fullstack"')
    else if (!isObj(c.playwright)) e.push('playwright: must be an object')
    else {
      for (const k of Object.keys(c.playwright)) if (!['configs', 'projects', 'tsconfig', 'timeoutSeconds', 'folder', 'guide', 'ungradedTitles', 'redTags'].includes(k)) e.push(`playwright.${k}: unknown field (only "configs", "projects", "tsconfig", "timeoutSeconds", "folder", "guide", "ungradedTitles" and "redTags")`)
      runnerFields(c.playwright, 'playwright', e)
      const u = c.playwright.ungradedTitles
      if (u !== undefined) {
        let re = null
        try { re = typeof u === 'string' && u.trim() ? new RegExp(u, 'i') : null } catch {}
        if (!re || re.test('')) e.push('playwright.ungradedTitles: must be a regular expression that matches the titles of tests that never assert (screenshot captures), like "conformance|capture"')
      }
      const rt = c.playwright.redTags
      if (rt !== undefined && rt !== null) {
        if (!isObj(rt)) e.push('playwright.redTags: must be null (no tags) or an object with "scenario" and "extra"')
        else for (const k of Object.keys(rt)) {
          if (k !== 'scenario' && k !== 'extra') e.push(`playwright.redTags.${k}: unknown field (only "scenario" and "extra")`)
          else if (typeof rt[k] !== 'string' || !/^@[\w-]+$/.test(rt[k])) e.push(`playwright.redTags.${k}: must be a tag like "@anchor"`)
        }
      }
      if (c.playwright.folder !== undefined) folderErrors(c.playwright.folder, 'playwright.folder', folderRules(c), e)
      if (c.playwright.guide !== undefined && !guideOk(c.playwright.guide)) e.push(`playwright.guide ${JSON.stringify(c.playwright.guide)} must be a relative path to a .md file inside the project`)
      const ps = c.playwright.projects
      if (ps !== undefined) {
        if (!Array.isArray(ps) || ps.length < 1 || ps.length > 10) e.push('playwright.projects: must be a list of 1 to 10 project names')
        else {
          const seen = new Set()
          ps.forEach((p, i) => {
            if (typeof p !== 'string' || !p.trim() || p.startsWith('-') || /[\r\n]/.test(p)) e.push(`playwright.projects[${i}] ${JSON.stringify(p)} must be a project name of your Playwright config: one line, not empty, not starting with "-"`)
            else if (seen.has(p)) e.push(`playwright.projects[${i}] "${p}" appears twice`)
            else seen.add(p)
          })
        }
      }
    }
  }
  if (c.seed !== undefined) {
    if (!isObj(c.seed)) e.push('seed: must be an object with optional "builders", "dataset", "stubsFrom" and "guide"')
    else {
      const s = c.seed
      for (const k of Object.keys(s)) if (!['builders', 'dataset', 'stubsFrom', 'guide'].includes(k)) e.push(`seed.${k}: unknown field (only "builders", "dataset", "stubsFrom" and "guide")`)
      if (s.guide !== undefined && !guideOk(s.guide)) e.push(`seed.guide ${JSON.stringify(s.guide)} must be a relative path to a .md file inside the project`)
      if (s.builders !== undefined) {
        if (!uses('vitest')) e.push('seed.builders: only allowed with "adapter": "vitest" or "fullstack" (Playwright seeds with route stubs, see seed.stubsFrom)')
        else if (!Array.isArray(s.builders) || s.builders.length < 1 || s.builders.length > 10) e.push('seed.builders: must be a list of 1 to 10 files that hold the seed builders')
        else {
          const seen = new Set()
          s.builders.forEach((b, i) => {
            if (!pathOk(b)) e.push(`seed.builders[${i}] ${JSON.stringify(b)} ${PATH_RULE}`)
            else if (b.endsWith('/') || b.endsWith('\\')) e.push(`seed.builders[${i}] "${b}" must be a file, not a folder`)
            else if (seen.has(b)) e.push(`seed.builders[${i}] "${b}" appears twice`)
            else seen.add(b)
          })
        }
      }
      if (s.dataset !== undefined && !(pathOk(s.dataset) && /\.md$/i.test(s.dataset))) e.push(`seed.dataset ${JSON.stringify(s.dataset)} must be a relative path to a .md file inside the project`)
      if (s.stubsFrom !== undefined) {
        if (!uses('playwright')) e.push('seed.stubsFrom: only allowed with "adapter": "playwright" or "fullstack" (Vitest seeds with builder calls, see seed.builders)')
        else if (!pathOk(s.stubsFrom)) e.push(`seed.stubsFrom ${JSON.stringify(s.stubsFrom)} ${PATH_RULE}`)
        else if (!s.stubsFrom.endsWith('/')) e.push(`seed.stubsFrom "${s.stubsFrom}" must be a folder ending with "/"`)
      }
    }
  }
  // A folder of QA plans as Markdown, one per feature label: extra rules write reads (never scored).
  if (c.qaPlans !== undefined && !(pathOk(c.qaPlans) && c.qaPlans.endsWith('/'))) e.push(`qaPlans ${JSON.stringify(c.qaPlans)} must be a folder inside the project, ending with "/" (one <feature label>.md per feature)`)
  if (c.xray !== undefined) {
    if (!uses('playwright')) e.push('xray: only allowed with "adapter": "playwright" or "fullstack" (XRay test cases are written for Playwright tests)')
    else if (!isObj(c.xray)) e.push('xray: must be an object with "csv" and optional "folder" and "headers"')
    else {
      const x = c.xray
      for (const k of Object.keys(x)) if (!['csv', 'folder', 'headers'].includes(k)) e.push(`xray.${k}: unknown field (only "csv", "folder" and "headers")`)
      if (!(pathOk(x.csv) && /\.csv$/i.test(x.csv))) e.push(`xray.csv ${JSON.stringify(x.csv)} must be a relative path to a .csv file inside the project`)
      if (x.folder !== undefined) folderErrors(x.folder, 'xray.folder', folderRules(c), e)
      if (x.headers !== undefined) {
        if (!isObj(x.headers)) e.push('xray.headers: must be an object of column to header text')
        else {
          for (const [k, v] of Object.entries(x.headers)) {
            if (!Object.hasOwn(XRAY_HEADERS, k)) e.push(`xray.headers.${k}: unknown column (only ${Object.keys(XRAY_HEADERS).join(', ')})`)
            else if (typeof v !== 'string' || !v.trim() || /[\r\n,"]/.test(v)) e.push(`xray.headers.${k}: must be one line of text, without commas or quotes`)
          }
          const texts = XRAY_COLUMNS.map(k => x.headers[k] ?? XRAY_HEADERS[k])
          if (new Set(texts).size !== texts.length) e.push('xray.headers: two columns have the same header')
        }
      }
    }
  }
  if (c.sides !== undefined) {
    if (c.adapter !== 'fullstack') e.push('sides: only allowed with "adapter": "fullstack" (it tells frontend, backend and fullstack tickets apart)')
    else if (!isObj(c.sides)) e.push('sides: must be an object with "frontend", "backend" and "fullstack" lists of title prefixes or labels')
    else for (const [k, v] of Object.entries(c.sides)) {
      if (!['frontend', 'backend', 'fullstack'].includes(k)) e.push(`sides.${k}: unknown field (only "frontend", "backend" and "fullstack")`)
      else if (!Array.isArray(v) || v.some(m => typeof m !== 'string' || !m.trim() || /[\[\]\r\n]/.test(m))) e.push(`sides.${k}: must be a list of title prefixes or labels, like ["FE"] (no brackets)`)
    }
  }
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      // A trailing "/" is dropped: commands build <site>/wiki/… and <site>/browse/… from it.
      jira: { trackingProjects: [], ...j, site: j.site.replace(/\/+$/, '') },
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

/**
 * The test folders a writing run may use: the backend block's layers, else the backend's default (one
 * "unit" layer: test/ for Vitest). A frontend project reads Vitest's, as it always did.
 */
export const layersOf = config => {
  const backend = backendOf(config) ?? 'vitest'
  return config?.[backend]?.layers ?? (backend === 'vitest' ? DEFAULT_LAYERS : BACKENDS[backend].defaultLayers)
}

/** The block of the configured adapter (a backend or playwright), or {} when there is none. */
export const adapterOptions = config => {
  const b = isBackend(config?.adapter) || config?.adapter === 'playwright' ? config[config.adapter] : null
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

/** Seconds one test-runner process may take: the block's timeoutSeconds, else 600 for Playwright, the backend's default (300 for Vitest). */
export const timeoutSecondsOf = config => adapterOptions(config).timeoutSeconds ?? (config?.adapter === 'playwright' ? 600 : BACKENDS[config?.adapter]?.timeoutSeconds ?? 300)

/** The project's own test command of a backend block (a template with {files}, {report}, {test}), or null. */
export const commandOf = config => adapterOptions(config).command ?? null

/** The seed block with its defaults: no builder files, no dataset, no stub folder. */
export const seedOf = config => {
  const s = config?.seed && typeof config.seed === 'object' && !Array.isArray(config.seed) ? config.seed : {}
  return { builders: s.builders ?? [], dataset: s.dataset ?? null, stubsFrom: s.stubsFrom ?? null, guide: s.guide ?? null }
}

/** The xray block with its defaults (per-ticket files in the tickets folder), or null when it is off. */
export const xrayOf = config => {
  const x = config?.xray
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  return { csv: x.csv, folder: x.folder ?? `${normaliseTicketsDir(config.ticketsDir ?? DEFAULTS.ticketsDir)}/`, headers: { ...XRAY_HEADERS, ...(x.headers ?? {}) } }
}

/** The Playwright titles that are never graded nor mutated (playwright.ungradedTitles), as a regex; null for Vitest or when unset. */
export const ungradedTitlesOf = (config, dialect) => {
  const u = config?.playwright?.ungradedTitles
  return dialect?.name === 'playwright' && typeof u === 'string' && u ? new RegExp(u, 'i') : null
}

/** The red-test tags as a list (scenario's, extra's); [] when playwright.redTags is null. */
export const redTagsOf = config => {
  const rt = config?.playwright?.redTags
  return rt === null ? [] : Object.values({ ...DEFAULT_RED_TAGS, ...(rt ?? {}) })
}

/** The Jira statuses that mean finished. */
export const doneStatusesOf = config => config?.jira?.doneStatuses ?? DEFAULT_DONE_STATUSES

/** The share of Stryker mutants the tests must catch, as a whole percentage. */
export const strykerThreshold = config => config?.vitest?.stryker?.threshold ?? DEFAULT_STRYKER_THRESHOLD

/** Seconds one Stryker run may take. */
export const strykerTimeoutSeconds = config => config?.vitest?.stryker?.timeoutSeconds ?? DEFAULT_STRYKER_TIMEOUT_SECONDS

/** The user's Claude folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
export const claudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** The personal config (no repo): <Claude folder>/quality-code.json. */
export const personalConfigPath = (env = process.env) => join(claudeDir(env), 'quality-code.json')
/** Where a personal setup saves tickets: absolute, so it never depends on the folder the user is in. */
export const personalTicketsDir = (env = process.env) => normaliseTicketsDir(join(claudeDir(env), 'quality-code', 'tickets'))

function readValidated(p, label, source, env, root) {
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, source, path: p, errors: [`${label} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  const own = isObject(obj) ? obj.ticketsDir : undefined
  if (source === 'personal' && isObject(obj) && obj.ticketsDir === undefined) obj = { ...obj, ticketsDir: personalTicketsDir(env) }
  const r = { ...validateConfig(obj, { allowAbsoluteTicketsDir: source === 'personal' }), source, path: p }
  if (!r.ok) return r
  // The tickets folder is where this person keeps the project's files: the repo, this machine or the chat.
  const dirs = placeDirs(root, { source, ticketsDir: own, personalDefault: personalTicketsDir(env) }, placeOf(root, source, env), env)
  return { ...r, config: { ...r.config, ticketsDir: dirs.ticketsDir }, place: dirs.place, auditDir: dirs.auditDir }
}

/**
 * The config in force: the repo's .claude/quality-code.json first, else the personal one. The result is
 * validateConfig's, plus where it came from: source "repo" | "personal" and its path, and where this
 * person keeps the project's files: place "repo" | "local" | "chat", and auditDir (null in the chat).
 * config.ticketsDir is that place's tickets folder.
 */
export function loadConfig(root, env = process.env) {
  const rp = configPath(configHome(root))
  if (existsSync(rp)) return readValidated(rp, CONFIG_REL, 'repo', env, root)
  const pp = personalConfigPath(env)
  if (existsSync(pp)) return readValidated(pp, pp, 'personal', env, root)
  return { ok: false, missing: true, errors: [`This repo is not set up. ${SETUP}`] }
}
