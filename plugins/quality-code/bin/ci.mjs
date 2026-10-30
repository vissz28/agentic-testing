#!/usr/bin/env node
// Quality Code in CI (GitHub Actions or GitLab CI): two jobs for each pull or merge request, and the command that writes them.
// node bin/ci.mjs [--base REF]                                   the gate: git and node only, no install, seconds
// node bin/ci.mjs --tests [--all] [--base REF] [--junit FILE]    the tests, in a job that installed the project
// node bin/ci.mjs --init [github|gitlab] [--print]                writes the CI file (the provider is guessed when not given)
// The gate checks the specs the request changed: honesty (no assertion or test removed, a deleted or renamed spec
// included, no skip without a ticket), assertions (every test asserts something) and the frozen evals.
// The tests run the changed specs through the pipeline, one run per module (a backend layer, an e2e folder): types,
// tests and mutation. A side whose code changed but no spec did runs its whole suite without mutation, as does
// everything outside a request (the default branch), with --all, or when the changes cannot be read. No model is involved.
// Exit 0 every check passed (or nothing to check), 1 a check failed or a test is red, 2 usage or config error,
// 3 something could not run (never a pass).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { adaptersForSide, adaptersOf } from '../lib/base/stack.mjs'
import { loadConfig, projectRoot } from '../lib/base/config.mjs'
import { backendOf, runnerLabel } from '../lib/base/backends.mjs'
import { EXIT, result } from '../lib/base/result.mjs'
import { moduleOf, planChanges } from '../lib/base/changes.mjs'
import { projectSpecs } from '../lib/report/quality-program.mjs'
import { formatCard, label } from '../lib/pipeline/card.mjs'
import { detect } from './branch.mjs'
import { checkProject, formatResult } from './checks.mjs'
import { runEvals } from './evals.mjs'
import { EXEC, packageManager } from './setup.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: ci.mjs [--base REF] | ci.mjs --tests [--all] [--base REF] [--junit FILE] | ci.mjs --init [github|gitlab] [--print]'
const HEADER = '# Quality Code'
const FETCH_HINT = 'fetch the full history: fetch-depth 0 on GitHub, GIT_DEPTH 0 on GitLab'
const WORDS = { green: 'green', tests_red: 'tests red', checks_failed: 'checks failed', not_verified: 'not verified', skipped: 'skipped' }
export const ORDER = { green: 0, skipped: 0, tests_red: 1, checks_failed: 1, not_verified: 3 }

/** What the pull or merge request targets, as the CI tells it; null outside one. GitLab's SHA needs no fetched branch. */
export const baseFromEnv = env => env.GITHUB_BASE_REF || env.CI_MERGE_REQUEST_DIFF_BASE_SHA || null
export const providerOf = env => (env.GITHUB_ACTIONS ? 'github' : env.GITLAB_CI ? 'gitlab' : null)

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? ''
const readText = p => { try { return readFileSync(p, 'utf8') } catch { return '' } }

function parse(argv) {
  const a = { init: false, print: false, tests: false, all: false, provider: null }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--base' || x === '--junit') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-') || !v.trim()) throw new Error(`${x} needs a value, not "${v ?? ''}"`)
      a[x.slice(2)] = v
    } else if (x === '--init') a.init = true
    else if (x === '--print') a.print = true
    else if (x === '--tests') a.tests = true
    else if (x === '--all') a.all = true
    else if (x === 'github' || x === 'gitlab') a.provider = x
    else throw new Error(`unknown option ${x}`)
  }
  if ((a.print || a.provider) && !a.init) throw new Error(`${a.print ? '--print' : a.provider} goes with --init`)
  if (a.init && (a.base || a.tests || a.all || a.junit)) throw new Error('--init takes github, gitlab and --print only')
  if ((a.all || a.junit) && !a.tests) throw new Error(`${a.all ? '--all' : '--junit'} goes with --tests`)
  return a
}

// ---- The CI file ----

// Dependency files that name Testcontainers when the integration tests start real databases.
const DEP_FILE = /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|[^/]+\.(?:csproj|fsproj))$/
const PIP_FILES = ['requirements.txt', 'requirements-dev.txt', 'requirements-test.txt']

