// /quality-code:clean. Deletes only paths from buildList(), re-checked one by one; callers pick groups, never paths.
// Groups:
//   setup    older .claude/quality-code.json, the files setup wrote (only while unchanged), its exact .gitignore lines
//   output   the tickets folder, .quality-code/, .claude/quality-code/ (audit log, run logs, evals, Jira fields)
//   cache    this project's folder under <Claude folder>/quality-code/progress/
//   personal <Claude folder>/quality-code.json (every project reads it: only when picked)
//   specs    tests written by /quality-code:spec (they carry the ticket tag); kept unless picked
// Every path stays inside the project (no `..`, no link leading out, never .git), except the cache and personal config.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lines, localToForwardSlashes } from '../core/text.mjs'
import { CONFIG_REL, DEFAULTS, claudeDir, configFileOf, configHome, layersOf, loadConfig, personalConfigPath, redTagsOf, xrayOf } from '../config/config.mjs'
import { CONFIG_FILE, prefsPath, savedPlace } from '../config/places.mjs'
import { git } from '../core/git.mjs'
import { dirOf, short, slug } from '../state/progress.mjs'
import { adaptersOf, asAdapter } from '../stacks/stack.mjs'
import { DEFAULT_E2E_FOLDER } from '../stacks/e2e-folder.mjs'
import { projectSpecs } from '../report/quality-program.mjs'
import { anchorRange, scoreSpec } from '../pipeline/checks/suite-honesty.mjs'
import { dialectFor } from '../stacks/dialects/index.mjs'
import { keyPattern } from '../config/keys.mjs'
import { FIELDS_REL } from '../ticket/fields.mjs'
import { RUNTIME_GITIGNORE, SMOKE_TEXT, playwrightConfigText } from '../../bin/setup.mjs'
import { readJson, tryReadJson } from '../core/files.mjs'
import { cleanRelPath, leavesFolder } from '../core/paths.mjs'

export const GROUPS = ['setup', 'output', 'cache', 'personal', 'specs']
export const LABELS = { setup: 'Setup files', output: 'Saved output', cache: 'Cache', personal: 'Personal config', specs: 'Tests written by spec' }
const TEMPLATES = new URL('../../resources/', import.meta.url)
const KEY_DIR = /^[A-Za-z][A-Za-z0-9_]*-\d+$/
const KEY_TAG = /@[A-Z][A-Z0-9_]*-\d+\b/
const TICKET_FILES = ['ticket.json', 'raw.json', 'run.md', 'case.csv', 'case.xlsx']
const MARKER = 'Written by quality-code setup'
const PLAYWRIGHT_LINES = ['test-results/', 'playwright-report/']
const SIGN_IN_LINES = ['playwright/.auth/', '.env.e2e']
const MAX_WALK = 5000

const lstat = p => { try { return lstatSync(p) } catch { return null } }
const read = p => { try { return readFileSync(p, 'utf8') } catch { return null } }
const real = p => { try { return realpathSync(p) } catch { return resolve(p) } }
/** a is b or inside it. */
const inside = (a, b) => !leavesFolder(relative(real(b), real(a)))
const GOAL = /^\d{4}-\d{2}-\d{2}-goal\.md$/

/** null if safe to delete: inside `top`, no `..`, no symlink on the way or leading out, not .git. Else the reason. */
export function unsafeReason(top, abs, { raw = abs } = {}) {
  if (typeof abs !== 'string' || !abs) return 'no path'
  if (String(raw).split(/[\\/]/).includes('..')) return 'the path contains ".."'
  const base = resolve(top)
  const full = resolve(abs)
  const rel = relative(base, full)
  if (!rel) return 'that is the project folder itself'
  if (leavesFolder(rel)) return 'outside the project'
  const parts = rel.split(sep)
  if (parts.includes('.git')) return 'inside .git'
  let cur = base
  for (const seg of parts.slice(0, -1)) {
    cur = join(cur, seg)
    const st = lstat(cur)
    if (!st) return null
    if (st.isSymbolicLink()) return `a link on the way (${localToForwardSlashes(relative(base, cur))})`
  }
  const st = lstat(full)
  if (st?.isSymbolicLink()) {
    let real
    try { real = realpathSync(full) } catch { return 'a broken link' }
    const realBase = realpathSync(base)
    const back = relative(realBase, real)
    if (leavesFolder(back)) return 'a link that leads outside the project'
  }
  return null
}

