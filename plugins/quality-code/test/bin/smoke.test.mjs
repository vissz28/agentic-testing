// The smoke suite: @smoke tag handling, the --smoke/--url options of the pipeline, and the post-deploy CI job text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from '../../bin/pipeline.mjs'
import { template } from '../../bin/ci.mjs'
import { checkUrl, hasSmokeTag, smokeEnv, smokeSpecs } from '../../lib/pipeline/smoke.mjs'
import { ENV } from '../git-env.mjs'

const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const TAGGED = "import { test, expect } from '@playwright/test'\ntest('home opens', { tag: '@smoke' }, async ({ page }) => {\n  await page.goto('/')\n  await expect(page).toHaveTitle(/Shop/)\n})\n"
const TITLE = "test('login @smoke', async ({ page }) => { await expect(page).toHaveURL('/') })\n"
const PLAIN = "test('adds', async () => { expect(1).toBe(1) })\n"

test('the tag is found in a tag list and in a title, not in a longer word or an e-mail', () => {
  assert.ok(hasSmokeTag(TAGGED))
  assert.ok(hasSmokeTag(TITLE))
  assert.ok(hasSmokeTag("{ tag: ['@anchor', '@smoke'] }"))
  assert.ok(!hasSmokeTag(PLAIN))
  assert.ok(!hasSmokeTag('@smokey'))
  assert.ok(!hasSmokeTag('@smoke-old'))
  assert.ok(!hasSmokeTag('a@smoke.io'))
  assert.ok(!hasSmokeTag(undefined))
})

test('smokeSpecs keeps the tagged files and drops the rest and the unreadable', () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-smoke-'))
  put(d, 'e2e/a.spec.ts', TAGGED)
  put(d, 'e2e/b.spec.ts', PLAIN)
  assert.deepEqual(smokeSpecs(d, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/gone.spec.ts']), ['e2e/a.spec.ts'])
})

test('--url: http or https only, no credentials', () => {
  assert.equal(checkUrl('https://staging.example.com').url, 'https://staging.example.com/')
  assert.match(checkUrl('ftp://x.test').error, /http:\/\/ or https:\/\//)
  assert.match(checkUrl('not a url').error, /full address/)
  assert.match(checkUrl('https://user:pw@x.test').error, /user name or password/)
})

test('the run environment greps the tag and sets the base URL only when one is given', () => {
  assert.deepEqual(smokeEnv(null), { QC_SMOKE_GREP: '@smoke' })
  assert.equal(smokeEnv('https://s.test/').PLAYWRIGHT_TEST_BASE_URL, 'https://s.test/')
})

function repo(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-smoke-pl-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV })
  g('init', '-q', '-b', 'main')
  put(d, 'README.md', 'x')
  put(d, 'tsconfig.json', '{}')
  put(d, '.claude/quality-code.json', JSON.stringify({ version: 1, adapter: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] } }))
  g('add', '-A'); g('commit', '-qm', 'i')
  for (const [p, s] of Object.entries(files)) put(d, p, s)
  return d
}
async function smoke(d, args) {
  let seen = null
  const outcome = { verdict: 'green', decidedBy: null, steps: [{ check: 'tests', status: 'pass', summary: '1 passed', findings: [], data: { ran: true, passed: 1, failed: 0, skipped: 0 } }] }
  const w = [process.stdout.write, process.stderr.write]
  let out = '', err = ''
  process.stdout.write = m => { out += m; return true }
  process.stderr.write = m => { err += m; return true }
  let code
  const env = { CLAUDE_PROJECT_DIR: d }
  try {
    code = await main(args, env, d, { runPipeline: async (opts) => { seen = { opts, grep: process.env.QC_SMOKE_GREP, base: process.env.PLAYWRIGHT_TEST_BASE_URL }; return structuredClone(outcome) } })
  } finally { [process.stdout.write, process.stderr.write] = w }
  return { code, out, err, seen }
}

test('--smoke runs only the tagged specs of the frontend suite, without mutation, against the url', async () => {
  const d = repo({ 'e2e/a.spec.ts': TAGGED, 'e2e/b.spec.ts': PLAIN })
  const r = await smoke(d, ['--smoke', '--url', 'https://staging.example.com', '--no-audit'])
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(r.seen.opts.specs, ['e2e/a.spec.ts'])
  assert.equal(r.seen.opts.mutation, false)
  assert.equal(r.seen.grep, '@smoke')
  assert.equal(r.seen.base, 'https://staging.example.com/')
  assert.equal(process.env.QC_SMOKE_GREP, undefined, 'the environment is put back')
  assert.equal(process.env.PLAYWRIGHT_TEST_BASE_URL, undefined)
})

test('--smoke with no tagged test stops with exit 2 and says how to tag', async () => {
  const d = repo({ 'e2e/b.spec.ts': PLAIN })
  const r = await smoke(d, ['--smoke', '--no-audit'])
  assert.equal(r.code, 2)
  assert.match(r.err, /No @smoke tests found/)
  assert.equal(r.seen, null)
})

test('--url without --smoke, a bad url and the backend suite are refused', async () => {
  const d = repo({ 'e2e/a.spec.ts': TAGGED })
  assert.match((await smoke(d, ['e2e/a.spec.ts', '--url', 'https://x.test'])).err, /--url goes with --smoke/)
  assert.match((await smoke(d, ['--smoke', '--url', 'javascript:alert(1)'])).err, /http:\/\/ or https:\/\//)
  assert.match((await smoke(d, ['--smoke', '--suite', 'backend'])).err, /frontend \(Playwright\) suite/)
})

const STACK = { backend: 'vitest', playwright: true, pm: 'npm', lock: true, prisma: false, containers: false, pip: [], pyproject: false, maven: false, go: '1.23', prefix: '', defaultBranch: 'main', smoke: true }

test('ci --smoke: the GitHub file has an optional post-deploy job on a repository variable, no URL in it', () => {
  const gh = template('github', '1.0.0', STACK)
  assert.match(gh, /\n {2}smoke_post_deploy:\n/)
  assert.match(gh, /vars\.SMOKE_URL != ''/)
  assert.match(gh, /SMOKE_URL: \$\{\{ vars\.SMOKE_URL \}\}/)
  assert.match(gh, /pipeline\.mjs --smoke --url "\$SMOKE_URL"/)
  assert.match(gh, /workflow_dispatch:/)
  assert.match(gh, /playwright install --with-deps/)
  assert.doesNotMatch(gh, /https?:\/\/(?!github\.com|nodejs\.org)/)
})

test('ci --smoke: the GitLab file has the job after the other stages, on a CI/CD variable', () => {
  const gl = template('gitlab', '1.0.0', STACK)
  assert.match(gl, /\nsmoke_post_deploy:\n {2}stage: \.post\n/)
  assert.match(gl, /- if: \$SMOKE_URL && \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH/)
  assert.match(gl, /pipeline\.mjs --smoke --url "\$SMOKE_URL"/)
})

test('ci without --smoke has no smoke job', () => {
  for (const p of ['github', 'gitlab']) assert.doesNotMatch(template(p, '1.0.0', { ...STACK, smoke: false }), /smoke/)
})

test('ci: a backend toolchain install is left out of the smoke job', () => {
  const gl = template('gitlab', '1.0.0', { ...STACK, backend: 'pytest', pip: ['requirements.txt'] })
  const job = gl.slice(gl.indexOf('smoke_post_deploy:\n'))
  assert.doesNotMatch(job, /pip install/)
})
