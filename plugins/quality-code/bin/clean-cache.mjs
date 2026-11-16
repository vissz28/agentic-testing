#!/usr/bin/env node
// /clean --cache: deletes only <Claude folder>/quality-code/progress/, never config, tickets or specs.
import { projectRoot } from '../lib/config/config.mjs'
import { deleteCache, human, listCache, strip } from '../lib/state/cache-clean.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'
import { plural } from '../lib/core/text.mjs'

const USAGE = 'usage: clean-cache.mjs list [--all] | delete [--all]'

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const all = argv.includes('--all')
  const [sub, ...extra] = argv.filter(a => a !== '--all')
  if (!['list', 'delete'].includes(sub) || extra.length) { printError(USAGE); return 2 }
  const root = projectRoot(env, cwd)
  const scope = all ? 'every project' : 'this project'
  if (sub === 'list') {
    const r = listCache(root, { all, env })
    stdout(r.files
      ? `Cache to delete (${scope}): ${plural(r.files, 'file')}, ${human(r.bytes)}${all ? ` in ${plural(r.projects.length, 'project folder')}` : ''}.\nFolder: ${r.dir}\n`
      : `Nothing to delete for ${scope}: the cache is empty.\n`)
    if (all) for (const p of r.projects) printLine(`- ${p.name}: ${plural(p.files, 'file')}, ${human(p.bytes)}`)
    printLine(tag('CACHE', strip(r)))
    return 0
  }
  const r = deleteCache(root, { all, env })
  stdout(r.deleted ? `Deleted ${plural(r.deleted, 'cache file')} (${human(r.bytes)}) for ${scope}.\n` : `Nothing deleted for ${scope}: the cache was empty.\n`)
  printLine(tag('CACHE', r))
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
