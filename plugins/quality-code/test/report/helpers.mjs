// Installs the synthetic transcripts of fixtures/ into a temporary Claude config dir for a temporary project.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugFor } from '../../lib/report/transcripts.mjs'

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname
export const NOW = Date.parse('2026-10-14T12:00:00Z')

function walk(dir) {
  return readdirSync(dir).flatMap(n => statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])
}

/** { root, configDir, dir }. folder: the projects/ folder name; defaults to the project's slug. */
export function install({ folder = null, config = null } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'qc-consumption-'))
  const root = join(tmp, 'my project')
  const configDir = join(tmp, 'claude')
  mkdirSync(root, { recursive: true })
  const dir = join(configDir, 'projects', folder ?? slugFor(root))
  cpSync(FIXTURES, dir, { recursive: true })
  for (const f of walk(dir)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__CWD__', root))
  if (config) {
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude/quality-code.json'), JSON.stringify(config))
  }
  return { root, configDir, dir }
}

export const CONFIG = {
  version: 1, adapter: 'vitest',
  jira: { site: 'https://example.atlassian.net', projects: ['ABC'], acceptanceCriteriaField: null },
}
