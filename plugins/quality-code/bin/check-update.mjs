// Entry point for /quality-code:check-update: is a newer version of the plugin out, and what changed?
// node bin/check-update.mjs [--json]
// Reads the running version from this plugin and the one installed on disk (an update waits for /reload-plugins), the latest from the plugin's GitHub repository (raw files,
// else the repository's git tags). Read-only: it installs nothing. Exit 0 ok (up to date or update found),
// 2 usage error, 3 the latest version could not be read.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN_DIR = new URL('..', import.meta.url)
const USAGE = 'usage: check-update.mjs [--json]'
const TIMEOUT_MS = 8000
const MAX_VERSIONS = 6
const MAX_LINES = 5

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** -1, 0 or 1; a version that is not x.y.z sorts before every real one. */
export function compareVersions(a, b) {
  const x = SEMVER.exec(String(a ?? '').trim())
  const y = SEMVER.exec(String(b ?? '').trim())
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] > +y[i] ? 1 : -1
  return 0
}

/** `owner/repo` of a GitHub URL (https, ssh, with or without .git), else null. */
export function githubRepo(url) {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[/#].*)?$/i.exec(String(url ?? '').trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/** The sections of a Keep a Changelog file newer than `installed`, up to `latest`, newest first. */
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

// The bullets of a section: first line of each, markdown emphasis dropped, a few of them.
function summarise(body) {
  const items = []
  for (const line of body.split('\n')) {
    const m = /^- (.+)$/.exec(line)
    if (!m) continue
    items.push(m[1].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`/g, '').trim())
  }
  return { items: items.slice(0, MAX_LINES), more: Math.max(0, items.length - MAX_LINES) }
}

/** The highest version of `name` that Claude Code has installed on disk (null when it cannot be read). */
export function diskVersion(name, env = process.env) {
  try {
    const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    const plugins = JSON.parse(readFileSync(join(dir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}
    const versions = Object.entries(plugins)
      .filter(([k]) => k.startsWith(`${name}@`))
      .flatMap(([, entries]) => entries.map(e => e.version))
      .filter(v => SEMVER.test(v ?? ''))
      .sort(compareVersions)
    return versions.at(-1) ?? null
  } catch { return null }
}

function readInstalled() {
  return JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', PLUGIN_DIR), 'utf8'))
}

async function getText(fetchImpl, url) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'quality-code-check-update' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.text()
}

/** The latest version and its changelog: raw files first, git tags when those cannot be read (a private repository). */
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
  return execFileSync('git', ['ls-remote', '--tags', repository], { encoding: 'utf8', timeout: TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

/** The status of an installed version against the latest one. */
export function statusOf(installed, latest, running = installed) {
  const c = compareVersions(latest, installed)
  if (c > 0) return 'update'
  if (compareVersions(installed, running) > 0) return 'reload'
  return c === 0 ? 'current' : 'ahead'
}

export function formatCard({ name, installed, running = installed, latest, status, via, sections, hiddenVersions }) {
  const lines = ['quality-code update check']
  if (status === 'reload') lines.push(`  Running    ${running}`, `  Installed  ${installed}   (on disk, not loaded yet)`)
  else lines.push(`  Installed  ${installed}`)
  lines.push(`  Latest     ${latest}   (from ${via})`)
  if (status === 'reload') lines.push('', `Version ${installed} is installed. Type /reload-plugins (or open a new session) to use it.`)
  else if (status === 'current') lines.push('', `You have the latest version.`)
  else if (status === 'ahead') lines.push('', `You are ahead of the published version (a local or development copy).`)
  else {
    lines.push('', `A new version is out: ${installed} -> ${latest}.`)
    for (const s of sections) {
      lines.push('', `  ${s.version}${s.date ? `  (${s.date})` : ''}`)
      for (const i of s.lines.items) lines.push(`    - ${i.length > 160 ? `${i.slice(0, 157)}...` : i}`)
      if (s.lines.more) lines.push(`    ... and ${s.lines.more} more`)
    }
    if (hiddenVersions) lines.push('', `  ... and ${hiddenVersions} older version${hiddenVersions === 1 ? '' : 's'}: see the CHANGELOG.`)
    lines.push('', 'To update by hand, type these two commands in Claude Code, one after the other:',
      `  /plugin update ${name}@teamsystem`, '  /reload-plugins')
  }
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s), fetchImpl = fetch, ls = defaultLs, installedManifest = null } = {}) {
  const bad = argv.find(a => a !== '--json')
  if (bad) { stderr(`unknown option ${bad}. ${USAGE}\n`); return 2 }
  const json = argv.includes('--json')
  const manifest = installedManifest ?? readInstalled()
  const name = manifest.name ?? 'quality-code'
  const running = manifest.version
  const onDisk = diskVersion(name, env)
  const installed = onDisk && compareVersions(onDisk, running) > 0 ? onDisk : running
  let latest
  try {
    latest = await fetchLatest({ repository: manifest.repository, name, fetchImpl, ls })
  } catch (e) {
    stdout(`Could not read the latest version: ${e.message}.\nInstalled: ${installed}. Check your connection, or type /plugin to look at the plugin there.\n`)
    return 3
  }
  const status = statusOf(installed, latest.version, running)
  const all = status === 'update' ? newerSections(latest.changelog, installed, latest.version) : []
  const sections = all.slice(0, MAX_VERSIONS)
  const report = { name, installed, running, latest: latest.version, status, via: latest.via, versions: all.map(s => s.version), sections }
  const card = formatCard({ name, installed, running, latest: latest.version, status, via: latest.via, sections, hiddenVersions: all.length - sections.length })
  stdout(json ? `${JSON.stringify(report)}\n` : `${card}\nCHECK_UPDATE_JSON:${JSON.stringify({ installed, running, latest: latest.version, status })}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