const count = abs => {
  let n = 0
  const walk = d => {
    let names = []
    try { names = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of names) {
      if (n >= MAX_WALK) return
      if (e.isDirectory() && !e.isSymbolicLink()) walk(join(d, e.name))
      else n++
    }
  }
  const st = lstat(abs)
  if (!st) return 0
  if (st.isDirectory() && !st.isSymbolicLink()) { walk(abs); return n }
  return 1
}

// null when there is no repo or no git.
function trackedSet(top) {
  const r = git(top, ['ls-files', '-z'])
  return r.ok ? new Set(r.out.split('\0').filter(Boolean)) : null
}
const trackedUnder = (set, rel) => (set ? [...set].filter(f => f === rel || f.startsWith(`${rel}/`)).sort() : [])

const item = (top, abs, extra = {}) => {
  const st = lstat(abs)
  return { abs, rel: localToForwardSlashes(relative(top, abs)), kind: st?.isDirectory() && !st.isSymbolicLink() ? 'dir' : 'file', files: count(abs), ...extra }
}

function rawTicketsDir(top) {
  try {
    const c = readJson(configFileOf(top) ?? join(top, CONFIG_REL))
    return typeof c?.ticketsDir === 'string' ? cleanRelPath(c.ticketsDir) : DEFAULTS.ticketsDir
  } catch { return DEFAULTS.ticketsDir }
}

// Only if still byte-for-byte what setup wrote.
function setupPlaywright(root) {
  for (const ext of ['ts', 'js']) {
    const rel = `playwright.config.${ext}`
    const text = read(join(root, rel))
    const m = text && /webServer: \{ command: '((?:[^'\\]|\\.)*)', url: '((?:[^'\\]|\\.)*)', reuseExistingServer/.exec(text)
    if (!m) continue
    const un = s => s.replace(/\\(.)/g, '$1')
    for (const signIn of [false, true]) if (playwrightConfigText({ command: un(m[1]), url: un(m[2]), signIn }) === text) return { rel, signIn }
  }
  return null
}

function scaffoldFiles(root, config) {
  const out = []
  const pw = setupPlaywright(root)
  if (pw) out.push(pw.rel)
  for (const ext of ['ts', 'js']) {
    const rel = `${DEFAULT_E2E_FOLDER}smoke.spec.${ext}`
    if (read(join(root, rel)) === SMOKE_TEXT) out.push(rel)
  }
  const marked = rel => (read(join(root, rel)) ?? '').slice(0, 600).includes(MARKER)
  for (const ext of ['ts', 'js']) for (const rel of [`vitest.config.${ext}`, `vitest.integration.config.${ext}`]) if (marked(rel)) out.push(rel)
  if (config) {
    const folders = new Set()
    for (const a of adaptersOf(config)) { try { for (const l of layersOf(asAdapter(config, a))) if (/integration/i.test(`${l.name} ${l.folder}`)) folders.add(l.folder) } catch {} }
    for (const f of folders) for (const n of ['global-setup.ts', 'global-setup.js', 'databases.ts', 'databases.js', 'conftest.py', 'TestDatabases.cs']) if (marked(join(f, n))) out.push(localToForwardSlashes(join(f, n)))
  }
  return { files: [...new Set(out)], playwright: pw }
}

function templateFiles(root, config) {
  const out = []
  for (const kind of ['bug', 'story']) {
    const rel = config?.ticketTemplates?.[kind]
    if (typeof rel !== 'string' || !rel) continue
    const text = read(join(root, rel))
    const own = read(new URL(`${kind}-template.md`, TEMPLATES))
    if (text !== null && own !== null && text.trim() === own.trim()) out.push(rel)
  }
  return out
}

function gitignoreItem(root, top, ownsPlaywright) {
  const abs = join(root, '.gitignore')
  const text = read(abs)
  if (text === null) return null
  const ticketsLine = `${rawTicketsDir(top)}/*/raw.json`
  const wanted = new Set([ticketsLine, FIELDS_REL, ...RUNTIME_GITIGNORE, ...(ownsPlaywright ? PLAYWRIGHT_LINES : []), ...(ownsPlaywright?.signIn ? SIGN_IN_LINES : [])])
  const present = [...new Set(lines(text).map(l => l.trim()).filter(l => wanted.has(l)))]
  return present.length ? { abs, rel: localToForwardSlashes(relative(top, abs)), kind: 'lines', lines: present, files: 1 } : null
}

// Whole folder if it's a plugin folder, else only the ticket folders and files we wrote.
function ticketItems(top, root, config, env) {
  const kept = []
  const dir = config?.ticketsDir ?? DEFAULTS.ticketsDir
  if (isAbsolute(dir)) {
    const home = join(claudeDir(env), 'quality-code', 'projects', `${slug(root)}-${short(root)}`)
    if (resolve(dir) === resolve(join(home, 'tickets')) && existsSync(home)) return { items: [item(top, home, { outside: 'local' })], kept }
    return { items: [], kept: existsSync(dir) ? [{ rel: dir, why: 'a tickets folder outside the project is never deleted' }] : [] }
  }
  const abs = resolve(root, dir)
  const rel = localToForwardSlashes(relative(top, abs))
  if (!lstat(abs)) return { items: [], kept }
  if (!rel || leavesFolder(rel) || String(dir).split(/[\\/]/).includes('..')) return { items: [], kept: [{ rel: dir, why: 'the tickets folder is not inside the project' }] }
  if (rel === '.quality-code' || rel.startsWith('.quality-code/') || rel === '.claude/quality-code' || rel.startsWith('.claude/quality-code/')) return { items: [item(top, abs)], kept }
  const items = []
  const xcsv = xrayOf(config)?.csv
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const p = join(abs, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory() && KEY_DIR.test(e.name) && TICKET_FILES.some(f => existsSync(join(p, f)))) items.push(item(top, p))
    // sprint/<date>-goal.md (transcript-goal) and the Xray CSV.
    else if (e.isDirectory() && e.name === 'sprint') {
      const goals = readdirSync(p, { withFileTypes: true })
      if (goals.every(x => x.isFile() && GOAL.test(x.name))) items.push(item(top, p))
      else for (const x of goals) if (x.isFile() && GOAL.test(x.name)) items.push(item(top, join(p, x.name)))
    } else if (e.isFile() && (e.name === 'xray-cases.csv' || (xcsv && resolve(root, xcsv) === p))) items.push(item(top, p))
  }
  return { items, kept }
}

