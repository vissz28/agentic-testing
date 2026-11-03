// Entry point for the Central Context testing rules of a ticket's side, read by /quality-code:spec before the plan.
// node bin/rules.mjs [--side frontend|backend|fullstack]
// Without --side, the project's own side (a fullstack project: fullstack). Prints the rules block, then a
// RULES_JSON: line. Exit 0 whether or not the hub answers (the rules inform, they never stop a run), 2 usage error.
import { pathToFileURL } from 'node:url'
import { loadConfig, projectRoot } from '../lib/base/config.mjs'
import { formatRules, readRules } from '../lib/base/rules.mjs'
import { SIDES, stackOf } from '../lib/base/stack.mjs'

const USAGE = 'usage: rules.mjs [--side frontend|backend|fullstack]'

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { fetchImpl, stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  let side = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--side' && SIDES.includes(argv[i + 1])) side = argv[++i]
    else { stderr(`${argv[i] === '--side' ? `--side must be ${SIDES.join(', ')}` : `unknown option ${argv[i]}`}. ${USAGE}\n`); return 2 }
  }
  const cfg = loadConfig(projectRoot(env, cwd), env)
  const config = cfg.ok ? cfg.config : null
  const root = projectRoot(env, cwd)
  const r = await readRules({ side: side ?? stackOf(config) ?? 'fullstack', config, root, env, fetchImpl })
  stdout(`${formatRules(r)}\nRULES_JSON:${JSON.stringify(r)}\n`)
  return 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
