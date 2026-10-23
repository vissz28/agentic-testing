// End to end on Python: the real pipeline with a real pytest, on a small project built in a temp folder
// (a pricing module, its DEMO-1 spec and the sample service's DEMO-1 ticket). Runs only with QC_E2E=1
// and Python with pytest installed (CI: the e2e-python job).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENV } from '../git-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '../../bin/pipeline.mjs')
const TICKET = join(HERE, '../../../../examples/sample-service/tickets/DEMO-1.json')
const skip = process.env.QC_E2E === '1' ? false : 'end to end: set QC_E2E=1 (with Python and pytest installed)'
const LONG = 5 * 60 * 1000

const PRICING = `"""Order pricing before VAT: line totals, the subtotal and the volume discount, in whole cents."""
from decimal import ROUND_HALF_UP, Decimal

DISCOUNT_THRESHOLD_CENTS = 10000
DISCOUNT_PERCENT = 10


def _cents(euros):
    return int((Decimal(str(euros)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _line_cents(line):
    quantity = line["quantity"]
    if not isinstance(quantity, int) or quantity < 1:
        raise ValueError(f"quantity must be a whole number of 1 or more, not {quantity}")
    return _cents(line["unit_price"]) * quantity


def line_total(line):
    return _line_cents(line) / 100


def order_total(lines):
    subtotal = sum(_line_cents(line) for line in lines)
    discount = round(subtotal * DISCOUNT_PERCENT / 100) if subtotal >= DISCOUNT_THRESHOLD_CENTS else 0
    return {"subtotal": subtotal / 100, "discount": discount / 100, "total": (subtotal - discount) / 100}
`

const GREEN = `import pytest

from app.pricing import line_total, order_total


class TestOrderTotal:
    """DEMO-1 Order total applies a 10% volume discount from 100.00"""

    def test_line_total(self):
        line = {"sku": "A-1", "unit_price": 4.50, "quantity": 3}

        total = line_total(line)

        assert total == 13.50

    def test_order_below_the_discount_threshold(self):
        lines = [{"sku": "A-1", "unit_price": 4.50, "quantity": 3}, {"sku": "B-2", "unit_price": 20.00, "quantity": 2}]

        order = order_total(lines)

        assert order["discount"] == 0.00
        assert order["total"] == 53.50

    def test_order_just_below_the_discount_threshold(self):
        order = order_total([{"sku": "C-3", "unit_price": 33.33, "quantity": 3}])

        assert order["discount"] == 0.00
        assert order["total"] == 99.99

    def test_order_exactly_at_the_discount_threshold(self):
        order = order_total([{"sku": "D-4", "unit_price": 25.00, "quantity": 4}])

        assert order["discount"] == 10.00
        assert order["total"] == 90.00

    def test_order_above_the_discount_threshold(self):
        lines = [{"sku": "E-5", "unit_price": 60.00, "quantity": 1}, {"sku": "F-6", "unit_price": 12.50, "quantity": 4}]

        order = order_total(lines)

        assert order == {"subtotal": 110.00, "discount": 11.00, "total": 99.00}

    def test_quantity_of_zero(self):
        line = {"sku": "A-1", "unit_price": 4.50, "quantity": 0}

        with pytest.raises(ValueError, match="quantity must be a whole number of 1 or more, not 0"):
            line_total(line)
`

// The same tests with their values taken out: every assertion still passes, none binds the ticket.
const HOLLOW = `from app.pricing import line_total, order_total


class TestOrderTotal:
    """DEMO-1 Order total applies a 10% volume discount from 100.00"""

    def test_line_total(self):
        total = line_total({"sku": "A-1", "unit_price": 4.50, "quantity": 3})

        assert total is not None

    def test_order_below_the_discount_threshold(self):
        order = order_total([{"sku": "A-1", "unit_price": 4.50, "quantity": 3}])

        assert order["total"] > 0

    def test_order_above_the_discount_threshold(self):
        order = order_total([{"sku": "E-5", "unit_price": 60.00, "quantity": 2}])

        assert True
`

const CONFIG = { version: 1, adapter: 'pytest', jira: { site: 'https://example.atlassian.net', projects: ['DEMO'] }, pytest: { layers: [{ name: 'unit', folder: 'tests/' }] } }
const SPEC = 'tests/test_pricing_demo_1.py'

