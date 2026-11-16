// Entry-point and output helpers for the scripts in bin/.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** True when run directly, symlinks resolved (unresolved, a script would skip main() and exit 0). */
export function isMain(metaUrl, started = process.argv[1]) {
  if (!started) return false
  try { return realpathSync(started) === realpathSync(fileURLToPath(metaUrl)) } catch { return false }
}

/** NAME_JSON:{...}, the line prompts parse a script's result from. */
export const tag = (name, data) => `${name}_JSON:${JSON.stringify(data)}`

/** Wraps a write function to print one line per call; tests pass their own stdout/stderr. */
export const lineWriter = write => text => write(`${text}\n`)

export const printLine = lineWriter(text => process.stdout.write(text))

export const printError = lineWriter(text => process.stderr.write(text))

const PLUGIN = new URL('../../', import.meta.url).href

/** "check <name> crashed: <msg>" plus the plugin file:line it came from, so a report can be traced. */
export function crashMessage(name, e) {
  const head = `check ${name} crashed: ${String(e?.message ?? e).split('\n')[0]}`
  const stack = String(e?.cause?.stack ?? e?.stack ?? '')
  const at = stack.split('\n').filter(l => /^\s+at /.test(l)).map(l => l.split(PLUGIN)[1]?.match(/^[^\s)]+:\d+:\d+/)?.[0]).find(Boolean)
  return at ? `${head}\n  at ${at}` : head
}