/** What the CI file needs to know about the project: its runners, how it installs, where it is in the repo. */
export function stackOf(root, config) {
  let pkg = null
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch {}
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  return {
    backend: adaptersOf(config).includes(backendOf(config)) ? backendOf(config) : null,
    playwright: adaptersOf(config).includes('playwright'),
    pm: pkg ? packageManager(root, pkg).pm : null,
    lock: existsSync(join(root, 'package-lock.json')),
    prisma: Boolean(deps.prisma || deps['@prisma/client']),
    containers: git(root, ['ls-files']).split('\n').filter(f => DEP_FILE.test(f)).some(f => /testcontainers/i.test(readText(join(root, f)))),
    pip: PIP_FILES.filter(f => existsSync(join(root, f))),
    pyproject: existsSync(join(root, 'pyproject.toml')),
    maven: existsSync(join(root, 'pom.xml')),
    go: /^go (\d+\.\d+)/m.exec(readText(join(root, 'go.mod')))?.[1] ?? '1.23',
    prefix: git(root, ['rev-parse', '--show-prefix']),
    defaultBranch: git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || 'main',
  }
}

/** The install lines, guessed from the lockfile and the runners. */
function installLines(s) {
  const lines = []
  if (s.pm) lines.push({ npm: s.lock ? 'npm ci' : 'npm install', pnpm: 'corepack enable && pnpm install --frozen-lockfile', yarn: 'corepack enable && yarn install', bun: 'npm install -g bun && bun install --frozen-lockfile' }[s.pm])
  // Prisma's client is generated, not installed: without it the types step reports errors that are not there.
  if (s.prisma) lines.push(`${EXEC[s.pm]} prisma generate`)
  if (s.playwright) lines.push(`${EXEC[s.pm ?? 'npm']} playwright install --with-deps`)
  if (s.backend === 'pytest') lines.push(...(s.pip.length ? s.pip.map(f => `pip install -r ${f}`) : s.pyproject ? ['pip install -e .'] : []))
  if (s.backend === 'go') lines.push('go mod download')
  if (s.backend === 'dotnet') lines.push('dotnet restore')
  return lines
}

// A backend that is not JavaScript brings its own toolchain; node runs the plugin beside it.
const GH_SETUP = {
  pytest: () => ['      - uses: actions/setup-python@v5', "        with: { python-version: '3.12' }"],
  junit: () => ['      - uses: actions/setup-java@v4', "        with: { distribution: temurin, java-version: '21' }"],
  go: s => ['      - uses: actions/setup-go@v5', `        with: { go-version-file: '${s.prefix}go.mod' }`],
  dotnet: () => ['      - uses: actions/setup-dotnet@v4', "        with: { dotnet-version: '8.0.x' }"],
}
const GL_IMAGE = { pytest: () => 'python:3.12', junit: s => (s.maven ? 'maven:3-eclipse-temurin-21' : 'eclipse-temurin:21'), go: s => `golang:${s.go}`, dotnet: () => 'mcr.microsoft.com/dotnet/sdk:8.0' }
// ponytail: x64 Linux only; an arm64 runner needs the linux-arm64 tarball.
const NODE_TARBALL = 'curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.gz | tar -xz -C /usr/local --strip-components=1'
const JS_STACK = { backend: 'vitest', playwright: false, pm: 'npm', lock: true, prisma: false, containers: false, pip: [], pyproject: false, maven: false, go: '1.23', prefix: '', defaultBranch: 'main' }

