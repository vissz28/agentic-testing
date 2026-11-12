// What every script in bin/ needs at its start and its end. Imports only Node's own modules.
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