function sample(spec, pricing = PRICING) {
  const d = mkdtempSync(join(tmpdir(), 'qc-e2e-py-'))
  const put = (p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
  put('.claude/quality-code.json', JSON.stringify(CONFIG, null, 2))
  put('app/__init__.py', '')
  put('app/pricing.py', pricing)
  put('pyproject.toml', '[tool.pytest.ini_options]\npythonpath = ["."]\n')
  put(SPEC, spec)
  mkdirSync(join(d, 'tickets'))
  cpSync(TICKET, join(d, 'tickets/DEMO-1.json'))
  const g = (...a) => execFileSync('git', a, { cwd: d, env: ENV, stdio: 'ignore' })
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g('commit', '-qm', 'sample')
  return d
}

function pipeline(root) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [CLI, SPEC, '--key', 'DEMO-1', '--ticket', '@tickets/DEMO-1.json', '--json'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, QC_NO_AUDIT: '1' }, encoding: 'utf8', timeout: LONG })
  const seconds = ((Date.now() - t0) / 1000).toFixed(1)
  let outcome = null
  try { outcome = JSON.parse(r.stdout.trim().split('\n').at(-1)) } catch {}
  assert.ok(outcome, `no JSON outcome (exit ${r.status}): ${r.stderr || r.stdout}`)
  const step = name => outcome.steps.find(s => s.check === name)
  const card = `${outcome.verdict} in ${seconds}s, decided by ${outcome.decidedBy ?? '-'}: ${outcome.steps.map(s => `${s.check}=${s.status}`).join(' ')}`
  return { code: r.status, outcome, step, card }
}

// The project holds what it held: no report, cache, bytecode or temp mutant left behind.
const clean = root => {
  assert.deepEqual(readdirSync(join(root, 'tests')), ['test_pricing_demo_1.py'])
  assert.deepEqual(readdirSync(root).filter(f => !['.claude', '.git', 'app', 'pyproject.toml', 'tests', 'tickets'].includes(f)), [])
  assert.deepEqual(readdirSync(join(root, 'app')).sort(), ['__init__.py', 'pricing.py'])
}

test('pytest: the DEMO-1 spec is green, every mutant killed', { skip, timeout: LONG }, t => {
  const d = sample(GREEN)
  try {
    const r = pipeline(d)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'green', r.card)
    assert.equal(r.code, 0)
    assert.equal(r.step('tests').data.passed, 6)
    assert.equal(r.step('expected').status, 'pass', r.step('expected').summary)
    const m = r.step('mutation')
    assert.equal(m.status, 'pass', m.summary)
    assert.deepEqual([m.data.killed, m.data.total], [9, 9])
    assert.equal(r.step('types').data.applicable, false)
    assert.equal(r.step('stryker').data.applicable, false)
    clean(d)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('pytest: a hollow DEMO-1 spec fails the checks on the values', { skip, timeout: LONG }, t => {
  const d = sample(HOLLOW)
  try {
    const r = pipeline(d)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'checks_failed', r.card)
    assert.equal(r.code, 1)
    assert.equal(r.step('tests').status, 'pass')
    assert.equal(r.outcome.decidedBy, 'expected')
    assert.ok(r.step('expected').data.missing.includes('13.50'), r.step('expected').summary)
    clean(d)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('pytest: a discount bug makes the DEMO-1 spec red', { skip, timeout: LONG }, t => {
  const d = sample(GREEN, PRICING.replace('subtotal >= DISCOUNT_THRESHOLD_CENTS', 'subtotal > DISCOUNT_THRESHOLD_CENTS'))
  try {
    const r = pipeline(d)
    t.diagnostic(r.card)
    assert.equal(r.outcome.verdict, 'tests_red', r.card)
    assert.equal(r.outcome.decidedBy, 'tests')
    const tests = r.step('tests')
    assert.deepEqual({ passed: tests.data.passed, failed: tests.data.failed }, { passed: 5, failed: 1 })
    assert.deepEqual(tests.findings.map(f => f.test), ['test_order_exactly_at_the_discount_threshold'])
    assert.equal(r.step('mutation').status, 'pass', r.step('mutation').summary)
    clean(d)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})
