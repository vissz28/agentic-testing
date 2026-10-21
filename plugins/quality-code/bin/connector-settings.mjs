// Connector settings asked for in the chat: the GitLab address and username or email, and the Jira
// email. They are saved where Claude Code keeps plugin options (pluginConfigs in the user settings
// file). No token is ever handled here: secrets go through the /plugin dialog into the keychain.
//
//   node bin/connector-settings.mjs --gitlab-check <address>
//   node bin/connector-settings.mjs --gitlab-save <address> <username or email>
//   node bin/connector-settings.mjs --jira-save <email>
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The API address (…/api/v4, no trailing /) of a host, a site or an API address; null when unusable. */
export function apiUrlOf(input) {
  const raw = String(input ?? '').trim()
  if (!raw || /\s/.test(raw)) return null
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (u.username || u.password || u.search || u.hash) return null
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.has(u.hostname))) return null
  if (!u.hostname.includes('.') && !LOCAL.has(u.hostname)) return null
  const path = u.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/, '')
  return `${u.protocol}//${u.host}${path}/api/v4`
}

/** A GitLab username (an optional leading @) or an email. A token-looking value is refused. */
export function validUser(value) {
  const v = String(value ?? '').trim()
  if (!v || v.length > 255 || /\s/.test(v) || /^gl[a-z]+-/i.test(v)) return false
  return /^@?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || /^[^@]+@[^@]+\.[^@]+$/.test(v)
}

/** GitLab answers /version with 401 without a token and 200 with one: either means it is a GitLab. */
export async function checkGitlab(apiUrl, { timeoutMs = 10000 } = {}) {
  try {
    const r = await fetch(`${apiUrl}/version`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    if (r.status === 401 || r.status === 200) return { ok: true, apiUrl }
    return { ok: false, apiUrl, reason: `${apiUrl} answered ${r.status}: not a GitLab API address` }
  } catch (e) {
    return { ok: false, apiUrl, reason: `could not reach ${apiUrl}: ${e.cause?.code ?? e.message}` }
  }
}

const userSettings = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')

/** An email address, never a token. */
export function validEmail(value) {
  const v = String(value ?? '').trim()
  return v.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** Merges `options` into pluginConfigs[<quality-code id>].options; nothing else in the file changes. */
export function saveOptions({ file = userSettings(), options }) {
  let data = {}
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { ok: false, reason: `could not read ${file}: ${e.message}` } }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: `could not read ${file}: not a settings object` }
  }
  const plugin = Object.keys(data.enabledPlugins ?? {}).find(k => k.startsWith('quality-code@')) ?? 'quality-code@quality-code'
  const configs = data.pluginConfigs && typeof data.pluginConfigs === 'object' ? data.pluginConfigs : {}
  const entry = configs[plugin] && typeof configs[plugin] === 'object' ? configs[plugin] : {}
  data.pluginConfigs = { ...configs, [plugin]: { ...entry, options: { ...(entry.options ?? {}), ...options } } }
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.qc-${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, file)
  return { ok: true, plugin, options }
}

/** Saves gitlab_api_url and gitlab_username. */
export function saveGitlabSettings({ file, url, user }) {
  const apiUrl = apiUrlOf(url)
  if (!apiUrl) return { ok: false, reason: `not a GitLab address: ${JSON.stringify(String(url ?? ''))} (use https://, for example gitlab.example.com)` }
  if (!validUser(user)) return { ok: false, reason: 'give your GitLab username or email (never a token)' }
  return saveOptions({ file, options: { gitlab_api_url: apiUrl, gitlab_username: String(user).trim().replace(/^@/, '') } })
}

/** Saves jira_email. */
export function saveJiraSettings({ file, email }) {
  if (!validEmail(email)) return { ok: false, reason: 'give the email of your Atlassian account (never a token)' }
  return saveOptions({ file, options: { jira_email: String(email).trim().toLowerCase() } })
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, a, b] = argv
  const out = r => { console.log(`CONNECTOR_SETTINGS_JSON:${JSON.stringify(r)}`); return r.ok ? 0 : 1 }
  if (cmd === '--gitlab-check' && a) {
    const apiUrl = apiUrlOf(a)
    if (!apiUrl) return out({ ok: false, reason: `not a GitLab address: ${JSON.stringify(a)}` })
    return out(await checkGitlab(apiUrl))
  }
  if (cmd === '--gitlab-save' && a && b) return out(saveGitlabSettings({ url: a, user: b }))
  if (cmd === '--jira-save' && a && !b) return out(saveJiraSettings({ email: a }))
  console.error('usage: connector-settings.mjs --gitlab-check <address> | --gitlab-save <address> <username or email> | --jira-save <email>')
  return 2
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
