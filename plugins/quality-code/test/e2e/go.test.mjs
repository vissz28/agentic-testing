// End to end on Go: the real pipeline with the real `go test`, on a tiny module made at run time
// (plain Go comparisons: no module to download). Runs only with QC_E2E=1 and a go on the PATH (the
// e2e-go CI job sets Go up).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../git-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../../bin/pipeline.mjs')
const hasGo = spawnSync('go', ['version'], { encoding: 'utf8' }).status === 0
const skip = process.env.QC_E2E !== '1' ? 'end to end: set QC_E2E=1' : !hasGo ? 'end to end: no go on the PATH' : false
const LONG = 10 * 60 * 1000
const SPEC = 'stock/reorder_test.go'

const CODE = bug => `package stock

// Reorder is how many units to order for a stock below the threshold of 5: up to 24.
func Reorder(stock int) int {
	if stock ${bug ? '<=' : '<'} 5 {
		return 24 - stock
	}
	return 0
}
`

const GREEN = `package stock

import "testing"

// DEMO-1 Reorder below the threshold
func TestReorder(t *testing.T) {
	t.Run("a stock of 4 orders 20", func(t *testing.T) {
		got := Reorder(4)

		if got != 20 {
			t.Errorf("Reorder(4) = %d, want 20", got)
		}
	})

	t.Run("a stock of 5 orders nothing", func(t *testing.T) {
		if got := Reorder(5); got != 0 {
			t.Errorf("Reorder(5) = %d, want 0", got)
		}
	})
}
`

// The same scenarios with their values taken out: they run and pass, and bind nothing of the ticket.
const HOLLOW = `package stock

import "testing"

// DEMO-1 Reorder below the threshold
func TestReorder(t *testing.T) {
	t.Run("a stock of 4 orders 20", func(t *testing.T) {
		got := Reorder(4)

		if got < 0 {
			t.Errorf("negative: %d", got)
		}
	})

	t.Run("a stock of 5 orders nothing", func(t *testing.T) {
		_ = Reorder(5)
	})
}
`

const TICKET = {
  key: 'DEMO-1',
  summary: 'Reorder below the threshold',
  issuetype: 'Story',
  text: {
    description: '## Summary\nThe stock service orders new units when the stock falls below 5.',
    acField: 'Scenario: a stock of 4 orders 20\nGiven a stock of 4\nWhen the reorder is computed\nThen 20 units are ordered\n\nScenario: a stock of 5 orders nothing\nGiven a stock of 5\nWhen the reorder is computed\nThen 0 units are ordered',
  },
}

function project({ spec = GREEN, bug = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-e2e-go-'))
  const put = (p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  put('go.mod', 'module example.com/demo\n\ngo 1.22\n')
  put('stock/reorder.go', CODE(bug))
  put(SPEC, spec)
  put('tickets/DEMO-1.json', JSON.stringify(TICKET, null, 2))
  put('.claude/quality-code.json', JSON.stringify({ version: 1, adapter: 'go', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'] } }))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV, stdio: 'ignore' })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g('commit', '-qm', 'demo')
  return d
}

function pipeline(root, args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, QC_NO_AUDIT: '1' }, encoding: 'utf8', timeout: LONG })
  let outcome = null
  try { outcome = JSON.parse(r.stdout.trim().split('\n').at(-1)) } catch {}
  assert.ok(outcome, `no JSON outcome (exit ${r.status}): ${r.stderr || r.stdout}`)
  const step = name => outcome.steps.find(s => s.check === name)
  const card = `${outcome.verdict}, decided by ${outcome.decidedBy ?? '-'}: ${outcome.steps.map(s => `${s.check}=${s.status} (${s.summary})`).join(' | ')}`
  return { code: r.status, outcome, step, card }
}

const ARGS = [SPEC, '--key', 'DEMO-1', '--ticket', '@tickets/DEMO-1.json']

test('go: green, and every assertion mutant is killed; the spec comes back as it was', { skip, timeout: LONG }, t => {
  const d = project()
  try {
    const r = pipeline(d, ARGS)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'green', r.card)
    assert.equal(r.code, 0)
    assert.equal(r.step('tests').data.passed, 2)
    assert.equal(r.step('expected').status, 'pass', r.card)
    const m = r.step('mutation')
    assert.equal(m.status, 'pass', m.summary)
    assert.equal(m.data.killed, 2)
    assert.equal(readFileSync(join(d, SPEC), 'utf8'), GREEN)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('go: hollow scenarios pass and still fail the checks', { skip, timeout: LONG }, t => {
  const d = project({ spec: HOLLOW })
  try {
    const r = pipeline(d, ARGS)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'checks_failed', r.card)
    assert.equal(r.code, 1)
    assert.equal(r.step('tests').status, 'pass')
    assert.equal(r.step('suite-honesty').status, 'fail')
    assert.deepEqual(r.step('suite-honesty').findings.map(f => f.test), ['a stock of 5 orders nothing'])
    assert.equal(r.step('expected').status, 'fail')
    assert.equal(readFileSync(join(d, SPEC), 'utf8'), HOLLOW)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('go: red on a real bug, with the failing line', { skip, timeout: LONG }, t => {
  const d = project({ bug: true })
  try {
    const r = pipeline(d, ARGS)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'tests_red', r.card)
    assert.equal(r.outcome.decidedBy, 'tests')
    const tests = r.step('tests')
    assert.deepEqual({ passed: tests.data.passed, failed: tests.data.failed }, { passed: 1, failed: 1 })
    assert.deepEqual(tests.findings.map(f => [f.test, f.detail]), [['a stock of 5 orders nothing', 'reorder_test.go:17: Reorder(5) = 19, want 0']])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('go: a spec that does not compile is not verified, never red or green', { skip, timeout: LONG }, t => {
  const d = project({ spec: GREEN.replace('got := Reorder(4)', 'got := Reordr(4)') })
  try {
    const r = pipeline(d, ARGS)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'not_verified', r.card)
    assert.equal(r.step('tests').status, 'not_run')
    assert.match(r.step('tests').summary, /undefined: Reordr/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
