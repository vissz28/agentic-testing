// What a script in bin/ needs between itself and whoever started it: how it starts, what it reads, how it reports. Imports only Node's own modules.
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * True when this module is the script Node was started with, also when it was reached through a
 * symlinked folder. Without resolving the link a started script takes itself for an imported one,
 * does nothing and exits 0, which a caller reads as success.
 * @param {string} metaUrl the caller's import.meta.url
 * @param {string | undefined} [started] the path Node was started with
 * @returns {boolean}
 */
export function isMain(metaUrl, started = process.argv[1]) {
  if (!started) return false
  try { return realpathSync(started) === realpathSync(fileURLToPath(metaUrl)) } catch { return false }
}

/**
 * The line a prompt reads a script's result from: NAME_JSON: and the data as one line of JSON.
 * @param {string} name the tag's name, like "TICKET_EVAL"
 * @param {unknown} data
 * @returns {string}
 */
export const tag = (name, data) => `${name}_JSON:${JSON.stringify(data)}`

/**
 * Wraps a write function so each call prints one line: the text, then "\n". A script whose tests pass
 * their own stdout or stderr builds its printLine and printError from those with it.
 * @param {(text: string) => unknown} write
 * @returns {(text: unknown) => unknown} what write returns
 */
export const lineWriter = write => text => write(`${text}\n`)

/** Prints one line on stdout. */
export const printLine = lineWriter(text => process.stdout.write(text))

/** Prints one line on stderr. */
export const printError = lineWriter(text => process.stderr.write(text))

const PLUGIN = new URL('../../', import.meta.url).href

/**
 * What a crashed check prints: "check <name> crashed: <first line>", then the plugin file and line the
 * error came from (from the original error a step kept as cause), so a report of it can be found.
 * @param {string} name the check or step
 * @param {unknown} e what was thrown
 * @returns {string}
 */
export function crashMessage(name, e) {
  const head = `check ${name} crashed: ${String(e?.message ?? e).split('\n')[0]}`
  const stack = String(e?.cause?.stack ?? e?.stack ?? '')
  const at = stack.split('\n').filter(l => /^\s+at /.test(l)).map(l => l.split(PLUGIN)[1]?.match(/^[^\s)]+:\d+:\d+/)?.[0]).find(Boolean)
  return at ? `${head}\n  at ${at}` : head
}
