#!/usr/bin/env node
// node bin/routes.mjs check </path> | list    (read-only; looks at the router the code declares)
// check: exit 0 found or likely, 1 not found (with the closest routes), 3 no router found to check against, 2 usage error.
import { pathToFileURL } from 'node:url'
import { projectRoot } from '../lib/base/config.mjs'
import { checkRoute, declaredRoutes } from '../lib/base/routes.mjs'

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const [cmd, route] = argv
  if (cmd === 'list' && argv.length === 1) {
    const f = declaredRoutes(projectRoot(env, cwd))
    const all = [...new Set([...f.declared, ...f.fileBased])].sort()
    stdout(`${all.length ? all.join('\n') : 'No routes found in the code.'}\n`)
    return 0
  }
  if (cmd !== 'check' || !route || argv.length !== 2 || !route.startsWith('/') || /[\r\n]/.test(route)) {
    stderr('usage: routes.mjs check </path> | routes.mjs list (the path starts with /, like /orders)\n')
    return 2
  }
  const r = checkRoute(projectRoot(env, cwd), route)
  const line = {
    found: `ok: ${r.route} is a route of the app (${r.matches.slice(0, 3).join(', ')}).`,
    likely: `ok: ${r.route} fits the app's nested routes (every part of it is a declared route piece).`,
    unknown: `no router found in the code, so ${r.route} cannot be checked. It is used as it is.`,
    not_found: `${r.route} is not a route the app declares.${r.suggestions.length ? ` Closest: ${r.suggestions.join(', ')}.` : ''}`,
  }[r.status]
  stdout(`${line}\nROUTE_JSON:${JSON.stringify(r)}\n`)
  return r.status === 'not_found' ? 1 : r.status === 'unknown' ? 3 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main()
