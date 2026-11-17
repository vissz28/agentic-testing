// Saves non-secret connector settings to pluginConfigs; tokens never pass here (they go via /plugin to the keychain).
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { projectRoot } from '../lib/config/config.mjs'
import { isMain, tag, printLine } from '../lib/core/script-io.mjs'
import { noTrailingSlash } from '../lib/core/paths.mjs'
import { isObject } from '../lib/core/is.mjs'

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Normalizes a host, site or API address to .../api/v4; null when unusable. */
export function apiUrlOf(input) {
  const raw = String(input ?? '').trim()
  if (!raw || /\s/.test(raw)) return null
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (u.username || u.password || u.search || u.hash) return null
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL.has(u.hostname))) return null
  if (!u.hostname.includes('.') && !LOCAL.has(u.hostname)) return null
  const path = noTrailingSlash(u.pathname).replace(/\/api\/v4$/, '')
  return `${u.protocol}//${u.host}${path}/api/v4`
}

/** Username or email; refuses anything that looks like a token. */
export function validUser(value) {
  const v = String(value ?? '').trim()
  if (!v || v.length > 255 || /\s/.test(v) || /^gl[a-z]+-/i.test(v)) return false
  return /^@?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) || /^[^@]+@[^@]+\.[^@]+$/.test(v)
}

/** /version answers 401 without a token, 200 with one: either means GitLab. */
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

export function validEmail(value) {
  const v = String(value ?? '').trim()
  return v.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function readSettings(file) {
  if (!existsSync(file)) return { data: {} }
  let data
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { reason: `could not read ${file}: ${e.message}` } }
  if (!isObject(data)) return { reason: `could not read ${file}: not a settings object` }
  return { data }
}

function writeSettings(file, data) {
  // Write through a symlink (dotfiles repo) instead of replacing it.
  if (existsSync(file)) file = realpathSync(file)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.qc-${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(tmp, file)
}

export function saveOptions({ file = userSettings(), options }) {
  const { data, reason } = readSettings(file)
  if (reason) return { ok: false, reason }
  const plugin = Object.keys(data.enabledPlugins ?? {}).find(k => k.startsWith('quality-code@')) ?? 'quality-code@teamsystem'
  const configs = data.pluginConfigs && typeof data.pluginConfigs === 'object' ? data.pluginConfigs : {}
  const entry = configs[plugin] && typeof configs[plugin] === 'object' ? configs[plugin] : {}
  data.pluginConfigs = { ...configs, [plugin]: { ...entry, options: { ...(entry.options ?? {}), ...options } } }
  writeSettings(file, data)
  return { ok: true, plugin, options }
}

export const REPORT_STYLE = 'quality-code:report'

// Off removes outputStyle only if it is ours. settings.local.json (where /output-style writes) wins over the shared file.
export function outputStyle({ root = projectRoot(), on } = {}) {
  const shared = join(root, '.claude', 'settings.json')
  const read = readSettings(shared)
  if (read.reason) return { ok: false, reason: read.reason }
  if (on !== undefined) {
    if (on) read.data.outputStyle = REPORT_STYLE
    else if (read.data.outputStyle === REPORT_STYLE) delete read.data.outputStyle
    writeSettings(shared, read.data)
  }
  const local = readSettings(join(root, '.claude', 'settings.local.json')).data?.outputStyle ?? null
  const value = read.data.outputStyle ?? null
  const inForce = local ?? value
  return { ok: true, file: shared, shared: value, local, report: inForce === REPORT_STYLE }
}

export function saveGitlabSettings({ file, url, user }) {
  const apiUrl = apiUrlOf(url)
  if (!apiUrl) return { ok: false, reason: `not a GitLab address: ${JSON.stringify(String(url ?? ''))} (use https://, for example gitlab.example.com)` }
  if (!validUser(user)) return { ok: false, reason: 'give your GitLab username or email (never a token)' }
  return saveOptions({ file, options: { gitlab_api_url: apiUrl, gitlab_username: String(user).trim().replace(/^@/, '') } })
}

export function saveJiraSettings({ file, email }) {
  if (!validEmail(email)) return { ok: false, reason: 'give the email of your Atlassian account (never a token)' }
  return saveOptions({ file, options: { jira_email: String(email).trim().toLowerCase() } })
}

export const DEFAULT_XRAY_API = 'https://xray.cloud.getxray.app'

/** Xray Cloud hosts only (global or regional): the API key is sent there. */
export function xrayApiUrlOf(input) {
  const raw = String(input ?? '').trim()
  let u
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || noTrailingSlash(u.pathname)) return null
  return /^(?:[a-z]{2}\.)?xray\.cloud\.getxray\.app$/.test(u.hostname) ? `https://${u.hostname}` : null
}

export function saveXraySettings({ file, url }) {
  const apiUrl = xrayApiUrlOf(url)
  if (!apiUrl) return { ok: false, reason: `not an Xray Cloud address: ${JSON.stringify(String(url ?? ''))} (${DEFAULT_XRAY_API}, or a regional one like https://eu.xray.cloud.getxray.app)` }
  return saveOptions({ file, options: { xray_api_url: apiUrl } })
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, a, b] = argv
  const out = r => { printLine(tag('CONNECTOR_SETTINGS', r)); return r.ok ? 0 : 1 }
  if (cmd === '--gitlab-check' && a) {
    const apiUrl = apiUrlOf(a)
    if (!apiUrl) return out({ ok: false, reason: `not a GitLab address: ${JSON.stringify(a)}` })
    return out(await checkGitlab(apiUrl))
  }
  if (cmd === '--gitlab-save' && a && b) return out(saveGitlabSettings({ url: a, user: b }))
  if (cmd === '--jira-save' && a && !b) return out(saveJiraSettings({ email: a }))
  if (cmd === '--xray-save' && a && !b) return out(saveXraySettings({ url: a }))
  if (cmd === '--style' && !b && (a === undefined || a === 'on' || a === 'off')) return out(outputStyle({ on: a === undefined ? undefined : a === 'on' }))
  console.error('usage: connector-settings.mjs --gitlab-check <address> | --gitlab-save <address> <username or email> | --jira-save <email> | --xray-save <address> | --style [on|off]')
  return 2
}

if (isMain(import.meta.url)) process.exitCode = await main()