/** The CI file: the gate and the tests, the plugin fetched at the version this one is. */
export function template(provider, version, s = JS_STACK) {
  const fetch = `git clone --quiet --depth 1 --branch quality-code--v${version} https://github.com/vissz28/agentic-testing.git /tmp/quality-code`
  const ci = 'node /tmp/quality-code/plugins/quality-code/bin/ci.mjs'
  const native = s.backend && s.backend !== 'vitest' ? s.backend : null
  const install = installLines(s)
  const request = provider === 'github' ? 'pull request' : 'merge request'
  const head = [
    `${HEADER}: two jobs on each ${request}. No model is involved: scripts decide.`,
    `# quality-gate: on the specs the ${request} changed, honesty (no assertion or test removed, no skip without`,
    '#   a ticket), assertions (every test asserts something) and the frozen evals. git and node only, seconds.',
    '# quality-tests: types, tests and mutation on the changed specs, one run per module. A side whose code changed',
    `#   but no spec did runs its whole suite without mutation, as does a push to ${provider === 'github' ? s.defaultBranch : 'the default branch'}.`,
    '# The install lines were guessed from the project: change them if it installs differently (a private registry,',
    '#   a generated file); add the variables and secrets the tests need.',
    ...(s.playwright ? ['# Playwright starts the app through webServer in its config; without one, start the app before the tests.'] : []),
    '# The plugin is fetched from GitHub at a fixed version: mirror it if your runners cannot reach github.com.',
    '# Written by /quality-code:ci; run it again after a plugin update (it rewrites this file).',
  ]
  if (provider === 'github') {
    const start = ['    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4', '        with: { fetch-depth: 0 }', '      - uses: actions/setup-node@v4', '        with: { node-version: 22 }']
    return `${[...head,
      'name: quality-code',
      'on:',
      '  pull_request:',
      '  push:',
      `    branches: [${s.defaultBranch}]`,
      ...(s.prefix ? ['defaults:', '  run:', `    working-directory: ${s.prefix}`] : []),
      'jobs:',
      '  quality-gate:',
      "    if: github.event_name == 'pull_request'",
      ...start, `      - run: ${fetch}`, `      - run: ${ci}`,
      '  quality-tests:',
      ...start, ...(native ? GH_SETUP[native](s) : []), ...install.map(l => `      - run: ${l}`), `      - run: ${fetch}`, `      - run: ${ci} --tests`,
    ].join('\n')}\n`
  }
  const cd = s.prefix ? [`    - cd ${s.prefix}`] : []
  return `${[...head,
    'quality-gate:',
    '  image: node:22',
    '  variables:',
    '    GIT_DEPTH: "0"',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    '  script:', ...cd, `    - ${fetch}`, `    - ${ci}`,
    '',
    'quality-tests:',
    `  image: ${native ? GL_IMAGE[native](s) : 'node:22'}`,
    ...(s.containers ? [
      '  # Testcontainers: the databases start in Docker-in-Docker (the runner must allow privileged services).',
      '  # Ryuk is off: the service is destroyed with the job, so there is nothing left to reap.',
      '  services:', '    - name: docker:24-dind', '      alias: docker', '      command: ["--tls=false"]',
    ] : []),
    '  variables:',
    '    GIT_DEPTH: "0"',
    ...(s.containers ? ['    DOCKER_HOST: tcp://docker:2375', '    DOCKER_TLS_CERTDIR: ""', '    TESTCONTAINERS_RYUK_DISABLED: "true"'] : []),
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    '    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH',
    '  # A runner that dies is retried; a red test never is.',
    '  retry:', '    max: 2', '    when: [runner_system_failure, stuck_or_timeout_failure, scheduler_failure, api_failure]',
    '  script:', ...cd, ...(native ? [`    - ${NODE_TARBALL}`] : []), ...install.map(l => `    - ${l}`), `    - ${fetch}`, `    - ${ci} --tests --junit quality-code-junit.xml`,
    '  artifacts:', '    when: always', '    reports:', `      junit: ${s.prefix}quality-code-junit.xml`,
  ].join('\n')}\n`
}

/** github or gitlab, from the CI files the repo has, else its origin remote; null when nothing says. */
export function guessProvider(top) {
  if (existsSync(join(top, '.gitlab-ci.yml'))) return 'gitlab'
  if (existsSync(join(top, '.github'))) return 'github'
  const url = git(top, ['remote', 'get-url', 'origin'])
  return /github/i.test(url) ? 'github' : /gitlab/i.test(url) ? 'gitlab' : null
}

