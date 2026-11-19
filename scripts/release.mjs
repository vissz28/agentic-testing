#!/usr/bin/env node
// One release, the same way each time (docs/BRANCH_FLOW.md): bump on dev, tag on main. Never commits, never pushes.
//   node scripts/release.mjs bump X.Y.Z   on dev: the version in the three manifests, Unreleased becomes [X.Y.Z] - today
//   node scripts/release.mjs tag          on main, once the release commit is there: checks, then the tag, locally
//   node scripts/release.mjs check        the three manifests and the newest changelog section agree
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PLUGIN = 'plugins/quality-code'
export const MANIFESTS = [`${PLUGIN}/.claude-plugin/plugin.json`, `${PLUGIN}/.plugin/plugin.json`, `${PLUGIN}/mcp-server/pyproject.toml`]
const VERSION_IN = { json: /("version"\s*:\s*")([^"]+)(")/, toml: /^(version\s*=\s*")([^"]+)(")/m }
const SEMVER = /^\d+\.\d+\.\d+$/
export const tagOf = v => `quality-code--v${v}`

const versionIn = (path, text) => VERSION_IN[path.endsWith('.toml') ? 'toml' : 'json'].exec(text)?.[2] ?? null
const newer = (a, b) => { const [x, y] = [a, b].map(v => v.split('.').map(Number)); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false }

/** The notes under ## [Unreleased], trimmed ('' when none), and the newest released version. */
export function changelogState(text) {
  const un = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m.exec(text)
  const released = /^## \[(\d+\.\d+\.\d+)\]/m.exec(text)?.[1] ?? null
  return { unreleased: un ? un[1].trim() : null, released }
}

/** Problems with the release files in root; [] when the manifests and the newest changelog section agree. */
export function check(root = ROOT) {
  const read = p => readFileSync(join(root, p), 'utf8')
  const versions = MANIFESTS.map(p => [p, versionIn(p, read(p))])
  const errors = versions.filter(([, v]) => !v || !SEMVER.test(v)).map(([p]) => `${p}: no X.Y.Z version`)
  const distinct = [...new Set(versions.map(([, v]) => v))]
  if (distinct.length > 1) errors.push(`the manifests disagree: ${versions.map(([p, v]) => `${p} ${v}`).join(', ')}`)
  const { released } = changelogState(read('CHANGELOG.md'))
  if (distinct.length === 1 && released !== distinct[0]) errors.push(`CHANGELOG.md: the newest section is ${released ?? 'missing'}, the manifests say ${distinct[0]}`)
  return errors
}

/** Writes version into the three manifests and turns Unreleased into its section. Returns the errors, [] when done. */
export function bump(version, { root = ROOT, today = new Date().toISOString().slice(0, 10), tagExists = () => false } = {}) {
  const read = p => readFileSync(join(root, p), 'utf8')
  if (!SEMVER.test(String(version))) return [`usage: release.mjs bump X.Y.Z (got ${JSON.stringify(version)})`]
  const current = versionIn(MANIFESTS[0], read(MANIFESTS[0]))
  if (!newer(version, current)) return [`${version} is not newer than ${current}`]
  if (tagExists(tagOf(version))) return [`${tagOf(version)} exists already: pick the next version`]
  const changelog = read('CHANGELOG.md')
  const { unreleased } = changelogState(changelog)
  if (unreleased === null) return ['CHANGELOG.md has no ## [Unreleased] section']
  if (!unreleased) return ['CHANGELOG.md: nothing under ## [Unreleased]; write what changed first']
  for (const p of MANIFESTS) {
    const re = VERSION_IN[p.endsWith('.toml') ? 'toml' : 'json']
    writeFileSync(join(root, p), read(p).replace(re, `$1${version}$3`))
  }
  writeFileSync(join(root, 'CHANGELOG.md'), changelog.replace(/^## \[Unreleased\]\s*\n/m, `## [Unreleased]\n\n## [${version}] - ${today}\n\n`))
  return []
}

const git = (args, root = ROOT) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (args, root) => { try { return git(args, root) } catch { return null } }
/** Locally, or on origin when it can be reached; an unreachable origin counts as "not known there". */
const tagExistsFn = root => tag => Boolean(tryGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], root)) || Boolean(tryGit(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], root))

function main(argv) {
  const [cmd, arg] = argv
  if (cmd === 'check') {
    const errors = check()
    errors.forEach(e => console.error(e))
    if (!errors.length) console.log(`ok: ${versionIn(MANIFESTS[0], readFileSync(join(ROOT, MANIFESTS[0]), 'utf8'))} in the three manifests and the changelog`)
    return errors.length ? 1 : 0
  }
  if (cmd === 'bump') {
    const errors = bump(arg, { tagExists: tagExistsFn(ROOT) })
    if (errors.length) { errors.forEach(e => console.error(e)); return 1 }
    console.log(`ok: ${arg} in ${MANIFESTS.join(', ')} and CHANGELOG.md. Read the diff, then commit it on dev: git commit -am "chore: release ${arg}"`)
    return 0
  }
  if (cmd === 'tag') {
    const errors = check()
    const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (branch !== 'main') errors.push(`tag runs on main (this is ${branch}): the tag goes on the commit that reaches main`)
    if (tryGit(['status', '--porcelain'])) errors.push('the working tree has changes: commit or stash them first')
    const head = tryGit(['rev-parse', 'HEAD']), remote = tryGit(['rev-parse', 'origin/main'])
    if (head && remote && head !== remote) errors.push('main is not the same as origin/main: pull or push first, so the tag names a published commit')
    const version = versionIn(MANIFESTS[0], readFileSync(join(ROOT, MANIFESTS[0]), 'utf8'))
    if (tagExistsFn(ROOT)(tagOf(version))) errors.push(`${tagOf(version)} exists already`)
    if (errors.length) { errors.forEach(e => console.error(e)); return 1 }
    git(['tag', '-a', tagOf(version), '-m', `quality-code ${version}`])
    console.log(`ok: tagged ${tagOf(version)} on ${head.slice(0, 7)}, locally. Push it: git push origin ${tagOf(version)} && git push ghe ${tagOf(version)}`)
    return 0
  }
  console.error('usage: release.mjs bump X.Y.Z | tag | check')
  return 2
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
