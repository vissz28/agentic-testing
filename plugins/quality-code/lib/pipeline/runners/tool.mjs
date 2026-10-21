// The project's own copy of a tool, found the way Node finds a package (so in a monorepo's hoisted
// node_modules too) and run with this Node: a .bin shell shim does not start on Windows.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** The first <folder>/<rel> that exists, from root up to the filesystem root; or null. */
export function findUp(root, rel) {
  for (let d = resolve(root); ; d = dirname(d)) {
    if (existsSync(join(d, rel))) return join(d, rel)
    if (dirname(d) === d) return null
  }
}

/** The script of the bin `name` of the first package installed for root, or null when none is. */
export function toolScript(root, packages, name) {
  for (const pkg of packages) {
    const manifest = findUp(root, join('node_modules', pkg, 'package.json'))
    if (!manifest) continue
    try {
      const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin
      const rel = typeof bin === 'string' ? bin : bin?.[name]
      if (rel) return join(dirname(manifest), rel)
    } catch {}
  }
  return null
}

/** Kills a tool with its process group (its workers too); a plain kill where groups do not exist. */
export function kill(child) {
  try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

// The tools running now, with the temp files each was given: what a killed run must undo.
const live = new Set()

/** Registers a started tool and its temp files; call the returned function once the tool is done. */
export function track(child, files) {
  const entry = { child, files }
  live.add(entry)
  return () => live.delete(entry)
}

/** On SIGINT or SIGTERM: kills every running tool and removes its temp files. */
export function stopAll() {
  for (const { child, files } of live) {
    kill(child)
    for (const f of files) try { rmSync(f, { recursive: true, force: true }) } catch {}
  }
  live.clear()
}