function init(root, config, a, stdout, stderr) {
  // The CI file goes at the top of the repo, also for a project in a subfolder.
  const top = git(root, ['rev-parse', '--show-toplevel']) || root
  const provider = a.provider ?? guessProvider(top)
  if (!provider) { stderr('Say which CI: github or gitlab (the repo has no CI file and its remote names neither).\n'); return 2 }
  const text = template(provider, JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version, stackOf(root, config))
  if (a.print) { stdout(text); return 0 }
  // Only a file Quality Code wrote is replaced; an existing .gitlab-ci.yml gets the jobs in a file of their own, to include.
  const free = p => !existsSync(join(top, p)) || readText(join(top, p)).startsWith(HEADER)
  const target = provider === 'github' ? '.github/workflows/quality-code.yml' : free('.gitlab-ci.yml') ? '.gitlab-ci.yml' : '.gitlab/quality-code.gitlab-ci.yml'
  if (!free(target)) { stderr(`${target} is there already and Quality Code did not write it: not overwritten. Print the jobs instead: --init ${provider} --print\n`); return 2 }
  mkdirSync(dirname(join(top, target)), { recursive: true })
  writeFileSync(join(top, target), text)
  stdout(`ok: wrote ${target} (${provider === 'github' ? 'GitHub Actions' : 'GitLab CI'})\n`)
  if (target.startsWith('.gitlab/') && !readText(join(top, '.gitlab-ci.yml')).includes(target)) {
    stdout(`Add it to your .gitlab-ci.yml (into its include: list, if it has one):\ninclude:\n  - local: ${target}\n`)
  }
  return 0
}

// ---- The gate ----

async function gate(root, config, a, env, stdout) {
  const det = detect(root, config, { base: a.base ?? baseFromEnv(env) })
  const cannot = !det.isRepo ? 'this is not a git checkout' : !det.base || !det.mergeBase ? `the target branch was not found (${FETCH_HINT})` : det.shallow ? `the checkout is shallow (${FETCH_HINT})` : null
  if (cannot) { stdout(`quality-code ci: not verified: ${cannot}, so the changed specs cannot be read.\n`); return 3 }
  if (det.onBase) { stdout(`quality-code ci: this is ${det.base.replace(/^origin\//, '')} itself, nothing to compare.\n`); return 0 }
  const changed = det.files.filter(f => f.committed && f.kind === 'test')
  const head = `quality-code ci · changes since ${det.base}`
  if (!changed.length) { stdout(`${head}: no spec changed, nothing to check.\n`); return 0 }
  stdout(`${head}: ${changed.length} spec${changed.length === 1 ? '' : 's'}\n${changed.map(f => `  ${f.status} ${f.from ? `${f.from} → ` : ''}${f.path}`).join('\n')}\n\n`)

  // Honesty reads the diff, so a deleted spec and a renamed spec's old path count; assertions read the specs there now.
  const known = new Set(projectSpecs(root, config).map(s => s.path))
  const present = changed.filter(f => f.status !== 'D' && known.has(f.path)).map(f => f.path)
  const runs = [['honesty', { specs: [...new Set(changed.flatMap(f => (f.from ? [f.from, f.path] : [f.path])))], range: `${det.base}...HEAD` }]]
  if (present.length) runs.push(['suite-honesty', { specs: present }])
  const results = []
  for (const [name, args] of runs) {
    try { results.push(await checkProject(name, args, config, root)) } catch (e) { results.push(result(name, 'not_run', `crashed: ${String(e?.message ?? e).split('\n')[0]}`)) }
  }
  const evals = runEvals(root, config)
  const drift = evals.filter(r => r.problems.length)
  if (evals.length) results.push(result('evals', drift.length ? 'fail' : 'pass', drift.length ? `${drift.length} of ${evals.length} frozen fixture(s) drifted` : `${evals.length} frozen fixture(s) hold`, drift.flatMap(r => r.problems.map(p => ({ file: r.key, detail: p })))))

  const code = Math.max(...results.map(r => EXIT[r.status]))
  stdout(`${results.map(r => formatResult({ ...r, check: label(r.check) })).join('\n')}\n\nResult: ${code === 0 ? 'PASSED' : code === 1 ? 'FAILED' : 'NOT VERIFIED'}${code ? ` (exit ${code})` : ''}\n`)
  return code
}

