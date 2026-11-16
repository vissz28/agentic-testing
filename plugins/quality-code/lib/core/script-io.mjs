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
