#!/usr/bin/env node
// Entry point of /quality-code:clean: lists what Quality Code created in the project and, on the person's pick,
// deletes it. The only code that deletes; it deletes only paths from its own list, inside the project.
// node bin/clean.mjs list [--dry-run]
// node bin/clean.mjs delete --groups setup,output,cache,personal,specs [--specs all|PATH,PATH] --confirmed
// node bin/clean.mjs delete --groups … --dry-run        (lists what would go; deletes nothing)
// It never skips the person's yes: --yes, --ci and the like are refused, and a delete needs --confirmed, which the
// command passes only after the person said yes. Exit 0 ok, 2 usage or refused.
import { projectRoot } from '../lib/base/config.mjs'
import { GROUPS, LABELS, buildList, runClean } from '../lib/base/clean.mjs'
import { isMain } from '../lib/core/command-line.mjs'

const USAGE = 'usage: clean.mjs list [--dry-run] | delete --groups setup,output,cache,personal,specs [--specs all|PATH,PATH] (--confirmed | --dry-run)'
const NO_SKIP = /^(--yes|-y|--ci|--force|-f|--no-confirm|--assume-yes|--non-interactive)$/

function parse(argv) {
  const a = { _: [], dryRun: false, confirmed: false, groups: null, specs: null }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (NO_SKIP.test(x)) throw new Error(`${x} is refused: clean always asks the person first and never skips the question`)
    if (x === '--dry-run') a.dryRun = true
    else if (x === '--confirmed') a.confirmed = true
    else if (x === '--groups' || x === '--specs') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${x} needs a value`)
      a[x.slice(2)] = v.split(',').map(s => s.trim()).filter(Boolean)
    } else if (x.startsWith('-')) throw new Error(`unknown option ${x}`)
    else a._.push(x)
  }
  return a
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const what = i => (i.kind === 'lines' ? `${plural(i.lines.length, 'line')} of ${i.rel}` : `${i.rel}${i.kind === 'dir' ? '/' : ''}${i.kind === 'dir' ? ` (${plural(i.files, 'file')})` : ''}`)

export function card(list, { dryRun = false } = {}) {
  const lines = [`CLEAN: what Quality Code owns in ${list.root}${dryRun ? ' (dry run: nothing is deleted)' : ''}`]
  const tracked = []
  for (const g of list.groups) {
    lines.push('', `${g.label}${g.id === 'specs' ? ' (kept unless you pick them)' : ''}: ${g.items.length ? plural(g.items.length, 'item') : 'nothing'}`)
    for (const i of g.items) {
      lines.push(`  - ${what(i)}${i.marker ? ` [${i.marker}]` : ''}${i.tracked.length ? ' [tracked by git]' : ''}`)
      if (i.tracked.length) tracked.push(...i.tracked)
    }
  }
  for (const k of list.kept) lines.push('', `Kept: ${k.rel} (${k.why})`)
  if (tracked.length) {
    const shown = [...new Set(tracked)]
    lines.push('', `TRACKED BY GIT: ${plural(shown.length, 'file')} on this list ${shown.length === 1 ? 'is' : 'are'} in git (${shown.slice(0, 8).join(', ')}${shown.length > 8 ? `, … and ${shown.length - 8} more` : ''}). Run git status, and commit or stash first if you want to keep them in git history; deleting them does not touch the history.`)
  }
  if (!list.git) lines.push('', 'Git is not available here, so tracked files could not be checked.')
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  let a
  try { a = parse(argv) } catch (e) { stderr(`${e.message}\n${USAGE}\n`); return 2 }
  const root = projectRoot(env, cwd)
  const sub = a._[0]
  if (a._.length !== 1 || !['list', 'delete'].includes(sub)) { stderr(`${USAGE}\n`); return 2 }
  if (sub === 'list') {
    if (a.groups || a.specs || a.confirmed) { stderr(`${USAGE}\n`); return 2 }
    const list = buildList(root, env)
    stdout(`${card(list, { dryRun: a.dryRun })}\n`)
    const json = { root: list.root, git: list.git, dryRun: a.dryRun, kept: list.kept, groups: list.groups.map(g => ({ id: g.id, label: g.label, default: g.id !== 'personal' && g.id !== 'specs', items: g.items.map(({ abs, ...i }) => i) })) }
    stdout(`CLEAN_JSON:${JSON.stringify(json)}\n`)
    return 0
  }
  if (!a.groups?.length) { stderr(`delete needs --groups (${GROUPS.join(', ')})\n`); return 2 }
  if (!a.dryRun && !a.confirmed) { stderr('delete needs --confirmed, which is passed only after the person said yes (or --dry-run to only list)\n'); return 2 }
  const r = runClean(root, { groups: a.groups, specs: a.specs ?? [], dryRun: a.dryRun }, env)
  if (!r.ok) { stderr(`${r.errors.join('\n')}\n`); return 2 }
  const out = [a.dryRun ? 'DRY RUN: would delete' : 'Deleted', ...(r.deleted.length ? r.deleted.map(d => `  - ${LABELS[d.group]}: ${what(d)}${d.tracked.length ? ' [was tracked by git]' : ''}`) : ['  nothing'])]
  out.push('', 'Kept', ...(r.kept.length ? r.kept.map(k => `  - ${k.rel} (${k.why})`) : ['  nothing']))
  stdout(`${out.join('\n')}\n`)
  stdout(`CLEAN_JSON:${JSON.stringify({ dryRun: a.dryRun, deleted: r.deleted, kept: r.kept })}\n`)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
