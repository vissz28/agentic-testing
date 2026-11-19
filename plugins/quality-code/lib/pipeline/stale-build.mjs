// Playwright against a built app (vite preview, serve): a build older than the code tests the old code.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../core/files.mjs'

const BUILD_DIRS = ['dist', 'build', 'out', '.next']
const SOURCE = ['src', 'public', 'index.html']
const SKIP = new Set(['node_modules', '.git'])
// Commands that serve files already built, not the code as it is now.
// A static server only as the command itself (serve dist), never a dev server's `serve` (ng serve, vue-cli-service serve).
const SERVES_BUILD = /\b(?:vite|astro|next|nuxt)\s+(?:preview|start)\b|(?:^|[;&|]\s*|\bnpx\s+|\bdlx\s+)(?:serve|http-server|sirv(?:-cli)?)\b/

/** The webServer command of a Playwright config's text, or null. */
export function webServerCommand(text) {
  const at = String(text ?? '').search(/\bwebServer\s*:/)
  if (at < 0) return null
  const m = /\bcommand\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(text.slice(at))
  return m ? m[2] : null
}

/** `npm run preview` and the like, one level down to the package.json script it names. */
function scriptOf(root, command) {
  const m = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/.exec(command.trim())
  if (!m) return command
  try { return readJson(join(root, 'package.json')).scripts?.[m[1]] ?? command } catch { return command }
}

/** Newest file under p (a file or a folder), bounded. */
function newest(root, p, budget = { n: 5000 }) {
  let best = null
  const visit = rel => {
    if (--budget.n < 0) return
    let st
    try { st = statSync(join(root, rel)) } catch { return }
    if (!st.isDirectory()) { if (!best || st.mtimeMs > best.mtimeMs) best = { path: rel, mtimeMs: st.mtimeMs }; return }
    let names = []
    try { names = readdirSync(join(root, rel)) } catch { return }
    for (const n of names) if (!SKIP.has(n)) visit(`${rel}/${n}`)
  }
  visit(p)
  return best
}

/**
 * { build, command, changed } when the Playwright config serves a build older than the newest source file; else null.
 * configFile: the Playwright config, relative to root.
 */
export function staleBuild(root, configFile) {
  let text
  try { text = readFileSync(join(root, configFile), 'utf8') } catch { return null }
  const command = webServerCommand(text)
  if (!command || !SERVES_BUILD.test(scriptOf(root, command))) return null
  const build = BUILD_DIRS.map(d => ({ dir: d, file: newest(root, d) })).find(b => b.file)
  if (!build) return null
  const changed = SOURCE.map(s => newest(root, s)).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  if (!changed || changed.mtimeMs <= build.file.mtimeMs) return null
  return { build: `${build.dir}/`, command, changed: changed.path }
}
