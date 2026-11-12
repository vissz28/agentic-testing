#!/usr/bin/env node
// Entry point for the "where did I stop" cache the commands use between steps and sessions.
// node bin/progress.mjs get <command> [--key KEY]
// node bin/progress.mjs set <command> --step N --label "text" [--key KEY] [--data '{"site":"…"}']
// node bin/progress.mjs clear <command> [--key KEY]
// node bin/progress.mjs list
// node bin/progress.mjs context get <fact> [--head | --current TOKEN]
// node bin/progress.mjs context set <fact> --data JSON --source ttl:MS|hash:TOKEN|head|ticket:UPDATED|none
// node bin/progress.mjs context file <path> [--role target|spec|config] | changed <path> | clear [<fact>] | list
// Local files only, never sent anywhere, never in the repo. Exit 0 ok, 2 usage or refused input.
import { execFileSync } from 'node:child_process'
import { projectRoot } from '../lib/base/config.mjs'
import { clearContext, fileChanged, getFact, listContext, recordFile, setFact } from '../lib/base/context.mjs'
import { clearProgress, getProgress, listProgress, setProgress } from '../lib/base/progress.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'

const USAGE = 'usage: progress.mjs get <command> [--key KEY] | set <command> --step N --label "text" [--key KEY] [--data JSON] | clear <command> [--key KEY] | list | context get|set|file|changed|clear|list …'

function parse(argv) {
  const a = { _: [], key: null, step: null, label: '', data: null, source: null, current: null, role: 'file', head: false }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--head') a.head = true
    else if (['--key', '--step', '--label', '--data', '--source', '--current', '--role'].includes(x)) {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${x} needs a value`)
      a[x.slice(2)] = v
    } else if (x.startsWith('--')) throw new Error(`unknown option ${x}`)
    else a._.push(x)
  }
  return a
}

// A file it cannot trust (a broken config or saved step) stops it with the file's name, as qa.mjs does.
export async function main(argv = process.argv.slice(2), io = {}) {
  try { return await handle(argv, io) } catch (e) { lineWriter(io.stderr ?? (s => process.stderr.write(s)))(`progress.mjs: ${e?.message ?? e}`); return 2 }
}

async function handle(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  let a
  try { a = parse(argv) } catch (e) { printError(`${e.message}\n${USAGE}`); return 2 }
  const [sub, command] = a._
  const root = projectRoot(env, cwd)
  const fail = reason => { printError(reason); return 2 }
  if (sub === 'context') return context(a, root, env, stdout, fail)
  if (sub === 'list' && a._.length === 1) {
    const items = listProgress(root, env)
    printLine(items.length ? items.map(i => `${i.command}${i.key ? ` ${i.key}` : ''}: step ${i.step}${i.label ? `, ${i.label}` : ''} (${i.ageMinutes} min ago)`).join('\n') : 'Nothing saved for this project.')
    printLine(tag('PROGRESS', { items }))
    return 0
  }
  if (!command || a._.length !== 2) return fail(USAGE)
  if (sub === 'get') {
    const r = getProgress(root, command, a.key, env)
    if (!r.ok) return fail(r.reason)
    printLine(r.found ? `Saved: ${command}${a.key ? ` ${a.key}` : ''} stopped at step ${r.step}${r.label ? ` (${r.label})` : ''}, ${r.ageMinutes} min ago.` : r.expired ? 'The saved stop is older than 7 days and is ignored.' : 'Nothing saved.')
    printLine(tag('PROGRESS', r))
    return 0
  }
  if (sub === 'set') {
    if (a.step === null || !/^\d+$/.test(a.step)) return fail('set needs --step N (a whole number)')
    let data = {}
    if (a.data !== null) { try { data = JSON.parse(a.data) } catch { return fail('--data is not valid JSON') } }
    const r = setProgress(root, command, { key: a.key, step: Number(a.step), label: a.label, data }, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: ${command}${a.key ? ` ${a.key}` : ''} saved at step ${r.step}.\n${tag('PROGRESS', r)}`)
    return 0
  }
  if (sub === 'clear') {
    const r = clearProgress(root, command, a.key, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: ${r.cleared ? 'forgotten' : 'nothing was saved'}.`)
    return 0
  }
  return fail(USAGE)
}

// The git commit this project is at: the token a `head` fact is compared with.
const gitHead = root => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

function parseSource(text) {
  const [kind, ...rest] = String(text ?? '').split(':')
  const value = rest.join(':')
  if (kind === 'ttl') return { kind, value: Number(value) }
  if (kind === 'none' || kind === 'head') return { kind, value: kind === 'head' ? value : undefined }
  return { kind, value }
}

function context(a, root, env, stdout, fail) {
  const printLine = lineWriter(stdout)
  const [, what, name] = a._
  const json = o => printLine(tag('CONTEXT', o))
  if (what === 'list' && a._.length === 2) {
    const l = listContext(root, env)
    printLine(l.facts.length || l.files.length ? [...l.facts.map(f => `${f.name} (${f.source}, ${f.ageMinutes} min ago)`), ...l.files.map(f => `${f.path} (${f.role})`)].join('\n') : 'Nothing saved for this project.')
    json(l)
    return 0
  }
  if (what === 'clear' && a._.length <= 3) {
    const r = clearContext(root, name ?? null, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: ${r.cleared ? 'forgotten' : 'nothing was saved'}.`)
    return 0
  }
  if (!['get', 'set', 'file', 'changed'].includes(what) || a._.length !== 3) return fail(USAGE)
  if (what === 'get') {
    const r = getFact(root, name, a.head ? gitHead(root) : a.current, env)
    if (!r.ok) return fail(r.reason)
    printLine(!r.found ? `Nothing saved about ${name}.` : r.fresh ? `Reusing ${name} from ${r.ageMinutes} min ago.` : `Read ${name} again: ${r.reason}.`)
    json(r)
    return 0
  }
  if (what === 'set') {
    let value
    try { value = JSON.parse(a.data ?? '') } catch { return fail('--data is not valid JSON') }
    const source = parseSource(a.source)
    if (source.kind === 'head') source.value = gitHead(root) ?? ''
    const r = setFact(root, name, value, source, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: ${name} saved.`)
    return 0
  }
  if (what === 'file') {
    const r = recordFile(root, name, a.role, env)
    if (!r.ok) return fail(r.reason)
    printLine(`ok: ${name} recorded.`)
    json(r)
    return 0
  }
  const r = fileChanged(root, name, env)
  printLine(!r.known ? `${name} was never recorded.` : r.changed ? `${name} changed since it was recorded.` : `${name} is unchanged.`)
  json(r)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
