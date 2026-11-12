// Trial report fixes: a monorepo is one project, Jest per workspace, build copies and ignored folders, lookalike Jira keys.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { detect, projectCandidates, write } from '../../bin/setup.mjs'
import { ENV as GIT_ENV } from '../git-env.mjs'

const cfg = { version: 2, backend: 'vitest', jira: { site: 'https://e.atlassian.net', projects: ['DEMO'], acceptanceCriteriaField: null }, languages: ['en'], features: [] }
const tree = files => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'at-')))
  for (const [p, s] of Object.entries(files)) { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), typeof s === 'string' ? s : JSON.stringify(s)) }
  return d
}
const monorepo = extra => tree({
  'package.json': { name: 'root', private: true, workspaces: ['services/*'], scripts: { 'test:tools': 'node --test tools' } },
  ...Object.fromEntries(['a', 'b', 'c'].flatMap(n => [
    [`services/${n}/package.json`, { name: n, devDependencies: { jest: '30' } }],
    [`services/${n}/jest.config.js`, 'module.exports = {}'],
    [`services/${n}/src/x.unit.test.js`, ''],
  ])),
  ...extra,
})

test('detect: an npm-workspaces root is one project, never a choice of which service', () => {
  const r = detect(monorepo({}), {})
  assert.deepEqual([r.root.proposed, r.root.ask, r.root.candidates], [null, false, []])
  assert.deepEqual(r.workspaces.folders, ['services/a', 'services/b', 'services/c'])
})

test('detect: a Jest monorepo is Jest (not node), each workspace with its own config', () => {
  const d = monorepo({})
  const r = detect(d, {})
  assert.deepEqual([r.frontend, r.backend, r.runners], [null, 'vitest', { unit: 'jest' }])
  assert.deepEqual(r.workspaces.unitConfigs, ['a', 'b', 'c'].map(n => ({ match: `services/${n}/`, config: `services/${n}/jest.config.js` })))
  const config = { ...cfg, runners: { unit: 'jest' }, vitest: { configs: r.workspaces.unitConfigs } }
  assert.equal(write(d, config).ok, true)
})

test('detect: Jest set in a workspace package.json maps to that file; the majority runner is the project runner', () => {
  const r = detect(tree({
    'package.json': { workspaces: { packages: ['apps/*'] } },
    'apps/a/package.json': { jest: { testEnvironment: 'node' } },
    'apps/b/package.json': { devDependencies: { vitest: '3' } },
    'apps/c/package.json': { devDependencies: { vitest: '3' } },
  }), {})
  assert.deepEqual([r.workspaces.unit, r.root.ask, r.workspaces.unitConfigs], ['vitest', false, []])
  const j = detect(tree({ 'package.json': { workspaces: ['apps/*'] }, 'apps/a/package.json': { jest: {} } }), {})
  assert.deepEqual(j.workspaces.unitConfigs, [{ match: 'apps/a/', config: 'apps/a/package.json' }])
})

test('detect: build copies and git-ignored folders are no boundary, spec folder or project', () => {
  const d = monorepo({
    '.gitignore': 'generated/\n.build-context/\n',
    '.build-context/services/a/src/x.unit.test.js': '',
    '.build-context/src/y.js': '',
    'generated/src/z.test.js': '',
    'generated/package.json': '{}',
  })
  execFileSync('git', ['init', '-q'], { cwd: d, env: GIT_ENV })
  const r = detect(d, {})
  assert.doesNotMatch(JSON.stringify([r.specFolders, r.boundaries, r.workspaces.folders, r.playwrightConfigs]), /build-context|generated/)
  assert.deepEqual(r.specFolders, ['services/a/', 'services/b/', 'services/c/'])
})

test('detect: a build copy is skipped even without git, and a plain repo still finds its specs', () => {
  const r = detect(tree({ 'package.json': { devDependencies: { jest: '30' } }, 'src/a.test.js': '', '.build-context/src/a.test.js': '' }), {})
  assert.deepEqual(r.specFolders, ['src/'])
})

test('projectCandidates: a lookalike of a more used key (PF0 with a zero beside PFO) is not a second candidate', () => {
  assert.deepEqual(projectCandidates(['PFO-1 a', 'PFO-2 b', 'PF0-3 typo']), ['PFO'])
  assert.deepEqual(projectCandidates(['PF0-3 first', 'PFO-3 second']), ['PFO'], 'a tie prefers the letters')
  assert.deepEqual(projectCandidates(['AB1-1', 'ABC-2']), ['AB1', 'ABC'], 'a real key with a digit stays when it has no twin')
})
