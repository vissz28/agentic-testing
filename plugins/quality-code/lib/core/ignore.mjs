// A folder that ignores itself: what the plugin keeps there stays out of git without a line in the project's .gitignore.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Makes dir (created when missing) ignore everything in it. An existing .gitignore is left as it is. */
export function ignoreFolder(dir) {
  mkdirSync(dir, { recursive: true })
  try { writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' }) } catch {}
}
