// Finds, loads and validates the team config. The only module that knows where it lives.
import { ciErrors } from '../ci/ci-source.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { allowCovers, matches } from '../pipeline/boundary.mjs'
import { BACKEND_ADAPTERS, BACKENDS, backendOf, isBackend } from '../stacks/backends.mjs'
import { RUNNERS } from '../stacks/runners.mjs'
import { placeConfigPath, placeDirs, placeOf } from './places.mjs'
import { FLOWS } from '../stacks/conventions.mjs'
import { readJsonOr, tryReadJson } from '../core/files.mjs'
import { stripDotSlash, noTrailingSlash, cleanRelPath, isAbsoluteAnywhere } from '../core/paths.mjs'
import { hasLineBreak, isLine, isObject } from '../core/is.mjs'

export const CONFIG_REL = '.claude/quality-code.json'
const SETUP = 'Run /quality-code:setup.'
const KEY = /^[A-Z][A-Z0-9_]+$/
export const FEATURE_APPROACHES = Object.freeze(['e2e', 'unit', 'both'])
/** Vitest backend, or Jest/Mocha/node --test in `runners.unit`. */
const hasUnitRunner = c => c.backend === 'vitest' || c.runners?.unit !== undefined
const FIELDS = new Set(['$schema', 'root', 'git', 'version', 'frontend', 'runners', 'jira', 'languages', 'features', 'titlePrefixes', 'confluenceSpaces', 'ticketTemplates', 'ticketsDir', 'testStyle', 'role', 'gate', 'expected', 'assertionHelpers', 'ticketAnchor', 'roots', 'redact', 'messages', 'boundaries', 'vitest', 'playwright', 'seed', 'ci', 'sides', 'testRules', 'qaPlans', 'qa', 'externalChecks', 'xray', 'confluence', 'backend', 'centralContext', ...BACKEND_ADAPTERS])
const LANGS = new Set(['en', 'it'])
// Each non-Vitest backend has its own options block, named after it.
const OTHER_BACKENDS = BACKEND_ADAPTERS.filter(a => a !== 'vitest')
// Placeholders allowed in a backend's test command.
const COMMAND_SLOTS = new Set(['files', 'report', 'test'])
// How the app's screens are reached in a test: setup finds it, spec writes the sign-in from it.
const SIGN_IN = ['handled', 'form', 'token', 'sso', 'none']
const quoted = list => list.map(a => `"${a}"`)
const orList = list => `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`
const SPACE_KEY = /^[A-Za-z0-9_~-]+$/
const PATH_RULE = 'must be a relative path inside the project (no "..", not absolute, one line)'
const LAYER_NAME = /^[a-z][a-z0-9-]{0,30}$/
export const DEFAULT_LAYERS = Object.freeze([Object.freeze({ name: 'unit', folder: 'test/' })])
export const DEFAULT_STRYKER_THRESHOLD = 60
// Stryker reruns the suite per mutant: minutes on a DB-backed suite, so it gets its own limit.
export const DEFAULT_STRYKER_TIMEOUT_SECONDS = 1800
// Xray CSV columns in order with default headers. "data" isn't a column: it's the word before a step's
// data in the action cell.
export const XRAY_HEADERS = Object.freeze({ tcid: 'TC ID', summary: 'Summary', description: 'Description', step: 'Step', action: 'Action', expected: 'Expected Result', label: 'Label', priority: 'Priority', component: 'Component', ticket: 'Linked Issues', epic: 'Epic', testType: 'Test Type', data: 'Data' })
export const XRAY_COLUMNS = Object.freeze(Object.keys(XRAY_HEADERS).filter(k => k !== 'data'))
// Tags on red Playwright tests: ticket scenarios and extra probes.
export const DEFAULT_RED_TAGS = Object.freeze({ scenario: '@anchor', extra: '@finding' })
// Finished statuses: a red run then warns the bug is still there.
export const DEFAULT_DONE_STATUSES = Object.freeze(['Test OK', 'Done', 'Ready for test', 'Closed', 'Resolved', 'Chiuso', 'Risolto'])
const pathOk = p => isLine(p) && !isAbsoluteAnywhere(p) && !p.split(/[\\/]/).includes('..')

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

/** The config in its place, else the legacy .claude/quality-code.json, else null. */
export function configFileOf(dir, env = process.env) {
  const placed = placeConfigPath(dir, env)
  if (existsSync(placed)) return placed
  const legacy = join(dir, CONFIG_REL)
  return existsSync(legacy) ? legacy : null
}
const hasConfig = (dir, env) => configFileOf(dir, env) !== null

/** The nearest folder at or above dir that holds the config, or null. */
function findHome(dir, env) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (hasConfig(d, env)) return d
    if (dirname(d) === d) return null
  }
}

const activeRootsFile = (env = process.env) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'quality-code', 'roots.json')

/** Active root of a multi-root config: QUALITY_CODE_ROOT, else `root set`'s pick. Must be listed in the config. */
function chosenRoot(home, c, env = process.env) {
  if (!Array.isArray(c?.roots)) return null
  const allowed = new Set([...c.roots, c.root].filter(pathOk).map(cleanRelPath))
  let pick = env.QUALITY_CODE_ROOT
  if (!pick) pick = tryReadJson(activeRootsFile(env), null)?.[resolve(home)]
  return pick && allowed.has(cleanRelPath(pick)) ? pick : null
}

/** The project of the config in home: the folder its root field names (an app in web/), else home. A bad root is left to validateConfig. */
function withRoot(home, env) {
  const c = tryReadJson(configFileOf(home, env), undefined)
  const r = chosenRoot(home, c, env) ?? c?.root
  return pathOk(r) ? resolve(home, r) : home
}