/** Title of the first test outside the keys' blocks, or null. A file the dialect can't read counts as spec's. */
function otherTest(text, runner, keys) {
  let dialect
  try { dialect = dialectFor(runner) } catch { return null }
  const blocks = keys.map(k => anchorRange(text, k, dialect)).filter(Boolean)
  // A test outside every block is still spec's when its title or its own line (a Playwright tag list) has the key.
  const line = t => text.slice(t.idx, (text.indexOf('\n', t.idx) + 1 || text.length + 1) - 1)
  const t = scoreSpec(text, dialect).find(t => !blocks.some(([a, b]) => t.idx >= a && t.idx < b) && !keys.some(k => keyPattern(k).test(t.title) || keyPattern(k).test(line(t))))
  return t ? t.title : null
}

function specItems(root, top, config) {
  const none = { items: [], kept: [] }
  if (!config) return none
  const tags = Object.values(redTagsOf(config))
  const out = [], kept = []
  let specs = []
  try { specs = projectSpecs(root, config) } catch { return none }
  for (const s of specs) {
    const abs = join(root, s.path)
    const text = read(abs)
    if (text === null) continue
    const why = KEY_TAG.exec(text)?.[0] ?? tags.find(t => text.includes(t))
    if (!why) continue
    // Spec added its tests to a file that holds other tests: deleting it would take those too.
    // Read as the checks read it: a test is spec's inside the block of a key tagged in this file, or named with that key.
    const other = otherTest(text, s.adapter, [...new Set([...text.matchAll(new RegExp(KEY_TAG, 'g'))].map(m => m[0].slice(1)))])
    if (other !== null) kept.push({ rel: item(top, abs).rel, why: `it also holds tests not written by spec (${other.slice(0, 60)}): take the ${why} tests out by hand` })
    else out.push({ ...item(top, abs), marker: why })
  }
  return { items: out, kept }
}

const nested = (a, b) => a.abs !== b.abs && (b.abs === a.abs || b.abs.startsWith(`${a.abs}${sep}`))
const dedupe = items => items.filter(i => !items.some(o => nested(o, i)))

