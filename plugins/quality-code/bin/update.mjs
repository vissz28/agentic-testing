// Compares running/installed plugin versions with the latest on GitHub. Read-only, installs nothing.
// Exit 0 ok, 2 usage error, 3 latest version unreadable.
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'
import { readJson } from '../lib/core/files.mjs'
import { git } from '../lib/core/git.mjs'
import { plural, toForwardSlashes } from '../lib/core/text.mjs'
import { noTrailingSlash } from '../lib/core/paths.mjs'

const PLUGIN_DIR = new URL('..', import.meta.url)
const USAGE = 'usage: update.mjs [--json | --old | --remove-old]'
const TIMEOUT_MS = 8000
const MAX_VERSIONS = 6
const MAX_LINES = 5

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

// Non-x.y.z versions sort before every real one.
export function compareVersions(a, b) {
  const x = SEMVER.exec(String(a ?? '').trim())
  const y = SEMVER.exec(String(b ?? '').trim())
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] > +y[i] ? 1 : -1
  return 0
}

// https or ssh, with or without .git.
export function githubRepo(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/i.exec(String(url ?? '').trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/** Keep a Changelog sections in (installed, latest], newest first. */
export function newerSections(changelog, installed, latest) {
  const out = []
  const parts = String(changelog ?? '').split(/^## \[/m).slice(1)
  for (const part of parts) {
    const m = /^(\d+\.\d+\.\d+)\](?: - (\S+))?[^\n]*\n([\s\S]*)$/.exec(part)
    if (!m) continue
    const [, version, date, body] = m
    if (compareVersions(version, installed) <= 0 || compareVersions(version, latest) > 0) continue
    out.push({ version, date: date ?? null, lines: summarise(body) })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

function summarise(body) {
  const items = []
  for (const line of body.split('\n')) {
    const m = /^- (.+)$/.exec(line)
    if (!m) continue
    items.push(m[1].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`/g, '').trim())
  }
  return { items: items.slice(0, MAX_LINES), more: Math.max(0, items.length - MAX_LINES) }
}

function installedPlugins(env) {
  try {
    const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    return readJson(join(dir, 'plugins', 'installed_plugins.json')).plugins ?? {}
  } catch { return {} }
}

// An entry loads here when it is user-wide or belongs to this folder (or one above it); no scope counts as loading.
const slashes = p => noTrailingSlash(toForwardSlashes(p))
const loadsHere = (e, cwd) => {
  if (!e?.projectPath || e.scope === 'user') return true
  const here = slashes(cwd), project = slashes(e.projectPath)
  return here === project || here.startsWith(`${project}/`)
}

/** This plugin's installs that load in cwd, one per marketplace id, at its highest version, highest first. */
export function installsHere(name, cwd, env = process.env) {
  const out = []
  for (const [id, entries] of Object.entries(installedPlugins(env))) {
    if (!id.startsWith(`${name}@`) || !Array.isArray(entries)) continue
    const here = entries.filter(e => loadsHere(e, cwd)).sort((a, b) => compareVersions(b.version, a.version))
    if (here.length) out.push({ id, version: here[0].version ?? null, scope: here[0].scope ?? null })
  }
  // Same version on two marketplaces: keep the one this repo publishes.
  return out.sort((a, b) => compareVersions(b.version, a.version) || (b.id === `${name}@teamsystem`) - (a.id === `${name}@teamsystem`))
}

// The newest install here; falls back to the marketplace this repo publishes.
export function pluginId(name, env = process.env, cwd = process.cwd()) {
  return installsHere(name, cwd, env)[0]?.id ?? Object.keys(installedPlugins(env)).find(k => k.startsWith(`${name}@`)) ?? `${name}@teamsystem`
}

// Installed on disk can be ahead of running until /reload-plugins. Another project's copy does not load here.
export function diskVersion(name, env = process.env, cwd = process.cwd()) {
  try {
    const plugins = installedPlugins(env)
    const versions = Object.entries(plugins)
      .filter(([k]) => k.startsWith(`${name}@`))
      .flatMap(([, entries]) => entries.filter(e => loadsHere(e, cwd)).map(e => e.version))
      .filter(v => SEMVER.test(v ?? ''))
      .sort(compareVersions)
    return versions.at(-1) ?? null
  } catch { return null }
}

/**
 * Old copies of the plugin in the cache: the version folders under <config>/plugins/cache/<marketplace>/<name>
 * that are neither installed nor running. The running one stays (this session reads its files).
 */
export function oldVersions(name, running, env = process.env) {
  const id = pluginId(name, env)
  const dir = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'plugins', 'cache', id.split('@')[1] ?? 'teamsystem', name)
  const keep = new Set([running, diskVersion(name, env)])
  for (const entries of Object.values(installedPlugins(env))) for (const e of entries) keep.add(e.version)
  let found = []
  try { found = existsSync(dir) ? readdirSync(dir).filter(v => SEMVER.test(v) && !keep.has(v)).sort(compareVersions) : [] } catch {}
  return { dir, versions: found }
}

function readInstalled() {
  return readJson(new URL('.claude-plugin/plugin.json', PLUGIN_DIR))
}

async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'quality-code-update' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.text()
}

// Raw files first; git tags when those are unreadable (private repo).
export async function fetchLatest({ repository, name, fetchImpl = fetch, ls = defaultLs }) {
  const repo = githubRepo(repository)
  const errors = []
  if (repo) {
    const base = `https://raw.githubusercontent.com/${repo}/main/plugins/${name}`
    try {
      const manifest = JSON.parse(await getText(fetchImpl, `${base}/.claude-plugin/plugin.json`))
      if (!SEMVER.test(manifest.version ?? '')) throw new Error(`no version in the remote plugin.json`)
      const changelog = await getText(fetchImpl, `${base}/CHANGELOG.md`).catch(() => null)
        ?? await getText(fetchImpl, `https://raw.githubusercontent.com/${repo}/main/CHANGELOG.md`).catch(() => null)
      return { version: manifest.version, changelog, via: 'github' }
    } catch (e) { errors.push(e.message) }
  }
  if (repository) {
    try {
      const tags = ls(repository).split('\n')
        .map(l => new RegExp(`refs/tags/${name}--v(\\d+\\.\\d+\\.\\d+)$`).exec(l)?.[1])
        .filter(Boolean)
        .sort(compareVersions)
      if (!tags.length) throw new Error(`no ${name}--vX.Y.Z tags in ${repository}`)
      return { version: tags.at(-1), changelog: null, via: 'git tags' }
    } catch (e) { errors.push(e.message.split('\n')[0]) }
  }
  throw new Error(errors.length ? errors.join('; ') : 'the plugin has no repository address')
}

function defaultLs(repository) {
  const r = git(undefined, ['ls-remote', '--tags', repository], { timeout: TIMEOUT_MS })
  if (!r.ok) throw new Error(r.error)
  return r.out
}

export function statusOf(installed, latest, running = installed) {
  const c = compareVersions(latest, installed)
  if (c > 0) return 'update'
  if (compareVersions(installed, running) > 0) return 'reload'
  return c === 0 ? 'current' : 'ahead'
}

export function formatCard({ id, installed, running = installed, latest, status, via, sections, hiddenVersions, others = [] }) {
  const lines = ['quality-code update check']
  if (status === 'reload') lines.push(`  Running    ${running}`, `  Installed  ${installed}   (on disk, not loaded yet)`)
  else lines.push(`  Installed  ${installed}`)
  lines.push(`  Latest     ${latest}   (from ${via})`)
  if (others.length) {
    lines.push('', `${plural(others.length + 1, 'copy', 'copies')} of the plugin are installed from different marketplaces. Claude Code can keep loading the old one, even after an update or a new session.`,
      `  Keep       ${id}`)
    for (const o of others) lines.push(`  Old copy   ${o.id} ${o.version ?? '?'}${o.scope ? ` (${o.scope})` : ''}`)
    lines.push('Turn the old copy off:', ...others.map(o => `  claude plugin disable ${o.id}${o.scope ? ` --scope ${o.scope}` : ''}`))
  }
  if (status === 'reload') lines.push('', `This session still runs ${running}. ${installed} is installed and is used from the next session, or after you type /reload-plugins here.`, 'If it still shows the old version after /reload-plugins, close this session and open a new one.')
  else if (status === 'current') lines.push('', `You have the latest version.`)
  else if (status === 'ahead') lines.push('', `You are ahead of the published version (a local or development copy).`)
  else {
    lines.push('', `A new version is out: ${installed} -> ${latest}.`)
    for (const s of sections) {
      lines.push('', `  ${s.version}${s.date ? `  (${s.date})` : ''}`)
      for (const i of s.lines.items) lines.push(`    - ${i.length > 160 ? `${i.slice(0, 157)}...` : i}`)
      if (s.lines.more) lines.push(`    ... and ${s.lines.more} more`)
    }
    if (hiddenVersions) lines.push('', `  ... and ${plural(hiddenVersions, 'older version')}: see the CHANGELOG.`)
    lines.push('', 'To update by hand, type these two commands in Claude Code, one after the other:',
      `  /plugin update ${id}`, '  /reload-plugins')
  }
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s), fetchImpl = fetch, ls = defaultLs, installedManifest = null } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const bad = argv.find(a => !['--json', '--old', '--remove-old'].includes(a))
  if (bad || argv.length > 1) { printError(`unknown option ${bad ?? argv.join(' ')}. ${USAGE}`); return 2 }
  const json = argv.includes('--json')
  const manifest = installedManifest ?? readInstalled()
  const name = manifest.name ?? 'quality-code'
  const running = manifest.version
  if (argv[0] === '--old' || argv[0] === '--remove-old') {
    const { dir, versions } = oldVersions(name, running, env)
    const removed = []
    if (argv[0] === '--remove-old') for (const v of versions) { try { rmSync(join(dir, v), { recursive: true, force: true }); removed.push(v) } catch {} }
    const list = argv[0] === '--old' ? versions : removed
    printLine(list.length
      ? `${argv[0] === '--old' ? 'Old versions' : 'Removed'} (${plural(list.length, 'version')}): ${list.join(', ')}\nKept: ${running} (running now) and the installed one.`
      : 'No old versions to remove.')
    printLine(tag('OLD', { dir, versions: list, removed: argv[0] === '--remove-old' }))
    return 0
  }
  const onDisk = diskVersion(name, env, cwd)
  const installs = installsHere(name, cwd, env)
  const id = installs[0]?.id ?? pluginId(name, env, cwd)
  const others = installs.slice(1).map(({ id, version, scope }) => ({ id, version, scope }))
  const installed = onDisk && compareVersions(onDisk, running) > 0 ? onDisk : running
  let latest
  try {
    latest = await fetchLatest({ repository: manifest.repository, name, fetchImpl, ls })
  } catch (e) {
    printLine(`Could not read the latest version: ${e.message}.\nInstalled: ${installed}. Check your connection, or type /plugin to look at the plugin there.`)
    return 3
  }
  const status = statusOf(installed, latest.version, running)
  const all = status === 'update' ? newerSections(latest.changelog, installed, latest.version) : []
  const sections = all.slice(0, MAX_VERSIONS)
  const old = oldVersions(name, running, env).versions.length
  const report = { name, id, installed, running, latest: latest.version, status, via: latest.via, versions: all.map(s => s.version), sections, others, old }
  const card = formatCard({ id, installed, running, latest: latest.version, status, via: latest.via, sections, hiddenVersions: all.length - sections.length, others })
  stdout(json ? `${JSON.stringify(report)}\n` : `${card}\n${tag('CHECK_UPDATE', { id, installed, running, latest: latest.version, status, old, ...(others.length ? { others } : {}) })}\n`)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
