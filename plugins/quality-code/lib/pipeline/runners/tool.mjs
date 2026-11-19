// Find the project's tool like Node resolves packages (hoisted too) and run it with this Node: .bin shims fail on Windows.
import { spawnSync } from 'node:child_process'
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

/**
 * Kill the whole tree (mvn, go and dotnet leave workers and test hosts behind). POSIX: the process group, as tools are
 * spawned detached. Windows has no groups and child.kill ends only the shell or launcher: taskkill /T ends the tree.
 */
export function kill(child, { platform = process.platform, run = spawnSync } = {}) {
  if (platform === 'win32') {
    if (child.pid) {
      try { if (run('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore', timeout: 10_000 }).status === 0) return } catch {}
    }
    try { child.kill('SIGKILL') } catch {}
    return
  }
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
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