/** Everything the plugin owns here, by group. Takes no paths from the caller. */
export function buildList(rootIn, env = process.env) {
  const loaded = loadConfig(rootIn, env)
  const config = loaded.ok ? loaded.config : null
  const top = configHome(resolve(rootIn), env)
  const root = resolve(rootIn)
  const tracked = trackedSet(top)
  const kept = []
  // Shared by every project: the personal config and ~/.claude/quality-code. They land under <top> when the project is $HOME.
  const globalDir = join(claudeDir(env), 'quality-code')
  const theirs = i => !i.outside && (real(i.abs) === real(personalConfigPath(env)) || inside(i.abs, globalDir) || inside(globalDir, i.abs))
  const own = items => items.filter(i => !theirs(i) || (kept.push({ rel: i.rel, why: 'the personal config and the plugin\'s own folder are never deleted from here' }), false))

  const setup = []
  const cfgAbs = join(top, CONFIG_REL)
  if (lstat(cfgAbs)) setup.push(item(top, cfgAbs))
  // The placed config belongs to setup too.
  const placed = [configFileOf(top, env)].find(p => p && real(p) !== real(cfgAbs)) ?? null
  if (placed) setup.push(inside(placed, top) ? item(top, placed) : { abs: placed, rel: placed, kind: 'file', files: 1, outside: 'config' })
  const scaffold = scaffoldFiles(root, config)
  for (const rel of [...templateFiles(root, config), ...scaffold.files]) if (lstat(join(root, rel))) setup.push(item(top, join(root, rel)))
  const gi = gitignoreItem(root, top, scaffold.playwright ? { signIn: scaffold.playwright.signIn } : false)
  if (gi) setup.push(gi)

  const out = []
  const t = ticketItems(top, root, config, env)
  kept.push(...t.kept)
  out.push(...t.items)
  for (const rel of ['.quality-code', '.claude/quality-code']) if (lstat(join(top, rel))) out.push(item(top, join(top, rel)))
  // The config's folder goes file by file; the config itself is left to setup.
  const output = dedupe(own(out)).flatMap(i => i.kind === 'dir' && placed && real(dirname(placed)) === real(i.abs)
    ? readdirSync(i.abs).filter(n => n !== CONFIG_FILE).map(n => item(top, join(i.abs, n), i.outside ? { outside: i.outside } : {}))
    : [i])

  const cache = []
  const cacheDir = join(dirOf(env), `${slug(root)}-${short(root)}`)
  if (lstat(cacheDir)) cache.push(item(cacheDir, cacheDir, { outside: 'cache', rel: cacheDir }))

  const personal = []
  const pp = personalConfigPath(env)
  if (lstat(pp)) personal.push({ abs: pp, rel: pp, kind: 'file', files: 1, outside: 'personal' })

  // Listed, never edited here: each has its own way back.
  if (tryReadJson(join(top, '.claude', 'settings.json'), null)?.outputStyle === 'quality-code:report') kept.push({ rel: '.claude/settings.json (outputStyle)', why: 'the report reply style: turn it off in /quality-code:config, item 15' })
  if (savedPlace(root, 'repo', env)) kept.push({ rel: `${prefsPath(env)} (this project's pick)`, why: 'where you keep this project\'s files; the file holds the pick of every project' })
  const plugins = tryReadJson(join(claudeDir(env), 'settings.json'), null)?.pluginConfigs ?? {}
  if (Object.entries(plugins).some(([k, v]) => k.startsWith('quality-code@') && v?.options?.jira_email)) kept.push({ rel: `${join(claudeDir(env), 'settings.json')} (jira_email)`, why: 'your Jira email, used by every project: change it in /quality-code:config' })

  const specs = specItems(root, top, config)
  kept.push(...specs.kept)
  if (!loaded.ok && !loaded.missing) kept.push({ rel: LABELS.specs, why: `not listed, the config does not load (${loaded.errors[0]}). Run /quality-code:setup, then clean again` })

  const groups = [
    { id: 'setup', items: own(setup) },
    { id: 'output', items: output },
    { id: 'cache', items: cache },
    { id: 'personal', items: personal },
    { id: 'specs', items: own(specs.items) },
  ].map(g => ({
    ...g,
    label: LABELS[g.id],
    items: g.items.map(i => ({ ...i, tracked: i.outside ? [] : i.kind === 'lines' ? trackedUnder(tracked, i.rel) : trackedUnder(tracked, i.rel) })),
  }))
  return { ok: true, root, top, groups, kept, git: tracked !== null, configDir: placed ? dirname(placed) : null }
}

// Second check before delete: project items must be inside it, outside ones at their known location.
function allowed(list, it, env) {
  if (it.outside === 'cache') {
    const base = resolve(dirOf(env))
    if (resolve(it.abs) !== resolve(join(base, `${slug(list.root)}-${short(list.root)}`))) return 'not this project\'s cache folder'
    const st = lstat(it.abs)
    if (st?.isSymbolicLink()) return 'the cache folder is a link'
    return null
  }
  if (it.outside === 'personal') {
    if (resolve(it.abs) !== resolve(personalConfigPath(env))) return 'not the personal config'
    const st = lstat(it.abs)
    return st?.isFile() && !st.isSymbolicLink() ? null : 'the personal config is not a plain file'
  }
  if (it.outside === 'local') {
    const home = resolve(join(claudeDir(env), 'quality-code', 'projects', `${slug(list.root)}-${short(list.root)}`))
    const at = resolve(it.abs)
    const st = lstat(it.abs)
    if (at !== home && (dirname(at) !== home || basename(at) === CONFIG_FILE)) return 'not this project\'s folder on this machine'
    return st?.isSymbolicLink() ? 'that folder is a link' : null
  }
  if (it.outside === 'config') {
    if (resolve(it.abs) !== resolve(configFileOf(list.top, env) ?? '')) return 'not this project\'s config'
    const st = lstat(it.abs)
    return st?.isFile() && !st.isSymbolicLink() ? null : 'the config is not a plain file'
  }
  return unsafeReason(list.top, it.abs)
}

