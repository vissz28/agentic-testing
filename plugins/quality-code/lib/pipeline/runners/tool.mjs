// Find the project's tool like Node resolves packages (hoisted too) and run it with this Node: .bin shims fail on Windows.
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readJson } from '../../core/files.mjs'

export function findUp(root, rel) {
  for (let d = resolve(root); ; d = dirname(d)) {
    if (existsSync(join(d, rel))) return join(d, rel)
    if (dirname(d) === d) return null
  }
}

export function toolScript(root, packages, name) {
  for (const pkg of packages) {
    const manifest = findUp(root, join('node_modules', pkg, 'package.json'))
    if (!manifest) continue
    try {
      const bin = readJson(manifest).bin
      const rel = typeof bin === 'string' ? bin : bin?.[name]
      if (rel) return join(dirname(manifest), rel)
    } catch {}
  }
  return null
}

/** Kill the whole process group (workers too); plain kill on Windows. */
export function kill(child) {
  try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
}

// Running tools and their temp files, cleaned up if we're killed.
const live = new Set()

/** Returns an untrack function. */
export function track(child, files) {
  const entry = { child, files }
  live.add(entry)
  return () => live.delete(entry)
}

/** For SIGINT/SIGTERM. */
export function stopAll() {
  for (const { child, files } of live) {
    kill(child)
    for (const f of files) try { rmSync(f, { recursive: true, force: true }) } catch {}
  }
  live.clear()
}
