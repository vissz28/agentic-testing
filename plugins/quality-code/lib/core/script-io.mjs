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