/** What `root get` shows: { default, roots, active }. */
export function rootsOf(home, env = process.env) {
  const c = tryReadJson(configFileOf(home, env), undefined)
  const roots = Array.isArray(c?.roots) ? [...new Set([...c.roots, ...(pathOk(c.root) ? [c.root] : [])].map(cleanRelPath))] : []
  return { default: pathOk(c?.root) ? cleanRelPath(c.root) : '.', roots, active: cleanRelPath(chosenRoot(home, c, env) ?? (pathOk(c?.root) ? c.root : '.')) }
}

/** Saved on this machine. → { ok, error? } */
export function setActiveRoot(home, folder, env = process.env) {
  const { roots } = rootsOf(home, env)
  if (!roots.length) return { ok: false, error: 'this config has no "roots" list: add one (for example "roots": ["app", "backend-executor"])' }
  if (!roots.includes(cleanRelPath(folder))) return { ok: false, error: `${folder} is not one of the roots: ${roots.join(', ')}` }
  const file = activeRootsFile(env)
  // Stop on a broken file: rewriting it would drop every other repo's pick.
  const all = readJsonOr(file, {})
  all[resolve(home)] = cleanRelPath(folder)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(all, null, 2))
  return { ok: true }
}

/** The project dir is in: that of the nearest config at or above it, or null. */
export function findRoot(dir, env = process.env) {
  const home = findHome(dir, env)
  return home && withRoot(home, env)
}

/** The folder whose config governs the project at root: root itself, else the one above whose root field names it. */
export function configHome(root, env = process.env) {
  if (hasConfig(root, env)) return root
  const up = findHome(dirname(resolve(root)), env)
  return up && withRoot(up, env) === resolve(root) ? up : root
}

// CLAUDE_PROJECT_DIR if it holds the config, else the nearest config up from cwd (scripts in src/, monorepos),
// else CLAUDE_PROJECT_DIR or cwd. A root field naming a subfolder makes that the project.
export function projectRoot(env = process.env, cwd = process.cwd()) {
  const dir = env.CLAUDE_PROJECT_DIR
  if (dir && hasConfig(dir, env)) return withRoot(dir, env)
  return findRoot(cwd, env) ?? (dir || cwd)
}
/** The existing config, else where setup would write it. */
export const configPath = (root, env = process.env) => configFileOf(root, env) ?? placeConfigPath(root, env)


/** Fields shared by the vitest and playwright blocks. */
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
  limitErrors(b, name, e)
}

/** timeoutSeconds and maxMutants (per-spec cap), on every runner block. */
function limitErrors(b, name, e) {
  const t = b.timeoutSeconds
  if (t !== undefined && !(Number.isInteger(t) && t >= 10 && t <= 3600)) e.push(`${name}.timeoutSeconds: must be a whole number from 10 to 3600`)
  const m = b.maxMutants
  if (m !== undefined && !(Number.isInteger(m) && m >= 1)) e.push(`${name}.maxMutants: must be a whole number from 1, the most mutants run per spec`)
}

function folderRules(c) {
  // Default boundary: test folders never go inside the CI files.
  const forbidden = Array.isArray(c.boundaries?.forbidden) ? c.boundaries.forbidden.filter(r => isObject(r) && pathOk(r.path)) : [{ path: 'src/' }, { path: '.env' }, { path: '.env.*' }]
  const allow = Array.isArray(c.boundaries?.allow) ? c.boundaries.allow.filter(pathOk) : []
  return { forbidden, allow }
}

/** Relative, ends in "/", not inside a forbidden rule unless allowed. */
function folderErrors(folder, name, rules, e) {
  if (!pathOk(folder)) return e.push(`${name} ${JSON.stringify(folder)} ${PATH_RULE}`)
  if (!folder.endsWith('/')) return e.push(`${name} "${folder}" must end with "/"`)
  const f = stripDotSlash(folder)
  const rule = rules.allow.some(a => matches(a, f)) || allowCovers(rules.allow, f) ? null : rules.forbidden.find(r => matches(stripDotSlash(r.path), f))
  if (rule) e.push(`${name} "${folder}" is inside the forbidden "${rule.path}"`)
}

const guideOk = g => pathOk(g) && /\.md$/i.test(g)

/** 1 to 5 { name, folder, guide }, unique names, writable folders. */
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


/** Non-Vitest backend block: layers, timeoutSeconds, command (and pytest's typeCheck). */
function otherBackendErrors(b, name, e) {
  const fields = ['layers', 'timeoutSeconds', 'maxMutants', 'command', ...(name === 'pytest' ? ['typeCheck'] : [])]
  for (const k of Object.keys(b)) if (!fields.includes(k)) e.push(`${name}.${k}: unknown field (only ${orList(quoted(fields))})`)
  limitErrors(b, name, e)
  // Layers may sit in code folders (src/test/java/, Go): the boundary lets test files through by name.
  layerErrors(b.layers, name, { forbidden: [], allow: [] }, e)
  if (b.command !== undefined) {
    if (!isLine(b.command)) e.push(`${name}.command: must be one line of text, the project's test command, like "${name === 'pytest' ? 'poetry run pytest {files} --junitxml={report}' : 'make test'}"`)
    else for (const m of b.command.matchAll(/\{([^}]*)\}/g)) if (!COMMAND_SLOTS.has(m[1])) e.push(`${name}.command: unknown placeholder {${m[1]}} (only {files}, {report} and {test})`)
  }
  if (b.typeCheck !== undefined && !isLine(b.typeCheck)) e.push(`${name}.typeCheck: must be one line of text, the type-check command, like "mypy {files}"`)
}

const uses = (c, a) => c.frontend === a || c.backend === a

