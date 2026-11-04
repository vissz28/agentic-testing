#!/usr/bin/env node
// Entry point for the "where did I stop" cache the commands use between steps and sessions.
// node bin/progress.mjs get <command> [--key KEY]
// node bin/progress.mjs set <command> --step N --label "text" [--key KEY] [--data '{"site":"…"}']
// node bin/progress.mjs clear <command> [--key KEY]
// node bin/progress.mjs list
// Local files only, never sent anywhere, never in the repo. Exit 0 ok, 2 usage or refused input.
import { pathToFileURL } from 'node:url'
import { projectRoot } from '../lib/base/config.mjs'
import { clearProgress, getProgress, listProgress, setProgress } from '../lib/base/progress.mjs'

const USAGE = 'usage: progress.mjs get <command> [--key KEY] | set <command> --step N --label "text" [--key KEY] [--data JSON] | clear <command> [--key KEY] | list'

function parse(argv) {
  const a = { _: [], key: null, step: null, label: '', data: null }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (['--key', '--step', '--label', '--data'].includes(x)) {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${x} needs a value`)
      a[x.slice(2)] = v
    } else if (x.startsWith('--')) throw new Error(`unknown option ${x}`)
    else a._.push(x)
  }
  return a
}

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  let a
  try { a = parse(argv) } catch (e) { stderr(`${e.message}\n${USAGE}\n`); return 2 }
  const [sub, command] = a._
  const root = projectRoot(env, cwd)
  const fail = reason => { stderr(`${reason}\n`); return 2 }
  if (sub === 'list' && a._.length === 1) {
    const items = listProgress(root, env)
    stdout(`${items.length ? items.map(i => `${i.command}${i.key ? ` ${i.key}` : ''}: step ${i.step}${i.label ? `, ${i.label}` : ''} (${i.ageMinutes} min ago)`).join('\n') : 'Nothing saved for this project.'}\n`)
    stdout(`PROGRESS_JSON:${JSON.stringify({ items })}\n`)
    return 0
  }
  if (!command || a._.length !== 2) return fail(USAGE)
  if (sub === 'get') {
    const r = getProgress(root, command, a.key, env)
    if (!r.ok) return fail(r.reason)
    stdout(`${r.found ? `Saved: ${command}${a.key ? ` ${a.key}` : ''} stopped at step ${r.step}${r.label ? ` (${r.label})` : ''}, ${r.ageMinutes} min ago.` : r.expired ? 'The saved stop is older than 7 days and is ignored.' : 'Nothing saved.'}\n`)
    stdout(`PROGRESS_JSON:${JSON.stringify(r)}\n`)
    return 0
  }
  if (sub === 'set') {
    if (a.step === null || !/^\d+$/.test(a.step)) return fail('set needs --step N (a whole number)')
    let data = {}
    if (a.data !== null) { try { data = JSON.parse(a.data) } catch { return fail('--data is not valid JSON') } }
    const r = setProgress(root, command, { key: a.key, step: Number(a.step), label: a.label, data }, env)
    if (!r.ok) return fail(r.reason)
    stdout(`ok: ${command}${a.key ? ` ${a.key}` : ''} saved at step ${r.step}.\nPROGRESS_JSON:${JSON.stringify(r)}\n`)
    return 0
  }
  if (sub === 'clear') {
    const r = clearProgress(root, command, a.key, env)
    if (!r.ok) return fail(r.reason)
    stdout(`ok: ${r.cleared ? 'forgotten' : 'nothing was saved'}.\n`)
    return 0
  }
  return fail(USAGE)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
