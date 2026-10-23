// The pytest dialect: test functions and classes, marks, key blocks by docstring, assertions, mutants,
// and the shared checks reading a Python spec through it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as py from '../../../lib/base/dialects/pytest.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { anchorRange, grade, groups, scoreSpec } from '../../../lib/pipeline/checks/suite-honesty.mjs'
import { applyMutant, planMutants, unmutated } from '../../../lib/pipeline/checks/mutation.mjs'
import { scanDiff } from '../../../lib/pipeline/checks/honesty.mjs'
import { surface, run as expectedRun } from '../../../lib/pipeline/checks/expected.mjs'

const SPEC = `import pytest

from app.pricing import line_total, order_total


@pytest.fixture
def lines():
    return [{"unit_price": 4.50, "quantity": 3}]


class TestOrderTotal:
    """ABC-1 Order total: the shop's volume discount"""

    def test_line_total(self):
        # assert in a comment is no assertion
        total = line_total({"unit_price": 4.50, "quantity": 3})

        assert total == 13.50, "the line total"

    @pytest.mark.parametrize(
        "quantity, total",
        [(1, 4.50), (3, 13.50)],
    )
    def test_cases(self, quantity, total):
        assert line_total({"unit_price": 4.50, "quantity": quantity}) == pytest.approx(total)

    @pytest.mark.skipif(True, reason="ABC-9 later")
    def test_skipped(self):
        assert 1

    @pytest.mark.xfail(reason="not pinned down", strict=True)
    async def test_not_yet(self):
        pass

    def test_skipped_in_body(self):
        pytest.skip("ABC-9 later")

    def test_status(self):
        order = order_total([])

        assert order["status"] is True
        assert "shipped" not in order["flags"]

    def test_zero(self):
        with pytest.raises(ValueError, match="quantity must be 1 or more"):
            line_total({"unit_price": 4.50, "quantity": 0})

    def test_hollow(self):
        text = "assert 1"


@pytest.mark.skip(reason="ABC-9")
class TestSkipped:
    def test_inside(self):
        assert 1


class TestOther:
    """
    ABC-2 Another ticket
    """

    class TestNested:
        def test_line_total(self):
            assert line_total({"unit_price": 1, "quantity": 2}) != 3


def test_top_level():
    assert order_total([])["total"] == 0
`

test('the registry hands out this dialect; a temp copy, not in place', () => {
  assert.equal(dialectFor('pytest'), py)
  assert.equal(py.mutation.inPlace, false)
  assert.equal(py.suite.notYet, 'xfail')
})

test('groups: every top-level class and function; a class titled by its docstring, a decorator chain kept', () => {
  assert.deepEqual(groups(SPEC, py).map(g => [g.mod, g.title]), [
    [null, 'lines'],
    [null, "ABC-1 Order total: the shop's volume discount"],
    ['skip', 'TestSkipped'],
    [null, 'ABC-2 Another ticket'],
    [null, 'test_top_level'],
  ])
  // Single-quoted and raw docstrings, a header comment, no docstring.
  const src = `class TestA:  # the first\n    r'''ABC-3 raw'''\n\nclass TestB(Base):\n    'ABC-4 single'\n\nclass TestC:\n    x = "ABC-5"\n`
  assert.deepEqual(groups(src, py).map(g => g.title), ['ABC-3 raw', 'ABC-4 single', 'TestC'])
})

test('key blocks: the docstring holds the key; the block ends at the next top-level class or function', () => {
  const [a, b] = anchorRange(SPEC, 'ABC-1', py)
  const block = SPEC.slice(a, b)
  assert.match(block, /^class TestOrderTotal:/)
  assert.ok(block.includes('def test_hollow') && !block.includes('class TestSkipped'))
  const [c, d] = anchorRange(SPEC, 'ABC-2', py)
  assert.ok(SPEC.slice(c, d).includes('class TestNested') && !SPEC.slice(c, d).includes('test_top_level'))
  assert.equal(anchorRange(SPEC, 'ABC-12', py), null)
  assert.deepEqual([...py.classTitles(SPEC)], [['TestOrderTotal', "ABC-1 Order total: the shop's volume discount"], ['TestSkipped', 'TestSkipped'], ['TestOther', 'ABC-2 Another ticket']])
})

