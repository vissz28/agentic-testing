// `ticket.mjs config set <key> <value>` and `config get <key>`: change or read one setting of the project
// config, the personal config or the file location, by a dotted key. Every change is checked by
// validateConfig and written by the same writers setup uses; nothing is written on an error, and a
// secret (a token-like key or value) is refused before anything else.
import { existsSync, readFileSync } from 'node:fs'
import { configHome, configPath, DEFAULTS, loadConfig, personalConfigPath, personalTicketsDir, projectRoot, validateConfig } from '../base/config.mjs'
import { pickPlace, placeDirs, placeOf, placesFor } from '../base/places.mjs'
import { FLOWS } from '../base/conventions.mjs'
import { RUNNERS } from '../base/runners.mjs'
import { write, writePersonal } from '../../bin/setup.mjs'
import { tag, printLine, printError } from '../core/script-io.mjs'
import { plural } from '../core/text.mjs'

const T = { text: 'text', list: 'list', bool: 'bool', int: 'int', enum: 'enum', url: 'url', configs: 'configs' }
function runnersOf(kind) { return Object.keys(RUNNERS).filter(r => RUNNERS[r].kind === kind) }
/** The settings `config set` can change: dotted key -> type. Nothing else is settable here. */
export const KEYS = Object.freeze({
  'jira.site': { type: T.url },
  'jira.projects': { type: T.list },
  'jira.trackingProjects': { type: T.list, optional: true },
  'jira.bugTypes': { type: T.list, optional: true },
  'jira.doneStatuses': { type: T.list, optional: true },
  'jira.acceptanceCriteriaField': { type: T.text, optional: true },
  'git.base': { type: T.text, optional: true },
  'root': { type: T.text, optional: true, project: true },
  'ticketsDir': { type: T.text, optional: true },
  'testStyle': { type: T.enum, choices: FLOWS, optional: true, project: true },
  'languages': { type: T.list },
  'titlePrefixes': { type: T.list, optional: true },
  'qa.app': { type: T.text, optional: true },
  'qa.sprint': { type: T.enum, choices: ['open', 'any'], optional: true },
  'qa.executionTypes': { type: T.list, optional: true },
  'qa.statuses.ko': { type: T.text, optional: true },
  'qa.statuses.ready': { type: T.text, optional: true },
  'qa.statuses.done': { type: T.text, optional: true },
  'qa.blockedStop': { type: T.int, optional: true },
  'qa.autoPass': { type: T.bool, optional: true },
  'runners.unit': { type: T.enum, choices: runnersOf('unit'), optional: true, project: true },
  'runners.e2e': { type: T.enum, choices: runnersOf('e2e'), optional: true, project: true },
  'vitest.configs': { type: T.configs, optional: true, project: true },
  'playwright.configs': { type: T.configs, optional: true, project: true },
  'place': { type: T.enum, choices: ['repo', 'local', 'chat'], file: true },
})
/** One example value for each settable key, shown by `config keys`. */
export const EXAMPLES = Object.freeze({
  'jira.site': 'acme.atlassian.net', 'jira.projects': 'ABC,DEF', 'jira.trackingProjects': 'ABC', 'jira.bugTypes': 'Bug,Defect',
  'jira.doneStatuses': 'Done,Closed', 'jira.acceptanceCriteriaField': 'customfield_10100', 'git.base': 'develop', 'root': 'apps/web',
  'ticketsDir': '.qc/tickets', 'testStyle': 'project', 'languages': 'en,it', 'titlePrefixes': 'Spike:,Chore:', 'qa.app': 'https://app.example.com',
  'qa.sprint': 'open', 'qa.executionTypes': 'Test Execution', 'qa.statuses.ko': 'TEST KO', 'qa.statuses.ready': 'Ready to test',
  'qa.statuses.done': 'Done', 'qa.blockedStop': '2', 'qa.autoPass': 'false', 'place': 'local',
  'runners.unit': 'jest', 'runners.e2e': 'playwright',
  'vitest.configs': 'services/**=jest.config.js,web/**=web/vitest.config.ts', 'playwright.configs': 'e2e/**=e2e/playwright.config.ts',
})
const CLEAR = /^(none|null|unset|default)$/i
const PLUGIN_KEY = /^(jira[._-]?email|gitlab|xray[._-]?(api[._-]?url|client)|figma)/i
const SECRET_KEY = /(token|secret|passw(or)?d|api[._-]?key|credential|private[._-]?key|client[._-]?id)/i
const SECRET_VALUE = [
  /\b(glpat-|ghp_|gho_|ghs_|ghu_|github_pat_|figd_|xox[abprs]-|AKIA[0-9A-Z]{8,}|ATATT[\w-]{6,})/,
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bBearer\s+\S/i, /-----BEGIN [A-Z ]*KEY/, /eyJ[\w-]{10,}\.[\w-]{10,}/,
  /\/\/[^/\s:@]+:[^/\s@]+@/,
]
const looksSecret = v => SECRET_VALUE.some(re => re.test(v)) || v.split(/[\s,]+/).some(w => w.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(w) && /[a-z]/.test(w) && /[A-Z]/.test(w) && /\d/.test(w))

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
/** A copy of a config without secrets: a token-like key, or a value that looks like a token or a key. */
export function withoutSecrets(v) {
  if (Array.isArray(v)) return v.map(withoutSecrets).filter(x => x !== undefined)
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([k, x]) => !SECRET_KEY.test(k) && !(typeof x === 'string' && looksSecret(x))).map(([k, x]) => [k, withoutSecrets(x)]))
  return typeof v === 'string' && looksSecret(v) ? undefined : v
}
const show = v => (v === undefined ? 'not set' : typeof v === 'string' ? v : JSON.stringify(v))
const getPath = (o, key) => key.split('.').reduce((v, k) => (isObj(v) ? v[k] : undefined), o)