// ---- The tests ----

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One JUnit testcase per phase, so the merge request shows them and a failed phase is a failure. */
export function junit(phases) {
  const bad = phases.filter(p => ORDER[p.verdict] > 0)
  const cases = phases.map(p => {
    const body = p.verdict === 'skipped' ? '<skipped/>' : ORDER[p.verdict] > 0 ? `<failure message="${esc(WORDS[p.verdict])}">${esc(p.detail)}</failure>` : ''
    return `  <testcase classname="quality-code" name="${esc(p.name)}">${body}</testcase>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="quality-code" tests="${phases.length}" failures="${bad.length}">\n${cases.join('\n')}\n</testsuite>\n`
}

/** One pipeline run: a module's changed specs (with mutation), or a side's whole suite (without). */
function runPhase(root, job, range, env) {
  const what = job.specs ?? ['--suite', job.side, '--no-mutation']
  const r = spawnSync(process.execPath, [join(HERE, 'pipeline.mjs'), ...what, ...(range ? ['--range', range] : []), '--json'], { cwd: root, env: { ...env, CI: '1' }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  let outcome = null
  try { outcome = JSON.parse(r.stdout) } catch {}
  return { r, outcome }
}

async function tests(root, config, a, env, stdout, stderr) {
  const provider = providerOf(env)
  const has = adaptersOf(config)
  const sides = ['backend', 'frontend'].filter(side => adaptersForSide(side, config).some(x => has.includes(x)))
  const known = projectSpecs(root, config)
  const base = a.base ?? baseFromEnv(env)

  // What to run: everything (--all, outside a request, or when the changes cannot be read), else only what the request touched.
  let scope = { mode: 'all', why: 'every test was asked for (--all)' }
  let plan = null
  if (!a.all && provider && !base) scope = { mode: 'all', why: 'this is no pull or merge request (a push to the default branch)' }
  else if (!a.all) {
    const det = detect(root, config, { base })
    if (!det.isRepo) scope = { mode: 'all', why: 'this is not a git checkout, so what changed cannot be read' }
    else if (!det.base || !det.mergeBase) scope = { mode: 'all', why: `the target branch was not found (${FETCH_HINT})` }
    else if (det.shallow) scope = { mode: 'all', why: `the checkout is shallow, so what changed cannot be read (${FETCH_HINT})` }
    else if (det.onBase) scope = { mode: 'all', why: `this is ${det.base.replace(/^origin\//, '')} itself` }
    else {
      plan = planChanges(det.files, config, known)
      scope = { mode: 'changes', base: det.base, why: `changes since ${det.base}: ${det.counts.test} test file${det.counts.test === 1 ? '' : 's'}, ${det.counts.code} code file${det.counts.code === 1 ? '' : 's'}` }
    }
  }
  stdout(`quality-code ci tests${provider ? ` · ${provider === 'github' ? 'GitHub Actions' : 'GitLab CI'}` : ''}\n${scope.mode === 'all' ? `Running the whole suite, without mutation: ${scope.why}.` : `Running only what changed (${scope.why}).`}\n`)

  // One run per module: the changed specs of a module together, or a side's whole suite.
  const jobs = []
  const phases = []
  for (const side of sides) {
    const p = plan?.[side]
    if (!p) jobs.push({ side, name: side })
    else if (p.specs.size) {
      const groups = new Map()
      for (const path of p.specs.keys()) {
        const mod = moduleOf(config, root, path, known.find(k => k.path === path).adapter)
        groups.set(mod, [...(groups.get(mod) ?? []), path])
      }
      for (const [mod, specs] of groups) jobs.push({ side, name: `${side}/${mod}`, specs })
    } else if (p.source || p.shared) jobs.push({ side, name: side, note: p.shared && !p.source ? 'a shared config or dependency file changed' : `${side} code changed and no ${side} spec did` })
    else {
      phases.push({ name: side, verdict: 'skipped', detail: `nothing changed in ${side}` })
      stdout(`\n== ${side} · skipped (nothing changed in ${side})\n`)
    }
  }

  for (const job of jobs) {
    const want = adaptersForSide(job.side, config).filter(x => has.includes(x))
    const runner = want.map(runnerLabel).join(' + ')
    const specs = job.specs ?? known.filter(k => want.includes(k.adapter)).map(k => k.path)
    if (!specs.length) {
      // Zero tests must never read as a pass.
      phases.push({ name: job.name, verdict: 'not_verified', detail: `no ${runner} spec files found in the project's test folders` })
      stdout(`\n== ${job.name} (${runner}) · not verified\nNo ${runner} spec files found in the project's test folders.\n`)
      continue
    }
    if (job.note) stdout(`\n(${job.note}: running the whole ${job.side} suite, without mutation)`)
    const { r, outcome } = runPhase(root, job, scope.mode === 'changes' && job.specs ? `${scope.base}...HEAD` : null, env)
    if (!outcome) {
      const detail = (r.stderr || r.stdout || 'the pipeline did not answer').trim()
      phases.push({ name: job.name, verdict: 'not_verified', detail })
      stdout(`\n== ${job.name} (${runner}) · not verified\n${detail}\n`)
      continue
    }
    const t = outcome.steps?.find(x => x.check === 'tests')?.data ?? {}
    phases.push({ name: job.name, verdict: outcome.verdict, detail: formatCard(outcome, { specs }).replace(/\nPIPELINE_JSON:.*$/s, ''), passed: t.passed, failed: t.failed })
    stdout(`\n== ${job.name} (${runner}) · ${WORDS[outcome.verdict] ?? outcome.verdict}\n${phases.at(-1).detail}\n`)
  }
  if (scope.mode === 'changes' && !jobs.length) stdout('\nNothing to test: no backend or frontend test or code changed.\n')

  const code = phases.reduce((m, p) => Math.max(m, ORDER[p.verdict] ?? 3), 0)
  const verdict = code === 0 ? (jobs.length ? 'PASSED' : 'NOTHING TO TEST') : code === 1 ? 'FAILED' : 'NOT VERIFIED'
  const width = Math.max(9, ...phases.map(p => p.name.length))
  stdout(`\nSummary\n${phases.map(p => `  ${p.name.padEnd(width)} ${WORDS[p.verdict] ?? p.verdict}${p.passed !== undefined ? ` · ${p.passed} passed · ${p.failed} failed` : ''}`).join('\n')}\nResult: ${verdict}${code ? ` (exit ${code})` : ''}\n`)

  if (a.junit) {
    try { mkdirSync(dirname(resolve(root, a.junit)), { recursive: true }); writeFileSync(resolve(root, a.junit), junit(phases)) } catch (e) { stderr(`could not write ${a.junit}: ${e.message}\n`) }
  }
  if (provider === 'github' && env.GITHUB_STEP_SUMMARY) {
    try {
      const rows = phases.map(p => `| ${p.name} | ${WORDS[p.verdict] ?? p.verdict} | ${p.passed !== undefined ? `${p.passed} passed · ${p.failed} failed` : ''} |`)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `## Quality Code: ${verdict}\n\n| Phase | Verdict | Tests |\n|---|---|---|\n${rows.join('\n')}\n`)
    } catch {}
    for (const p of phases.filter(x => ORDER[x.verdict] > 0)) stdout(`::error title=Quality Code ${p.name}::${WORDS[p.verdict]}\n`)
  }
  return code
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  let a
  try { a = parse(argv) } catch (e) { stderr(`${e.message}\n${USAGE}\n`); return 2 }
  const root = projectRoot(env, cwd)
  const cfg = loadConfig(root)
  if (!cfg.ok) { stderr(`${cfg.errors.join('\n')}\n`); return 2 }
  if (cfg.source === 'personal') { stderr('CI needs a repo with its own .claude/quality-code.json (run /quality-code:setup in the project).\n'); return 2 }
  if (a.init) return init(root, cfg.config, a, stdout, stderr)
  return a.tests ? tests(root, cfg.config, a, env, stdout, stderr) : gate(root, cfg.config, a, env, stdout)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