test('tests and their marks: skip and skipif, xfail, a skip call in the body, parametrize; async tests too', () => {
  assert.deepEqual(scoreSpec(SPEC, py).map(t => [t.title, t.mod, t.expects]), [
    ['test_line_total', null, 1],
    ['test_cases', 'parametrize', 1],
    ['test_skipped', 'skip', 1],
    ['test_not_yet', 'xfail', 0],
    ['test_skipped_in_body', 'skip', 0],
    ['test_status', null, 2],
    ['test_zero', null, 1],
    ['test_hollow', null, 0],
    ['test_inside', 'skip', 1],
    ['test_line_total', null, 1],
    ['test_top_level', null, 1],
  ])
  // A def that is no test, and a helper decorated like a test, are not tests.
  assert.deepEqual(scoreSpec('@pytest.fixture\ndef test_data():\n    return 1\n\ndef helper():\n    assert 1\n', py).map(t => t.title), ['test_data'])
})

test('where each test is, for node ids: its classes, nested ones too; a function inside a test is none', () => {
  assert.deepEqual(py.locate(SPEC).filter(t => t.name === 'test_line_total'), [
    { name: 'test_line_total', classes: ['TestOrderTotal'] },
    { name: 'test_line_total', classes: ['TestOther', 'TestNested'] },
  ])
  assert.deepEqual(py.locate('def test_a():\n    def test_inner():\n        pass\n'), [{ name: 'test_a', classes: [] }])
})

test('suite honesty on a Python spec: a test with no assert is hollow; skips and xfail are exempt', () => {
  const r = grade([{ path: 'tests/test_order.py', src: SPEC }], { key: 'ABC-1' }, py)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings.map(f => f.test), ['test_hollow'])
  assert.deepEqual({ tests: r.data.tests, withAssertion: r.data.withAssertion, todo: r.data.todo, skipped: r.data.skipped }, { tests: 8, withAssertion: 4, todo: 1, skipped: 2 })
  assert.equal(grade([{ path: 'tests/test_order.py', src: SPEC }], { key: 'ABC-2' }, py).status, 'pass')
})

test('assertions: assert statements to the end of their logical line, raises blocks, the rest counted only', () => {
  const src = 'x = 1  # assert no\nassert (a ==\n    b), "msg"\nif ok: assert c in d\nassert e == \\\n    1\nwith pytest.raises(KeyError):\n    f()\nself.assertEqual(g, 1)\npytest.fail("no")\ns = "assert h"\n'
  assert.deepEqual(py.assertions(src).map(a => [a.kind, src.slice(a.start, a.end), a.expr && src.slice(...a.expr).trim()]), [
    ['assert', 'assert (a ==\n    b), "msg"', '(a ==\n    b)'],
    ['assert', 'assert c in d', 'c in d'],
    ['assert', 'assert e == \\\n    1', 'e == \\\n    1'],
    ['raises', 'pytest.raises(KeyError)', 'pytest.raises(KeyError)'],
    ['other', '.assertEqual(g, 1)', null],
    ['other', 'pytest.fail("no")', null],
  ])
  assert.equal(py.countAssertions(src), 6)
})

test('flips: invert first, then the comparison, True/False, the compared number and string', () => {
  const kinds = t => py.flipMutations(t).map(f => [f.kind, f.text])
  assert.deepEqual(kinds('assert total([40, 40]) == 72, "the total"'), [
    ['invert-assert', 'assert not (total([40, 40]) == 72), "the total"'],
    ['flip-compare', 'assert total([40, 40]) != 72, "the total"'],
    ['num→n+1', 'assert total([40, 40]) == 73, "the total"'],
  ])
  assert.deepEqual(kinds('assert order["paid"] is True'), [
    ['invert-assert', 'assert not (order["paid"] is True)'],
    ['true→false', 'assert order["paid"] is False'],
    ['flip-compare', 'assert order["paid"] is not True'],
  ])
  assert.deepEqual(kinds("assert 'shipped' not in flags").map(([k]) => k), ['invert-assert', 'flip-compare', 'corrupt-string'])
  assert.equal(py.flipMutations("assert 'shipped' not in flags")[2].text, "assert 'shipped★MUT' not in flags")
  assert.equal(py.flipMutations('assert a <= 3')[1].text, 'assert a > 3')
  assert.equal(py.flipMutations('assert a is not None')[1].text, 'assert a is None')
  assert.equal(py.flipMutations('assert a in b')[1].text, 'assert a not in b')
  // A bytes literal is never corrupted (a non-ASCII byte does not compile); a subscript key is no expected value.
  assert.deepEqual(py.flipMutations('assert data[b"k"] == b"v"').map(f => f.kind), ['invert-assert', 'flip-compare'])
  assert.deepEqual(py.flipMutations('assert ok').map(f => f.kind), ['invert-assert'])
  assert.deepEqual(py.flipMutations('pytest.raises(ValueError, match="x")'), [{ kind: 'drop-raises', text: '__import__("contextlib").nullcontext()' }])
})

