#!/usr/bin/env node
// Entry point for /quality-code:clean --cache. Deletes only the plugin's own local cache (progress, context and
// saved-language files under <Claude folder>/quality-code/progress/), never the config, tickets or specs.
// node bin/clean-cache.mjs list [--all]
// node bin/clean-cache.mjs delete [--all]
// Exit 0 ok, 2 usage. Local only; nothing is sent anywhere.
import { projectRoot } from '../lib/base/config.mjs'
import { deleteCache, human, listCache, strip } from '../lib/base/cache-clean.mjs'
import { isMain } from '../lib/core/script-io.mjs'

const USAGE = 'usage: clean-cache.mjs list [--all] | delete [--all]'
const n = (c, w) => `${c} ${w}${c === 1 ? '' : 's'}`

export async function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const all = argv.includes('--all')
  const [sub, ...extra] = argv.filter(a => a !== '--all')
  if (!['list', 'delete'].includes(sub) || extra.length) { stderr(`${USAGE}\n`); return 2 }
  const root = projectRoot(env, cwd)
  const scope = all ? 'every project' : 'this project'
  if (sub === 'list') {
    const r = listCache(root, { all, env })
    stdout(r.files
      ? `Cache to delete (${scope}): ${n(r.files, 'file')}, ${human(r.bytes)}${all ? ` in ${n(r.projects.length, 'project folder')}` : ''}.\nFolder: ${r.dir}\n`
      : `Nothing to delete for ${scope}: the cache is empty.\n`)
    if (all) for (const p of r.projects) stdout(`- ${p.name}: ${n(p.files, 'file')}, ${human(p.bytes)}\n`)
    stdout(`CACHE_JSON:${JSON.stringify(strip(r))}\n`)
    return 0
  }
  const r = deleteCache(root, { all, env })
  stdout(r.deleted ? `Deleted ${n(r.deleted, 'cache file')} (${human(r.bytes)}) for ${scope}.\n` : `Nothing deleted for ${scope}: the cache was empty.\n`)
  stdout(`CACHE_JSON:${JSON.stringify(r)}\n`)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
