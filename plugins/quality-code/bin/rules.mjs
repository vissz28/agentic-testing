// Prints the Central Context testing rules for a side, then a RULES_JSON: line; --key also saves them to rules.json.
// Exits 0 even when the hub is down: rules inform, they never block a run. 2 on usage error.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isProjectKey } from '../lib/config/keys.mjs'
import { loadConfig, projectRoot } from '../lib/config/config.mjs'
import { formatRules, readRules, rulesRecord } from '../lib/base/rules.mjs'
import { SIDES, stackOf } from '../lib/stacks/stack.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'

const USAGE = 'usage: rules.mjs [--side frontend|backend|fullstack] [--key KEY]'

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { fetchImpl, stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  let side = null
  let key = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--side' && SIDES.includes(argv[i + 1])) side = argv[++i]
    else if (argv[i] === '--key' && argv[i + 1]) key = argv[++i]
    else { printError(`${argv[i] === '--side' ? `--side must be ${SIDES.join(', ')}` : `unknown option ${argv[i]}`}. ${USAGE}`); return 2 }
  }
  const cfg = loadConfig(projectRoot(env, cwd), env)
  const config = cfg.ok ? cfg.config : null
  const root = projectRoot(env, cwd)
  if (key && !(config && isProjectKey(config, key))) { printError(`--key ${key} is not a ticket key of this project. ${USAGE}`); return 2 }
  const r = await readRules({ side: side ?? stackOf(config) ?? 'fullstack', config, root, env, fetchImpl })
  if (key) {
    const f = resolve(root, config.ticketsDir, key, 'rules.json')
    try { mkdirSync(resolve(f, '..'), { recursive: true }); writeFileSync(f, `${JSON.stringify(rulesRecord(r))}\n`) } catch {}
  }
  printLine(`${formatRules(r)}\n${tag('RULES', r)}`)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = await main()
