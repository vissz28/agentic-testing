// Live progress of one pipeline run, for the band that shows it above the prompt. Best effort: a failed write never stops a run.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The test reporters (in the runner's own process) find the file through this variable.
export const LIVE_ENV = 'QC_LIVE_FILE'

// The band rebuilds the same path from the session's folder: keep the two in step (band/register.tsx).
export const liveSlug = root => resolve(root).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export const liveFile = (root, tmp = tmpdir()) => join(tmp, 'quality-code', 'live', `${liveSlug(root)}.json`)

export function readLive(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** Read, change, write whole: the band never reads a half-written file. */
export function updateLive(file, change, now = Date.now()) {
  try {
    const next = { ...change(readLive(file) ?? {}), updatedAt: new Date(now).toISOString() }
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(next))
    renameSync(tmp, file)
    return next
  } catch { return null }
}

/** One run's writer. Each side (Vitest, Playwright) has its own list of steps. */
export function startLive(root, { key = null, file = liveFile(root), now = Date.now() } = {}) {
  try { mkdirSync(join(file, '..'), { recursive: true }) } catch {}
  updateLive(file, () => ({
    v: 1, key, root: resolve(root), pid: process.pid, startedAt: new Date(now).toISOString(), finishedAt: null, verdict: null,
    side: null, sideIndex: 0, sides: 0, step: null, plan: [], tests: null, mutants: null, stryker: null,
  }), now)
  return {
    file,
    side: (label, plan, sides) => updateLive(file, s => ({ ...s, side: label, sideIndex: (s.side ? s.sideIndex + 1 : 0), sides: Math.max(sides ?? 1, 1), plan, step: null, tests: null, mutants: null, stryker: null })),
    step: name => updateLive(file, s => ({ ...s, step: name })),
    /** kind: tests | mutants | stryker; counts replace the old ones. */
    count: (kind, counts) => updateLive(file, s => ({ ...s, [kind]: counts })),
    finish: verdict => updateLive(file, s => ({ ...s, verdict, finishedAt: new Date().toISOString() })),
  }
}

/** The tests' counts from a finished run: the reporters' last word may miss a file that never ran. */
export function testCounts(run) {
  const tests = run?.tests ?? []
  const n = st => tests.filter(t => t.status === st).length
  return { total: tests.length, done: tests.length, passed: n('passed'), failed: n('failed'), skipped: n('skipped') }
}