/** A copy of o with the dotted key set to value, or removed when value is undefined (an emptied block goes too). */
function setPath(o, key, value) {
  const parts = key.split('.')
  const out = { ...o }
  const chain = [out]
  let cur = out
  for (const k of parts.slice(0, -1)) { cur[k] = isObj(cur[k]) ? { ...cur[k] } : {}; cur = cur[k]; chain.push(cur) }
  if (value !== undefined) { cur[parts.at(-1)] = value; return out }
  delete cur[parts.at(-1)]
  for (let i = parts.length - 1; i > 0; i--) if (Object.keys(chain[i]).length === 0) delete chain[i - 1][parts[i - 1]]
  return out
}

/** The typed value of a text: { value }, { clear: true } or { error }. */
export function parseValue(spec, key, raw) {
  const text = String(raw).trim()
  if (CLEAR.test(text) && spec.optional) return { clear: true }
  switch (spec.type) {
    case T.list: {
      const list = text.split(',').map(s => s.trim()).filter(Boolean)
      return list.length ? { value: list } : { error: `${key}: give at least one value, separated by commas` }
    }
    case T.bool:
      if (/^(true|yes|on)$/i.test(text)) return { value: true }
      if (/^(false|no|off)$/i.test(text)) return { value: false }
      return { error: `${key}: must be true or false (found "${text}")` }
    case T.int: return /^-?\d+$/.test(text) ? { value: Number(text) } : { error: `${key}: must be a whole number (found "${text}")` }
    case T.enum: return spec.choices.includes(text) ? { value: text } : { error: `${key}: must be ${spec.choices.map(c => `"${c}"`).join(' or ')} (found "${text}")` }
    case T.configs: {
      // "match=config" pairs, comma separated: which test config runs the specs that match.
      const rows = text.split(',').map(s => s.trim()).filter(Boolean).map(s => { const i = s.lastIndexOf('='); return i > 0 ? { match: s.slice(0, i).trim(), config: s.slice(i + 1).trim() } : null })
      return rows.length && rows.every(Boolean) ? { value: rows } : { error: `${key}: give match=config pairs separated by commas, like services/**=jest.config.js` }
    }
    case T.url: return text ? { value: /^https?:\/\//i.test(text) ? text : `https://${text.replace(/\/+$/, '')}` } : { error: `${key}: must not be empty` }
    default: return text ? { value: text } : { error: `${key}: must not be empty` }
  }
}

const IN_PLUGIN = 'Set it in /plugin: type /plugin, choose quality-code, Configure options, then /reload-plugins.'
/** The plugin field a token or plugin-setting key stands for: { field, secret, where }. */
export function pluginField(key) {
  const k = key.toLowerCase().replace(/[._-]/g, '')
  if (/^(github|gh)(token|pat|key)?/.test(k) && /token|pat|key|secret|password/.test(k)) return { field: null, secret: true, where: 'GitHub has no plugin field: it uses the gh sign-in. In a terminal run gh auth login.' }
  if (k.startsWith('gitlabtoken') || (k.startsWith('gitlab') && /token|key|pass/.test(k))) return { field: 'gitlab_token', secret: true, where: 'a GitLab personal access token with only the read_api scope (avatar, Edit profile, Access tokens)' }
  if (k.startsWith('gitlabusername')) return { field: 'gitlab_username', secret: false, where: 'your GitLab username (without @) or email' }
  if (k.startsWith('gitlab')) return { field: 'gitlab_api_url', secret: false, where: 'your GitLab address ending in /api/v4' }
  if (k.startsWith('figma')) return { field: 'figma_api_key', secret: true, where: 'Figma, Settings, Security, Personal access tokens' }
  if (k.startsWith('xray') && /token|key|secret|id$/.test(k)) return { field: /secret/.test(k) ? 'xray_client_secret' : 'xray_client_id', secret: true, where: 'Xray, API Keys: the Client ID and Client Secret of a key a Jira admin creates (set both: xray_client_id and xray_client_secret)' }
  if (k.startsWith('xray')) return { field: 'xray_api_url', secret: false, where: "Xray Cloud's address, like https://xray.cloud.getxray.app" }
  if (k.startsWith('jiraemail')) return { field: 'jira_email', secret: false, where: 'the email of your Atlassian account' }
  return { field: null, secret: SECRET_KEY.test(key), where: null }
}
/** The exact steps to set a plugin field, one line each. Never holds a value. */
export function pluginSteps(key) {
  const f = pluginField(key)
  if (!f.field) return [f.where ?? IN_PLUGIN]
  const lines = ['1. Type /plugin configure quality-code@teamsystem', `2. Set the field ${f.field}: ${f.where}`]
  if (f.field === 'gitlab_token') lines.push('   Use only the read_api scope. Set gitlab_username too, so the check can confirm the token is yours.')
  lines.push('3. Type /reload-plugins', f.secret ? '/quality-code:config shows only "set" or "not set" for it, never the value.' : '/quality-code:config shows the value.')
  return lines
}
/** Why this key or value is refused before anything else, or null. Never repeats the value. */
export function refusal(key, value) {
  const f = pluginField(key)
  if (SECRET_KEY.test(key) || f.secret) return `${key}: this is a protected plugin setting (a token, key or password). It is never set here and never typed in the chat; it goes to your keychain.\n${pluginSteps(key).join('\n')}`
  if (PLUGIN_KEY.test(key)) return `${key}: this is a plugin setting (Jira email, GitLab, Xray address), not a config key. ${IN_PLUGIN}\n${pluginSteps(key).join('\n')}`
  if (value !== undefined && looksSecret(String(value))) return `${key}: the value looks like a token or a key, so it was not used and nothing was written. Please don't paste tokens here; revoke that one and set a new one from /plugin.`
  return null
}

/** Which config the change goes to: { source, path, config } or { error }. */
function target(root, env, scope) {
  const loaded = loadConfig(root, env)
  const source = scope ?? loaded.source
  if (!source) return { error: 'Quality Code is not set up here yet: run /quality-code:setup.' }
  const path = source === 'repo' ? configPath(configHome(root)) : personalConfigPath(env)
  if (!existsSync(path)) return { error: `There is no ${source === 'repo' ? 'project config (config.json, or the older .claude/quality-code.json)' : `personal config (${path})`}. Run /quality-code:setup, or use ${source === 'repo' ? '--personal' : '--project'}.` }
  try { return { source, path, config: JSON.parse(readFileSync(path, 'utf8')) } } catch (e) { return { error: `${path} is not valid JSON (${e.message})` } }
}

function parseArgs(argv) {
  const a = { _: [], yes: false, scope: null, errors: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--') { a._.push(...argv.slice(i + 1)); break }
    if (t === '--yes') a.yes = true
    else if (t === '--personal' || t === '--project') {
      const scope = t === '--personal' ? 'personal' : 'repo'
      if (a.scope && a.scope !== scope) a.errors.push('use only one of --personal and --project')
      a.scope = scope
    } else if (t.startsWith('--')) a.errors.push(`unknown arg: ${t}`)
    else a._.push(t)
  }
  return a
}

/** The settable keys, one row each: key, what it takes, example. Read from KEYS, so it never drifts. */
export function keyRows() {
  return Object.entries(KEYS).map(([key, spec]) => ({
    key,
    takes: spec.type === T.configs ? 'match=config pairs, comma separated' : spec.type === T.enum ? spec.choices.join(' | ') : spec.type === T.list ? 'list, comma separated' : spec.type === T.bool ? 'true | false' : spec.type === T.int ? 'whole number' : spec.type === T.url ? 'address' : 'text',
    optional: Boolean(spec.optional), project: Boolean(spec.project), example: EXAMPLES[key] ?? '',
  }))
}
/** `config keys`: prints a row per key and a CONFIG_KEYS_JSON line. Needs no config. */
export function configKeys(io = { out: printLine }) {
  const rows = keyRows()
  for (const r of rows) io.out(`${r.key} | ${r.takes} | ${r.example}${r.optional ? ' | none removes it' : ''}${r.project ? ' | project only' : ''}`)
  io.out(tag('CONFIG_KEYS', rows))
  return 0
}

const USAGE = 'usage: ticket.mjs config set <key> <value> [--yes] [--personal|--project] | config get [<key>] [--personal|--project] (no key: the whole config, secrets left out)'

/** Runs `config set|get` (argv starts at set|get). Returns the exit code: 0 ok or a preview, 2 an error with nothing written. */
export function configSetGet(argv, env = process.env, cwd = process.cwd(), io = { out: printLine, err: printError }) {
  const { out, err } = io
  const fail = m => { err(m); return 2 }
  const [sub, ...rest] = argv
  const a = parseArgs(rest)
  if (a.errors.length) return fail(`${a.errors[0]}\n${USAGE}`)
  const [key, ...vals] = a._
  if (!['get', 'set'].includes(sub) || (sub === 'set' && !key) || vals.length !== (sub === 'get' ? 0 : 1)) return fail(USAGE)
  const value = vals[0]

  if (sub === 'get' && !key) {
    const t = target(projectRoot(env, cwd), env, a.scope)
    if (t.error) return fail(t.error)
    const shown = withoutSecrets(t.config)
    out(JSON.stringify(shown, null, 2))
    out(tag('CONFIG_GET', { key: null, value: shown, set: true, source: t.source }))
    return 0
  }
  const bad = refusal(key, value)
  if (bad) return fail(bad)
  // A group of keys ("runners", "jira"): read it whole.
  const group = sub === 'get' && !KEYS[key] && Object.keys(KEYS).some(k => k.startsWith(`${key}.`)) ? key : null
  const spec = group ? { type: T.text, group: true } : KEYS[key]
  if (!spec) return fail(`${key}: unknown key. Settable keys: ${Object.keys(KEYS).join(', ')}. Other settings: /quality-code:setup advanced.`)

  const root = projectRoot(env, cwd)
  const t = target(root, env, a.scope)
  if (t.error) return fail(t.error)
  if (spec.project && t.source === 'personal') return fail(`${key}: a personal config has no project tests or folders: set it in the repo's config (--project).`)

  const placeOpts = { source: t.source, ticketsDir: typeof t.config.ticketsDir === 'string' ? t.config.ticketsDir : undefined, personalDefault: personalTicketsDir(env) }
  const old = spec.file ? placeOf(root, t.source, env) : getPath(t.config, key)

  if (sub === 'get') {
    const dflt = key === 'ticketsDir' && old === undefined ? ` (default ${t.source === 'personal' ? personalTicketsDir(env) : DEFAULTS.ticketsDir})` : ''
    out(`${key} = ${show(old)}${dflt} (${t.source}: ${t.path})`)
    out(tag('CONFIG_GET', { key, value: old ?? null, set: old !== undefined, source: t.source }))
    return 0
  }

  const parsed = parseValue(spec, key, value)
  if (parsed.error) return fail(parsed.error)
  const next = parsed.clear ? undefined : parsed.value
  const report = (status, extra = {}) => out(tag('CONFIG_SET', { status, key, old: old ?? null, new: next ?? null, source: t.source, ...extra }))
  const finish = (line, writer) => {
    out(`${key}: ${show(old)} -> ${show(next)}`)
    if (JSON.stringify(old) === JSON.stringify(next)) { out('Nothing to change: already set.'); report('same'); return 0 }
    if (!a.yes) { out('Not changed yet. Run again with --yes to apply.'); report('preview'); return 0 }
    const r = writer()
    if (r?.error) return fail(`${key}: not saved, nothing was written.\n${r.error}`)
    out(`ok: ${line(r)}`)
    report('written', r?.extra)
    return 0
  }

  if (spec.file) {
    if (!placesFor(t.source).includes(next)) return fail(`place: a personal config keeps its files on this machine ("local") or in the chat ("chat"), not in a repo.`)
    return finish(r => `files and logs are now kept ${next}${r.extra.moved ? `; moved ${plural(r.extra.moved, 'file')} from the old place` : ''} (${placeDirs(root, placeOpts, next, env).ticketsDir}/).`, () => ({ extra: { moved: pickPlace(root, placeOpts, next, env).moved } }))
  }

  const candidate = setPath(t.config, key, next)
  const v = validateConfig(candidate, { allowAbsoluteTicketsDir: t.source === 'personal' })
  if (!v.ok) return fail(`${key}: not saved, nothing was written.\n${v.errors.join('\n')}`)
  return finish(() => `${key} set to ${show(next)}.`, () => {
    const w = t.source === 'repo' ? write(configHome(root), candidate, { configFile: t.path }) : writePersonal(candidate, env)
    return w.ok ? {} : { error: w.errors.join('\n') }
  })
}