function jiraErrors(c, e) {
  const j = c.jira
  if (!isObject(j)) return e.push('jira: must be an object with site and projects')
  if (typeof j.site !== 'string' || !/^https:\/\/[^/\s]+(?:\/\S*)?$/.test(j.site)) e.push('jira.site: must be an https URL like "https://example.atlassian.net"')
  if (!Array.isArray(j.projects) || j.projects.length === 0) e.push('jira.projects: must be a non-empty list of keys like "ABC"')
  else if (j.projects.length === 1 && j.projects[0] === '*') { /* any project: the shared server's default */ }
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

function featureErrors(c, e) {
  if (c.features === undefined) return
  if (!Array.isArray(c.features)) return e.push('features: must be a list (it may be empty)')
  const seen = new Set()
  c.features.forEach((f, i) => {
    if (!f || typeof f.label !== 'string' || !f.label.trim()) e.push(`features[${i}].label: must be a non-empty text`)
    else if (seen.has(f.label)) e.push(`features[${i}].label "${f.label}" appears twice`)
    else seen.add(f.label)
    if (f?.qaPlanSearch !== undefined && (typeof f.qaPlanSearch !== 'string' || !f.qaPlanSearch.trim())) e.push(`features[${i}].qaPlanSearch: must be a non-empty text (the words to search for the QA plan)`)
    if (f?.approach !== undefined) {
      if (!FEATURE_APPROACHES.includes(f.approach)) e.push(`features[${i}].approach: must be "e2e", "unit" or "both" (how the team tests this feature)`)
      else if (f.approach !== 'e2e' && !hasUnitRunner(c)) e.push(`features[${i}].approach "${f.approach}" needs a JavaScript unit test runner (Vitest, Jest, Mocha or node --test): run /quality-code:setup to add one`)
    }
    if (f?.guide !== undefined && !(typeof f.guide === 'string' && pathOk(f.guide) && !f.guide.endsWith('/'))) e.push(`features[${i}].guide ${JSON.stringify(f.guide)} must be a file inside the project (the team's own approach to testing this feature, for example docs/testing/orders.md)`)
    if (f?.route != null) {
      if (typeof f.route !== 'string') e.push(`features[${i}].route: must be text starting with "/"`)
      else if (!f.route.startsWith('/')) e.push(`features[${i}].route "${f.route}" must start with "/"`)
    }
  })
}

function gateErrors(c, e) {
  const g = c.gate
  if (g === undefined) return
  if (!isObject(g)) return e.push('gate: must be an object with "omit" and/or "contextFromIntro"')
  for (const k of Object.keys(g)) if (!['omit', 'contextFromIntro'].includes(k)) e.push(`gate.${k}: unknown field (only "omit" and "contextFromIntro")`)
  const OMIT = ['attachments', 'links', 'context', 'environment']
  if (g.omit !== undefined && (!Array.isArray(g.omit) || g.omit.some(k => !OMIT.includes(k)))) e.push(`gate.omit: must be a list of ${orList(quoted(OMIT))}: items that never count against a ticket of this project`)
  if (g.contextFromIntro !== undefined && typeof g.contextFromIntro !== 'boolean') e.push('gate.contextFromIntro: must be true or false (true: the paragraph before the first heading counts as the Context)')
}

function expectedErrors(c, e) {
  const x = c.expected
  if (x === undefined) return
  if (!isObject(x)) return e.push('expected: must be an object with "aliases", "ignore" and/or "fields"')
  for (const k of Object.keys(x)) if (!['aliases', 'ignore', 'fields'].includes(k)) e.push(`expected.${k}: unknown field (only "aliases", "ignore" and "fields")`)
  if (x.ignore !== undefined && (!Array.isArray(x.ignore) || !x.ignore.every(isLine))) e.push('expected.ignore: must be a list of words or field names that another package owns, like ["sts_submission"]')
  if (x.fields !== undefined && typeof x.fields !== 'boolean') e.push('expected.fields: must be true or false (false: field names in the ticket are not looked for in the tests)')
  if (x.aliases !== undefined) {
    if (!isObject(x.aliases)) e.push('expected.aliases: must be an object from a word in the ticket to the text the screen shows, like { "Rectify": "Rettifica" }')
    else for (const [k, v] of Object.entries(x.aliases)) if (!isLine(k) || !(isLine(v) || (Array.isArray(v) && v.length > 0 && v.every(isLine)))) e.push(`expected.aliases.${k}: must be a text, or a list of texts, the tests assert instead`)
  }
}

function ticketsDirErrors(c, allowAbsoluteTicketsDir, e) {
  if (c.ticketsDir === undefined) return
  if (typeof c.ticketsDir !== 'string' || !cleanRelPath(c.ticketsDir).trim()) e.push('ticketsDir: must be a non-empty text')
  else if (hasLineBreak(c.ticketsDir)) e.push('ticketsDir: must be on one line (no line breaks)')
  else {
    const absOk = allowAbsoluteTicketsDir && isAbsolute(c.ticketsDir) && !cleanRelPath(c.ticketsDir).split('/').includes('..')
    if (!absOk && !pathOk(c.ticketsDir)) e.push(`ticketsDir ${JSON.stringify(c.ticketsDir)} ${PATH_RULE}`)
  }
}

// When origin/HEAD isn't the base (gitflow: develop).
function gitErrors(c, e) {
  if (c.git === undefined) return
  if (!isObject(c.git)) return e.push('git: must be an object with an optional "base"')
  for (const k of Object.keys(c.git)) if (k !== 'base') e.push(`git.${k}: unknown field (only "base")`)
  const b = c.git.base
  if (b !== undefined && (typeof b !== 'string' || !b.trim() || b.startsWith('-') || /[\s~^:?*[\\]/.test(b))) e.push(`git.base ${JSON.stringify(b)} must be a branch name, like "develop"`)
}

function ticketTemplateErrors(c, e) {
  if (c.ticketTemplates === undefined) return
  if (!isObject(c.ticketTemplates)) return e.push('ticketTemplates: must be an object with optional "bug" and "story"')
  for (const [k, v] of Object.entries(c.ticketTemplates)) {
    if (k !== 'bug' && k !== 'story') e.push(`ticketTemplates.${k}: unknown field (only "bug" and "story")`)
    else if (v !== null && typeof v !== 'string') e.push(`ticketTemplates.${k}: must be text or null`)
  }
}

function redactErrors(c, e) {
  if (c.redact === undefined) return
  if (!isObject(c.redact)) return e.push('redact: must be an object of name to regular expression')
  for (const [name, src] of Object.entries(c.redact)) {
    if (typeof src !== 'string') { e.push(`redact.${name}: must be a text (a regular expression)`); continue }
    let re
    try { re = new RegExp(src) } catch { e.push(`redact.${name}: not a valid regular expression`); continue }
    if (re.test('')) e.push(`redact.${name}: must not match empty text (it would insert the mask between every character)`)
  }
}

function boundaryErrors(c, e) {
  if (c.boundaries === undefined) return
  if (!isObject(c.boundaries)) return e.push('boundaries: must be an object with "forbidden" and/or "allow"')
  for (const k of Object.keys(c.boundaries)) if (k !== 'forbidden' && k !== 'allow') e.push(`boundaries.${k}: unknown field (only "forbidden" and "allow")`)
  const f = c.boundaries.forbidden
  if (f !== undefined) {
    if (!Array.isArray(f) || f.length === 0) e.push('boundaries.forbidden: must be a non-empty list of { "path", "why" }')
    else f.forEach((r, i) => {
      if (!isObject(r)) { e.push(`boundaries.forbidden[${i}]: must be an object with "path" and an optional "why"`); return }
      if (!pathOk(r.path)) e.push(`boundaries.forbidden[${i}].path ${JSON.stringify(r.path)} ${PATH_RULE}`)
      if (r.why !== undefined && !isLine(r.why)) e.push(`boundaries.forbidden[${i}].why: must be one non-empty line`)
      for (const k of Object.keys(r)) if (k !== 'path' && k !== 'why') e.push(`boundaries.forbidden[${i}].${k}: unknown field (only "path" and "why")`)
    })
  }
  const a = c.boundaries.allow
  if (a !== undefined) {
    if (!Array.isArray(a)) e.push('boundaries.allow: must be a list of path patterns')
    else a.forEach((p, i) => { if (!pathOk(p)) e.push(`boundaries.allow[${i}] ${JSON.stringify(p)} ${PATH_RULE}`) })
  }
}

function runnersErrors(c, e) {
  if (c.runners === undefined) return
  if (!isObject(c.runners)) return e.push('runners: must be an object with "unit" and/or "e2e"')
  const backend = c.backend
  for (const [kind, name] of Object.entries(c.runners)) {
    const ok = Object.keys(RUNNERS).filter(r => RUNNERS[r].kind === kind)
    if (!ok.length) e.push(`runners.${kind}: unknown field (only "unit" and "e2e")`)
    else if (!ok.includes(name)) e.push(`runners.${kind}: must be ${ok.map(r => `"${r}"`).join(', ')} (found ${JSON.stringify(name)})`)
    // Jest/Mocha are JS: non-JS backends already have their own runner.
    else if (kind === 'unit' && isBackend(backend) && backend !== 'vitest') e.push(`runners.unit: ${JSON.stringify(name)} runs JavaScript tests, and this project's backend is ${BACKENDS[backend].label}, which runs its own tests: leave runners.unit out (it is only for a Vitest backend)`)
    else if (!uses(c, kind === 'unit' ? 'vitest' : 'playwright')) e.push(`runners.${kind}: only allowed with ${kind === 'unit' ? '"backend": "vitest"' : '"frontend": "playwright"'}`)
  }
}

function vitestErrors(c, e) {
  if (c.vitest === undefined) return
  if (!uses(c, 'vitest')) return e.push('vitest: only allowed with "backend": "vitest"')
  if (!isObject(c.vitest)) return e.push('vitest: must be an object')
  for (const k of Object.keys(c.vitest)) if (!['configs', 'tsconfig', 'timeoutSeconds', 'maxMutants', 'layers', 'stryker'].includes(k)) e.push(`vitest.${k}: unknown field (only "configs", "tsconfig", "timeoutSeconds", "maxMutants", "layers" and "stryker")`)
  runnerFields(c.vitest, 'vitest', e)
  layerErrors(c.vitest.layers, 'vitest', folderRules(c), e)
  const st = c.vitest.stryker
  if (st === undefined) return
  if (!isObject(st)) return e.push('vitest.stryker: must be an object with an optional "threshold" and "timeoutSeconds"')
  for (const k of Object.keys(st)) if (k !== 'threshold' && k !== 'timeoutSeconds') e.push(`vitest.stryker.${k}: unknown field (only "threshold" and "timeoutSeconds")`)
  if (st.threshold !== undefined && !(Number.isInteger(st.threshold) && st.threshold >= 0 && st.threshold <= 100)) e.push('vitest.stryker.threshold: must be a whole number from 0 to 100')
  if (st.timeoutSeconds !== undefined && !(Number.isInteger(st.timeoutSeconds) && st.timeoutSeconds >= 60 && st.timeoutSeconds <= 7200)) e.push('vitest.stryker.timeoutSeconds: must be a whole number from 60 to 7200')
}

function playwrightErrors(c, e) {
  const p = c.playwright
  if (p === undefined) return
  if (!uses(c, 'playwright')) return e.push('playwright: only allowed with "frontend": "playwright"')
  if (!isObject(p)) return e.push('playwright: must be an object')
  for (const k of Object.keys(p)) if (!['configs', 'projects', 'tsconfig', 'timeoutSeconds', 'maxMutants', 'folder', 'guide', 'ungradedTitles', 'redTags', 'signIn'].includes(k)) e.push(`playwright.${k}: unknown field (only "configs", "projects", "tsconfig", "timeoutSeconds", "maxMutants", "folder", "guide", "ungradedTitles", "redTags" and "signIn")`)
  runnerFields(p, 'playwright', e)
  const u = p.ungradedTitles
  if (u !== undefined) {
    let re = null
    try { re = typeof u === 'string' && u.trim() ? new RegExp(u, 'i') : null } catch {}
    if (!re || re.test('')) e.push('playwright.ungradedTitles: must be a regular expression that matches the titles of tests that never assert (screenshot captures), like "conformance|capture"')
  }
  const rt = p.redTags
  if (rt !== undefined && rt !== null) {
    if (!isObject(rt)) e.push('playwright.redTags: must be null (no tags) or an object with "scenario" and "extra"')
    else for (const k of Object.keys(rt)) {
      if (k !== 'scenario' && k !== 'extra') e.push(`playwright.redTags.${k}: unknown field (only "scenario" and "extra")`)
      else if (typeof rt[k] !== 'string' || !/^@[\w-]+$/.test(rt[k])) e.push(`playwright.redTags.${k}: must be a tag like "@anchor"`)
    }
  }
  const si = p.signIn
  if (si !== undefined) {
    if (!isObject(si) || !SIGN_IN.includes(si.kind) || !isLine(si.how) || si.how.length > 300 || Object.keys(si).some(k => k !== 'kind' && k !== 'how')) e.push(`playwright.signIn: must be { "kind", "how" }: kind ${orList(quoted(SIGN_IN))}, how one line (at most 300 characters) saying how a tester gets past the sign-in, never a password or a token`)
  }
  if (p.folder !== undefined) folderErrors(p.folder, 'playwright.folder', folderRules(c), e)
  if (p.guide !== undefined && !guideOk(p.guide)) e.push(`playwright.guide ${JSON.stringify(p.guide)} must be a relative path to a .md file inside the project`)
  const ps = p.projects
  if (ps === undefined) return
  if (!Array.isArray(ps) || ps.length < 1 || ps.length > 10) return e.push('playwright.projects: must be a list of 1 to 10 project names')
  const seen = new Set()
  ps.forEach((name, i) => {
    if (!isLine(name) || name.startsWith('-')) e.push(`playwright.projects[${i}] ${JSON.stringify(name)} must be a project name of your Playwright config: one line, not empty, not starting with "-"`)
    else if (seen.has(name)) e.push(`playwright.projects[${i}] "${name}" appears twice`)
    else seen.add(name)
  })
}

function seedErrors(c, e) {
  const s = c.seed
  if (s === undefined) return
  const SEED = ['schema', 'target', 'apply', 'tenant', 'guide']
  if (!isObject(s)) return e.push('seed: must be an object with optional "schema", "target", "apply", "tenant" and "guide"')
  // Pre-0.31.0 test-data printer fields: ignored so old configs still load.
  for (const k of Object.keys(s)) if (!SEED.includes(k) && !['builders', 'dataset', 'stubsFrom'].includes(k)) e.push(`seed.${k}: unknown field (only ${orList(quoted(SEED))})`)
  if (s.guide !== undefined && !guideOk(s.guide)) e.push(`seed.guide ${JSON.stringify(s.guide)} must be a relative path to a .md file inside the project`)
  if (s.schema !== undefined && !pathOk(s.schema)) e.push(`seed.schema ${JSON.stringify(s.schema)} ${PATH_RULE}`)
  if (s.target !== undefined && !isLine(s.target)) e.push('seed.target: must be one line of text, a command that prints the database it reaches, like "echo localhost:5432/app"')
  if (s.apply !== undefined && !(isLine(s.apply) && s.apply.includes('{file}'))) e.push('seed.apply: must be one line of text with {file} in it, the command that loads a SQL file into the local database, like "psql -h localhost -d app -f {file}"')
  if (s.tenant !== undefined && !(isObject(s.tenant) && Object.keys(s.tenant).sort().join() === 'column,id' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.tenant.column) && isLine(s.tenant.id) && !s.tenant.id.includes("'"))) e.push('seed.tenant: must be { "column": "<the tenant column, like workspace_id>", "id": "<the tenant id the local app uses>" }')
}

function qaErrors(c, e) {
  const q = c.qa
  if (q === undefined) return
  const QA = ['executionTypes', 'sprint', 'app', 'statuses', 'blockedStop', 'autoPass']
  if (!isObject(q)) return e.push(`qa: must be an object with optional ${orList(quoted(QA))}`)
  // Interpolated into JQL in double quotes: one line, no quote, no backslash.
  const nameOk = v => isLine(v) && !/["\\]/.test(v) && v.length <= 80
  for (const k of Object.keys(q)) if (!QA.includes(k)) e.push(`qa.${k}: unknown field (only ${orList(quoted(QA))})`)
  if (q.executionTypes !== undefined && !(Array.isArray(q.executionTypes) && q.executionTypes.length >= 1 && q.executionTypes.length <= 10 && q.executionTypes.every(nameOk))) e.push('qa.executionTypes: must be a list of 1 to 10 Jira issue type names (one line each, no double quote), like ["Test Execution", "Sub Test Execution"]')
  if (q.sprint !== undefined && !['open', 'any'].includes(q.sprint)) e.push('qa.sprint: must be "open" (only the open sprint) or "any"')
  if (q.app !== undefined && !(typeof q.app === 'string' && /^https?:\/\/[^\s]+$/.test(q.app))) e.push('qa.app: must be the address of the app to test, starting with http:// or https://')
  if (q.statuses !== undefined) {
    if (!isObject(q.statuses)) e.push('qa.statuses: must be an object with optional "ko", "ready" and "done"')
    else for (const [k, v] of Object.entries(q.statuses)) {
      if (!['ko', 'ready', 'done'].includes(k)) e.push(`qa.statuses.${k}: unknown field (only "ko", "ready" and "done")`)
      else if (!nameOk(v)) e.push(`qa.statuses.${k}: must be a Jira status name (one line, no double quote), like "TEST KO"`)
    }
  }
  if (q.blockedStop !== undefined && !(Number.isInteger(q.blockedStop) && q.blockedStop >= 0 && q.blockedStop <= 20)) e.push('qa.blockedStop: must be a whole number from 0 to 20 (0 never stops)')
  if (q.autoPass !== undefined && typeof q.autoPass !== 'boolean') e.push('qa.autoPass: must be true or false')
}

function xrayErrors(c, e) {
  const x = c.xray
  if (x === undefined) return
  if (!uses(c, 'playwright')) return e.push('xray: only allowed with "frontend": "playwright" (Xray test cases are written for Playwright tests)')
  if (!isObject(x)) return e.push('xray: must be an object with "csv" and optional "folder" and "headers"')
  for (const k of Object.keys(x)) if (!['csv', 'folder', 'headers'].includes(k)) e.push(`xray.${k}: unknown field (only "csv", "folder" and "headers")`)
  if (!(pathOk(x.csv) && /\.csv$/i.test(x.csv))) e.push(`xray.csv ${JSON.stringify(x.csv)} must be a relative path to a .csv file inside the project`)
  if (x.folder !== undefined) folderErrors(x.folder, 'xray.folder', folderRules(c), e)
  if (x.headers === undefined) return
  if (!isObject(x.headers)) return e.push('xray.headers: must be an object of column to header text')
  for (const [k, v] of Object.entries(x.headers)) {
    if (!Object.hasOwn(XRAY_HEADERS, k)) e.push(`xray.headers.${k}: unknown column (only ${Object.keys(XRAY_HEADERS).join(', ')})`)
    else if (typeof v !== 'string' || !v.trim() || /[\r\n,"]/.test(v)) e.push(`xray.headers.${k}: must be one line of text, without commas or quotes`)
  }
  const texts = XRAY_COLUMNS.map(k => x.headers[k] ?? XRAY_HEADERS[k])
  if (new Set(texts).size !== texts.length) e.push('xray.headers: two columns have the same header')
}

// Central Context hub for testing rules (lib/base/rules.mjs). "off" reads none.
function testRulesErrors(c, e) {
  if (c.testRules === undefined) return
  if (!isObject(c.testRules)) return e.push('testRules: must be an object with "backend" and/or "frontend", each "own" or "plugin"')
  for (const [side, v] of Object.entries(c.testRules)) {
    if (side !== 'backend' && side !== 'frontend') e.push(`testRules.${side}: unknown field (only "backend" and "frontend")`)
    else if (v !== 'own' && v !== 'plugin') e.push(`testRules.${side}: must be "own" (the team's rules and specs win) or "plugin" (the plugin's rules win), found ${JSON.stringify(v)}`)
  }
}

function centralContextErrors(c, e) {
  if (c.centralContext === undefined) return
  const HUB = /^https?:\/\/[^\s/]+(?:\/\S*)?$/
  if (!isObject(c.centralContext)) return e.push('centralContext: must be an object with "hub", the Central Context hub\'s base URL like "http://localhost:8080", or "off"')
  for (const k of Object.keys(c.centralContext)) if (k !== 'hub' && k !== 'local') e.push(`centralContext.${k}: unknown field (only "hub" and "local")`)
  const h = c.centralContext.hub
  if (h !== undefined && !(h === 'off' || (typeof h === 'string' && HUB.test(h.trim())))) e.push('centralContext.hub: must be the hub\'s base URL like "http://localhost:8080" (http or https), or "off"')
  // Team rules, read alongside the hub's.
  const l = c.centralContext.local
  if (l !== undefined && !(pathOk(l) && l.endsWith('/'))) e.push(`centralContext.local ${JSON.stringify(l)} must be a folder inside the project, ending with "/" (one rule per .md file, in the Central Context rule format)`)
}

function sidesErrors(c, e) {
  if (c.sides === undefined) return
  if (!(c.frontend && c.backend)) return e.push('sides: only allowed with both "frontend" and "backend" (it tells frontend, backend and fullstack tickets apart)')
  if (!isObject(c.sides)) return e.push('sides: must be an object with "frontend", "backend" and "fullstack" lists of title prefixes or labels')
  for (const [k, v] of Object.entries(c.sides)) {
    if (k === 'default') { if (!['frontend', 'backend', 'fullstack'].includes(v)) e.push('sides.default: must be "frontend", "backend" or "fullstack" (the side of a ticket that carries no mark)') }
    else if (!['frontend', 'backend', 'fullstack'].includes(k)) e.push(`sides.${k}: unknown field (only "frontend", "backend", "fullstack" and "default")`)
    else if (!Array.isArray(v) || v.some(m => typeof m !== 'string' || !m.trim() || /[\[\]\r\n]/.test(m))) e.push(`sides.${k}: must be a list of title prefixes or labels, like ["FE"] (no brackets)`)
  }
}

export function validateConfig(input, { allowAbsoluteTicketsDir = false } = {}) {
  const e = []
  const c = isObject(input) ? input : {}
  for (const k of Object.keys(c)) {
    if (k === 'adapter') e.push('adapter: replaced by "frontend" and "backend" (like "frontend": "playwright", "backend": "vitest"): re-run /quality-code:setup')
    else if (!FIELDS.has(k)) e.push(`${k}: unknown field (remove it, or re-run /quality-code:setup)`)
  }
  if (c.version !== 2) e.push(`version: must be 2 (found ${JSON.stringify(c.version)}); re-run /quality-code:setup`)
  if (c.root !== undefined && !pathOk(c.root)) e.push(`root ${JSON.stringify(c.root)} must be a folder inside the repository, like "web" (no "..", not absolute, one line)`)
  if (c.frontend === undefined && c.backend === undefined && !('adapter' in c)) e.push(`frontend, backend: set one or both: "frontend": "playwright" (e2e tests of screens), "backend": ${orList(quoted(BACKEND_ADAPTERS))} (tests of the code)`)
  if (c.frontend !== undefined && c.frontend !== 'playwright') e.push(`frontend: must be "playwright" (found ${JSON.stringify(c.frontend)})`)
  if (c.backend !== undefined && !isBackend(c.backend)) e.push(`backend: must be ${orList(quoted(BACKEND_ADAPTERS))} (found ${JSON.stringify(c.backend)})`)
  const j = isObject(c.jira) ? c.jira : {}
  jiraErrors(c, e)
  if (c.languages !== undefined && (!Array.isArray(c.languages) || c.languages.length === 0)) e.push('languages: must list at least one of "en", "it"')
  else if (c.languages !== undefined) c.languages.forEach((l, i) => { if (!LANGS.has(l)) e.push(`languages[${i}] "${l}" is not supported (supported: en, it)`) })
  featureErrors(c, e)
  if (c.titlePrefixes !== undefined) {
    if (!Array.isArray(c.titlePrefixes)) e.push('titlePrefixes: must be a list of non-empty texts')
    else c.titlePrefixes.forEach((t, i) => { if (typeof t !== 'string' || !t.trim()) e.push(`titlePrefixes[${i}]: must be a non-empty text`) })
  }
  if (c.confluence !== undefined && typeof c.confluence !== 'boolean') e.push('confluence: must be true or false (false: the team has no Confluence, so no QA plan is looked for or scored)')
  // Absent: search every Confluence space.
  if (c.confluenceSpaces !== undefined) {
    if (!Array.isArray(c.confluenceSpaces)) e.push('confluenceSpaces: must be a list of Confluence space keys like "ABC"')
    else if (!c.confluenceSpaces.length) e.push('confluenceSpaces: must name at least one space; leave it out to search all spaces')
    else c.confluenceSpaces.forEach((k, i) => {
      if (typeof k !== 'string' || !SPACE_KEY.test(k)) e.push(`confluenceSpaces[${i}] ${JSON.stringify(k)} must be a Confluence space key: letters, digits, "_", "~" or "-", like "ABC"`)
    })
  }
  gateErrors(c, e)
  expectedErrors(c, e)
  if (c.assertionHelpers !== undefined && (!Array.isArray(c.assertionHelpers) || !c.assertionHelpers.every(h => typeof h === 'string' && /^[A-Za-z_$][\w$]*$/.test(h)))) e.push('assertionHelpers: must be a list of method-name prefixes that assert for a test (page objects), like ["check", "ensure"]; expect, assert and verify always count')
  if (c.ticketAnchor !== undefined && !['block', 'branch'].includes(c.ticketAnchor)) e.push(`ticketAnchor ${JSON.stringify(c.ticketAnchor)}: must be "block" (a group whose title names the ticket) or "branch" (also a spec changed on the branch)`)
  if (c.roots !== undefined && (!Array.isArray(c.roots) || c.roots.length < 1 || !c.roots.every(pathOk))) e.push('roots: must be a list of folders inside the repository, like ["app", "backend-executor"] (the projects one config serves; ticket.mjs root set picks the active one)')
  if (c.role !== undefined && !['dev', 'qa', 'po'].includes(c.role)) e.push(`role ${JSON.stringify(c.role)}: must be "dev", "qa" or "po"`)
  if (c.testStyle !== undefined && !FLOWS.includes(c.testStyle)) e.push(`testStyle ${JSON.stringify(c.testStyle)}: must be "project" (follow the project's own tests), "quality-code" or "both"`)
  ticketsDirErrors(c, allowAbsoluteTicketsDir, e)
  gitErrors(c, e)
  ticketTemplateErrors(c, e)
  redactErrors(c, e)
  if (c.messages !== undefined && !isObject(c.messages)) e.push('messages: must be an object')
  else if (c.messages?.jiraFillMark !== undefined && (typeof c.messages.jiraFillMark !== 'string' || !c.messages.jiraFillMark.trim()))
    e.push('messages.jiraFillMark: must be a non-empty text (the line above what a fill-in adds to Jira)')
  boundaryErrors(c, e)
  runnersErrors(c, e)
  vitestErrors(c, e)
  for (const name of OTHER_BACKENDS) {
    if (c[name] === undefined) continue
    if (!uses(c, name)) e.push(`${name}: only allowed with "backend": "${name}"`)
    else if (!isObject(c[name])) e.push(`${name}: must be an object`)
    else otherBackendErrors(c[name], name, e)
  }
  playwrightErrors(c, e)
  e.push(...ciErrors(c.ci))
  seedErrors(c, e)
  // Markdown QA plans, one per feature label: extra rules for writing, never scored.
  if (c.qaPlans !== undefined && !(pathOk(c.qaPlans) && c.qaPlans.endsWith('/'))) e.push(`qaPlans ${JSON.stringify(c.qaPlans)} must be a folder inside the project, ending with "/" (one <feature label>.md per feature)`)
  if (c.externalChecks !== undefined) {
    if (!Array.isArray(c.externalChecks) || !c.externalChecks.length) e.push('externalChecks: must be a non-empty list of files or globs (tests run outside the unit tests, like a pgTAP file), relative to the folder that holds the config')
    else c.externalChecks.forEach((p, i) => { if (!pathOk(p)) e.push(`externalChecks[${i}] ${JSON.stringify(p)} ${PATH_RULE}`) })
  }
  qaErrors(c, e)
  xrayErrors(c, e)
  testRulesErrors(c, e)
  centralContextErrors(c, e)
  sidesErrors(c, e)
  if (e.length) return { ok: false, errors: e }
  return {
    ok: true,
    config: {
      ...c,
      // Derived, never written back: single-side projects get their adapter; fullstack gets none.
      ...(c.frontend && c.backend ? {} : { adapter: c.frontend ?? c.backend }),
      // A trailing "/" is dropped: commands build <site>/wiki/… and <site>/browse/… from it.
      jira: { trackingProjects: [], ...j, site: noTrailingSlash(j.site) },
      languages: c.languages ?? DEFAULTS.languages,
      features: c.features ?? DEFAULTS.features,
      titlePrefixes: c.titlePrefixes ?? DEFAULTS.titlePrefixes,
      ticketsDir: cleanRelPath(c.ticketsDir ?? DEFAULTS.ticketsDir),
      // Merged: a custom pattern adds to the default customerId one, it does not turn it off.
      redact: { ...DEFAULTS.redact, ...(c.redact ?? {}) },
      messages: c.messages ?? DEFAULTS.messages,
      ticketTemplates: { ...DEFAULTS.ticketTemplates, ...(c.ticketTemplates ?? {}) },
    },
  }
}

/** The backend block's layers, else the backend's default. Frontend projects read Vitest's. */
export const layersOf = config => {
  const backend = backendOf(config) ?? 'vitest'
  return config?.[backend]?.layers ?? (backend === 'vitest' ? DEFAULT_LAYERS : BACKENDS[backend].defaultLayers)
}

/** {} when there is none. */
export const adapterOptions = config => {
  const b = isBackend(config?.adapter) || config?.adapter === 'playwright' ? config[config.adapter] : null
  return isObject(b) ? b : {}
}

/** Per runner process: the block's timeoutSeconds, else 600 for Playwright, else the backend's default. */
export const timeoutSecondsOf = config => adapterOptions(config).timeoutSeconds ?? (config?.adapter === 'playwright' ? 600 : BACKENDS[config?.adapter]?.timeoutSeconds ?? 300)

/** null means no cap. */
export const maxMutantsOf = config => adapterOptions(config).maxMutants ?? null

/** Template with {files}, {report}, {test}, or null. */
export const commandOf = config => adapterOptions(config).command ?? null

export const seedOf = config => {
  const s = isObject(config?.seed) ? config.seed : {}
  return { schema: s.schema ?? null, target: s.target ?? null, apply: s.apply ?? null, tenant: s.tenant ?? null, guide: s.guide ?? null }
}

/** Defaults stop after 2 blocked tests in a row. */
export const qaOf = config => {
  const q = isObject(config?.qa) ? config.qa : {}
  const s = isObject(q.statuses) ? q.statuses : {}
  return {
    executionTypes: Array.isArray(q.executionTypes) ? q.executionTypes : ['Test Execution', 'Sub Test Execution'],
    sprint: q.sprint ?? 'open',
    app: q.app ?? null,
    statuses: { ko: s.ko ?? null, ready: s.ready ?? null, done: s.done ?? null },
    blockedStop: q.blockedStop ?? 2,
    autoPass: q.autoPass ?? false,
  }
}

/** null when off. */
export const xrayOf = (config, source = 'repo') => {
  const x = config?.xray
  // Xray is part of Jira: a personal setup (no repo) has it on without a block, with the cases kept in its tickets folder.
  if (!x && source === 'personal' && config?.ticketsDir) return { csv: `${cleanRelPath(config.ticketsDir)}/xray-cases.csv`, folder: `${cleanRelPath(config.ticketsDir)}/`, headers: { ...XRAY_HEADERS } }
  if (!isObject(x)) return null
  return { csv: x.csv, folder: x.folder ?? `${cleanRelPath(config.ticketsDir ?? DEFAULTS.ticketsDir)}/`, headers: { ...XRAY_HEADERS, ...(x.headers ?? {}) } }
}

/** playwright.ungradedTitles as a regex: never graded or mutated. null when unset. */
export const ungradedTitlesOf = (config, dialect) => {
  const u = config?.playwright?.ungradedTitles
  return dialect?.name === 'playwright' && typeof u === 'string' && u ? new RegExp(u, 'i') : null
}

/** [] when playwright.redTags is null. */
export const redTagsOf = config => {
  const rt = config?.playwright?.redTags
  return rt === null ? [] : Object.values({ ...DEFAULT_RED_TAGS, ...(rt ?? {}) })
}

export const doneStatusesOf = config => config?.jira?.doneStatuses ?? DEFAULT_DONE_STATUSES

/** Whole percentage of Stryker mutants that must be killed. */
export const strykerThreshold = config => config?.vitest?.stryker?.threshold ?? DEFAULT_STRYKER_THRESHOLD

export const strykerTimeoutSeconds = config => config?.vitest?.stryker?.timeoutSeconds ?? DEFAULT_STRYKER_TIMEOUT_SECONDS

/** CLAUDE_CONFIG_DIR, else ~/.claude. */
export const claudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** Personal config (no repo). */
export const personalConfigPath = (env = process.env) => join(claudeDir(env), 'quality-code.json')
/** Where a personal setup saves tickets: absolute, so it never depends on the folder the user is in. */
export const personalTicketsDir = (env = process.env) => cleanRelPath(join(claudeDir(env), 'quality-code', 'tickets'))

function readValidated(p, label, source, env, root) {
  let obj
  try { obj = JSON.parse(readFileSync(p, 'utf8')) } catch (err) {
    return { ok: false, source, path: p, errors: [`${label} is not valid JSON (${err.message}). ${SETUP}`] }
  }
  const own = isObject(obj) ? obj.ticketsDir : undefined
  if (source === 'personal' && isObject(obj) && obj.ticketsDir === undefined) obj = { ...obj, ticketsDir: personalTicketsDir(env) }
  const r = { ...validateConfig(obj, { allowAbsoluteTicketsDir: source === 'personal' }), source, path: p }
  if (!r.ok) return r
  // ticketsDir follows the person's place pick: repo, local or chat.
  const dirs = placeDirs(root, { source, ticketsDir: own, personalDefault: personalTicketsDir(env) }, placeOf(root, source, env), env)
  return { ...r, config: { ...r.config, ticketsDir: dirs.ticketsDir }, place: dirs.place, auditDir: dirs.auditDir }
}

// Repo config first, else the personal one. validateConfig's result plus source, path, place and auditDir;
// config.ticketsDir is the place's tickets folder.
export function loadConfig(root, env = process.env) {
  const rp = configFileOf(configHome(root, env), env)
  if (rp) return readValidated(rp, rp.endsWith(CONFIG_REL) ? CONFIG_REL : 'config.json', 'repo', env, root)
  const pp = personalConfigPath(env)
  if (existsSync(pp)) return readValidated(pp, pp, 'personal', env, root)
  return { ok: false, missing: true, errors: ['Quality Code is not set up here yet. Run /quality-code:setup: in your repo as a developer, or from any folder as QA or PO.'] }
}