function removeLines(it, top) {
  const text = read(it.abs)
  if (text === null) return 'could not read'
  const drop = new Set(it.lines)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const keep = lines(text).filter(l => !drop.has(l.trim()))
  const body = keep.join(eol)
  if (!body.trim()) {
    // Only our lines were left: delete the file unless git tracks it.
    if (trackedSet(top)?.has(it.rel)) writeFileSync(it.abs, '')
    else unlinkSync(it.abs)
    return null
  }
  writeFileSync(it.abs, body)
  return null
}

/** `specs` is 'all' or spec paths from the list. */
export function runClean(rootIn, { groups = [], specs = [], dryRun = false } = {}, env = process.env) {
  const bad = groups.filter(g => !GROUPS.includes(g))
  if (bad.length) return { ok: false, errors: [`unknown group ${bad.join(', ')} (${GROUPS.join(', ')})`] }
  const list = buildList(rootIn, env)
  const chosen = []
  const kept = [...list.kept.map(k => ({ rel: k.rel, why: k.why }))]
  const errors = []
  for (const g of list.groups) {
    if (!groups.includes(g.id)) { for (const i of g.items) kept.push({ rel: i.rel, why: `${g.label} not picked`, group: g.id }); continue }
    if (g.id === 'specs') {
      const all = specs === 'all' || (Array.isArray(specs) && specs.includes('all'))
      const want = new Set(all ? g.items.map(i => i.rel) : specs)
      for (const w of want) if (!g.items.some(i => i.rel === w)) errors.push(`${w} is not on the list of tests written by spec`)
      for (const i of g.items) { if (want.has(i.rel)) chosen.push({ ...i, group: g.id }); else kept.push({ rel: i.rel, why: 'not picked', group: g.id }) }
      continue
    }
    for (const i of g.items) chosen.push({ ...i, group: g.id })
  }
  if (groups.includes('specs') && !specs.length) errors.push('the spec group needs --specs all, or the spec paths from the list')
  if (errors.length) return { ok: false, errors }
  const deleted = []
  for (const it of chosen) {
    const why = allowed(list, it, env)
    if (why) { kept.push({ rel: it.rel, why, group: it.group }); continue }
    if (!lstat(it.abs)) continue
    if (dryRun) { deleted.push({ rel: it.rel, group: it.group, kind: it.kind, files: it.files, tracked: it.tracked, lines: it.lines }); continue }
    try {
      if (it.kind === 'lines') { const e = removeLines(it, list.top); if (e) { kept.push({ rel: it.rel, why: e, group: it.group }); continue } }
      else if (it.kind === 'dir') rmSync(it.abs, { recursive: true, force: false })
      else unlinkSync(it.abs)
      deleted.push({ rel: it.rel, group: it.group, kind: it.kind, files: it.files, tracked: it.tracked, lines: it.lines })
    } catch (err) { kept.push({ rel: it.rel, why: `could not delete: ${err.message}`, group: it.group }) }
  }
  // Remove the config folder if now empty.
  if (!dryRun && list.configDir) { try { rmdirSync(list.configDir) } catch {} }
  // Same for a tickets folder we emptied.
  if (!dryRun && groups.includes('output')) {
    const dir = list.groups.find(g => g.id === 'output')
    const tdir = loadConfig(rootIn, env).config?.ticketsDir
    if (dir && tdir && !isAbsolute(tdir) && !unsafeReason(list.top, resolve(list.root, tdir), { raw: tdir })) {
      const rel = localToForwardSlashes(relative(list.top, resolve(list.root, tdir)))
      if (rel && rel !== '.quality-code' && !rel.startsWith('.quality-code/') && !rel.startsWith('.claude/quality-code')) { try { rmdirSync(resolve(list.root, tdir)) } catch {} }
    }
  }
  return { ok: true, dryRun, deleted, kept, errors: [], git: list.git, name: basename(list.root) }
}