test('plan: one mutant per assertion of a baseline-green test, parametrized cases included; skipped and xfail never', () => {
  const passed = ['test_line_total', 'test_cases[1-4.5]', 'test_cases[3-13.5]', 'test_status', 'test_zero', 'test_top_level']
  const ms = planMutants(SPEC, passed, { key: 'ABC-1' }, py)
  assert.deepEqual(ms.map(m => [m.title, m.kind]), [
    ['test_line_total', 'invert-assert'],
    ['test_cases', 'invert-assert'],
    ['test_status', 'invert-assert'],
    ['test_status', 'invert-assert'],
    ['test_zero', 'drop-raises'],
  ])
  assert.equal(applyMutant(SPEC, ms[0]).includes('assert not (total == 13.50), "the line total"'), true)
  assert.ok(planMutants(SPEC, passed, { key: 'ABC-1', thorough: true }, py).length > ms.length)
  // A green test with no assertion mutation can flip is unmutated; a test that did not pass is not judged.
  const src = 'class TestA:\n    """ABC-5 x"""\n\n    def test_a(self):\n        self.assertEqual(1, 1)\n\n    def test_b(self):\n        assert 1\n'
  assert.deepEqual(unmutated(src, ['test_a'], planMutants(src, ['test_a'], {}, py), {}, py), ['test_a'])
  assert.equal(planMutants(SPEC, passed, { key: 'ABC-7' }, py), null)
})

test('the value check reads the assert expressions of the block, not their messages; actual leaves out inputs', () => {
  const block = 'class TestA:\n    """ABC-1 x"""\n\n    def test_a(self):\n        assert total([40, 40]) == 72, "not 99"  # 98\n        assert order == {"total": 53.50}\n        with pytest.raises(ValueError, match="too big"):\n            f(1)\n'
  assert.equal(surface(block, 'ABC-1', py), ' total([40, 40]) == 72\n order == {"total": 53.50}\npytest.raises(ValueError, match="too big")')
  assert.equal(surface(block, 'ABC-1', py, { actual: false }), ' total(        ) == 72\n order == {"total": 53.50}\npytest.raises(ValueError, match="too big")')
  assert.equal(surface(block, 'ABC-9', py), null)
  // Through the check: the ticket's values and field are asserted; a value only in a message is not.
  const ticket = { key: 'ABC-1', summary: 's', text: { description: '', acField: 'Scenario: a\nGiven 40\nWhen totalled\nThen the total is 72\nAnd it fails with "too big"\nAnd the unit_cost is 53.50' } }
  const d = mkdtempSync(join(tmpdir(), 'qc-py-expected-'))
  mkdirSync(join(d, 'tests'))
  const check = src => { writeFileSync(join(d, 'tests/test_a.py'), src); return expectedRun({ specs: ['tests/test_a.py'], key: 'ABC-1', ticket }, { root: d, dialect: py, config: { languages: ['en'] } }) }
  const ok = check(block.replace('"total"', '"unit_cost"'))
  assert.equal(ok.status, 'pass', ok.summary)
  const bad = check(block.replace('"total"', '"unit_cost"').replace('== 72, "not 99"', '> 0, "should be 72"'))
  assert.equal(bad.status, 'fail')
  assert.deepEqual(bad.data.missing, ['72'])
})

test('honesty on a Python diff: a removed assert or test, a new skip mark without a key', () => {
  const diff = [
    '+++ b/tests/test_order.py',
    '-        assert total == 72',
    '-    def test_total(self):',
    '+    @pytest.mark.skipif(sys.platform == "win32", reason="flaky")',
    '+    @pytest.mark.xfail',
    '+    @pytest.mark.skip(reason="ABC-9 waits for the API")',
    '+        pytest.skip("later")',
    '+    def test_new(self):',
    '+        assert total == 80',
  ].join('\n')
  const v = scanDiff(diff, py, '(?:ABC)-\\d+')
  assert.deepEqual(v.map(x => [x.kind, x.line]), [
    ['assertion removed', 'assert total == 72'],
    ['test removed', 'def test_total(self):'],
    ['test newly skipped', '@pytest.mark.skipif(sys.platform == "win32", reason="flaky")'],
    ['test newly skipped', '@pytest.mark.xfail'],
    ['test newly skipped', 'pytest.skip("later")'],
  ])
})
