// The Go dialect as the shared checks read it: scenarios, skips, the key block, assertions, the
// flips (the if comparison among them), the mutation plan, honesty and the value check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { countAssertions, flipMutations, goName, marks, mask, ranges, scan } from '../../../lib/base/dialects/go.mjs'
import { anchorRange, grade } from '../../../lib/pipeline/checks/suite-honesty.mjs'
import { planMutants, run as mutationRun, unmutated } from '../../../lib/pipeline/checks/mutation.mjs'
import { scanDiff } from '../../../lib/pipeline/checks/honesty.mjs'
import { run as expectedRun, surface } from '../../../lib/pipeline/checks/expected.mjs'
import { REORDER } from '../runners/go-fixtures/reorder.mjs'

const GO = dialectFor('go')
const KEYS = '(?:ABC)-\\d+'

const TWO_BLOCKS = `package orders

import "testing"

// ABC-7 Stock is never negative
func TestStock(t *testing.T) {
	t.Run("a sale of 3 leaves 2", func(t *testing.T) {
		if got := Sell(5, 3); got != 2 {
			t.Errorf("Sell(5, 3) = %d, want 2", got)
		}
	})

	t.Run("a sale over the stock is refused", func(t *testing.T) {
		_, err := SellChecked(1, 3)

		if !errors.Is(err, ErrNoStock) {
			t.Fatalf("err = %v, want ErrNoStock", err)
		}
	})

	t.Run("hollow", func(t *testing.T) {
		Sell(1, 1) // t.Errorf("in a comment")
		_ = "t.Fatal(in a string)"
	})
}

// ABC-8 Prices round to the cent
func TestRound(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	if got := Round(10.005); got != 10.01 {
		t.Errorf("got %v", got)
	}
}

func TestSkipped(t *testing.T) {
	t.Skip("ABC-9 flaky on CI")
	if Round(1) != 1 {
		t.Error("no")
	}
}
`

test('marks: a literal t.Run is a scenario; a function without one is its own; table cases fold in', () => {
  assert.deepEqual(marks(REORDER).map(m => [m.title, m.mod]), [
    ['stock of 4 reorders', null], ['stock of 5 does not', null], ['later', 'todo'], ['TestTable', null],
  ])
  const all = marks(TWO_BLOCKS)
  assert.deepEqual(all.map(m => [m.title, m.mod]), [
    ['a sale of 3 leaves 2', null], ['a sale over the stock is refused', null], ['hollow', null],
    // A skip under a condition (testing.Short) still runs: no skip.
    ['TestRound', null], ['TestSkipped', 'skip'],
  ])
  // Each scenario ends where its t.Run call does.
  const first = all[0]
  assert.ok(TWO_BLOCKS.slice(first.idx, first.end).startsWith('t.Run("a sale of 3 leaves 2"'))
  assert.ok(TWO_BLOCKS.slice(first.idx, first.end).endsWith('})'))
})

test('scan: the group is the doc comment (where the key is), else the function name', () => {
  assert.deepEqual(scan(TWO_BLOCKS).map(f => f.group), ['ABC-7 Stock is never negative', 'ABC-8 Prices round to the cent', 'TestSkipped'])
  // Nested t.Run is part of its parent scenario, not one of its own.
  const nested = 'package x\n\nimport "testing"\n\nfunc TestN(t *testing.T) {\n\tt.Run("outer", func(t *testing.T) {\n\t\tt.Run("inner", func(t *testing.T) {\n\t\t\tassert.True(t, ok())\n\t\t})\n\t})\n}\n'
  assert.deepEqual(marks(nested).map(m => m.title), ['outer'])
})

test('goName: spaces become underscores as go test names subtests', () => {
  assert.equal(goName('stock of 4\treorders'), 'stock_of_4_reorders')
  assert.equal(goName('a/b'), 'a/b')
})

test('mask: comments and string insides are blanked, lengths kept', () => {
  const src = 'a := "t.Errorf(x)" // t.Fatal()\nb := `raw\nt.Error()` /* t.Fail() */'
  const m = mask(src)
  assert.equal(m.length, src.length)
  assert.doesNotMatch(m, /Errorf|Fatal|Error\(|Fail/)
  assert.equal(m.split('\n').length, src.split('\n').length)
})

test('the key block: the function whose doc comment holds the key, up to the next test function', () => {
  const r = anchorRange(TWO_BLOCKS, 'ABC-7', GO)
  const block = TWO_BLOCKS.slice(r[0], r[1])
  assert.ok(block.startsWith('// ABC-7 Stock is never negative\nfunc TestStock'))
  assert.ok(!block.includes('TestRound'))
  assert.ok(TWO_BLOCKS.slice(...anchorRange(TWO_BLOCKS, 'ABC-8', GO)).startsWith('// ABC-8'))
  assert.equal(anchorRange(TWO_BLOCKS, 'ABC-70', GO), null)
})

test('countAssertions: testify calls and failure reports; not in comments, strings, log or assert.New', () => {
  assert.equal(countAssertions('assert.Equal(t, 1, x)\nrequire.NoError(t, err)\nif x { t.Errorf("x") }\nt.FailNow()'), 4)
  assert.equal(countAssertions('a := assert.New(t)\nlog.Fatal("x")\n// t.Errorf("x")\n_ = "assert.True(t, x)"'), 0)
})

test('suite honesty: a hollow scenario fails the key block; skips and todos are counted, not graded', () => {
  const r = grade([{ path: 'stock_test.go', src: TWO_BLOCKS }], { key: 'ABC-7' }, GO)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings.map(f => f.test), ['hollow'])
  assert.equal(r.data.tests, 3)
  const all = grade([{ path: 'r_test.go', src: REORDER }], {}, GO)
  assert.equal(all.status, 'pass', all.summary)
  assert.deepEqual([all.data.tests, all.data.withAssertion, all.data.todo], [4, 3, 1])
  assert.equal(grade([{ path: 's_test.go', src: TWO_BLOCKS }], { key: 'ABC-99' }, GO).status, 'not_run')
})

test('ranges: testify calls whole, an if only up to its "{", and only when its own block reports', () => {
  const src = `func TestX(t *testing.T) {
	require.NoError(t, err)
	if len(got) == 3 {
		if got[0] != 1 {
			t.Errorf("first %d", got[0])
		}
	}
	if err != nil { return }
}`
  assert.deepEqual(ranges(src).map(r => src.slice(r.start, r.end)), ['require.NoError(t, err)', 'if got[0] != 1 '])
})

test('flips: testify opposites, f variants, require, the expected number and string', () => {
  const kinds = s => flipMutations(s).map(f => [f.kind, f.text])
  assert.deepEqual(kinds('assert.Equal(t, 108, Total(items))'), [['invert-assert', 'assert.NotEqual(t, 108, Total(items))'], ['num→n+1', 'assert.Equal(t, 109, Total(items))']])
  assert.deepEqual(kinds('require.True(t, ok)'), [['invert-assert', 'require.False(t, ok)']])
  assert.equal(flipMutations('assert.Nil(t, err)')[0].text, 'assert.NotNil(t, err)')
  assert.equal(flipMutations('assert.NotNil(t, err)')[0].text, 'assert.Nil(t, err)')
  assert.equal(flipMutations('assert.Contains(t, msg, "sold out")')[0].text, 'assert.NotContains(t, msg, "sold out")')
  assert.equal(flipMutations('assert.ErrorIs(t, err, ErrNoStock)')[0].text, 'assert.NotErrorIs(t, err, ErrNoStock)')
  assert.equal(flipMutations('assert.EqualValues(t, 3, n)')[0].text, 'assert.NotEqualValues(t, 3, n)')
  assert.equal(flipMutations('assert.Equalf(t, 3, n, "count %d", n)')[0].text, 'assert.NotEqualf(t, 3, n, "count %d", n)')
  assert.deepEqual(kinds('assert.Len(t, lines, 3)'), [['num→n+1', 'assert.Len(t, lines, 4)']])
  assert.deepEqual(kinds('assert.Equal(t, "Reorder", status)').at(-1), ['corrupt-string', 'assert.Equal(t, "Reorder★MUT", status)'])
  // A raw string literal is a value too; its inside is no number to change.
  assert.deepEqual(kinds('assert.JSONEq(t, `{"a":1}`, body)'), [['corrupt-string', 'assert.JSONEq(t, `{"a":1}★MUT`, body)']])
})

test('flips of an if: the comparison inverted, a negation dropped, a compound negated', () => {
  const first = s => flipMutations(s)[0]
  assert.deepEqual(first('if got != want '), { kind: 'flip-compare', text: 'if got == want ' })
  assert.deepEqual(first('if got := Sell(5, 3); got != 2 '), { kind: 'flip-compare', text: 'if got := Sell(5, 3); got == 2 ' })
  assert.equal(first('if n < 3 ').text, 'if n >= 3 ')
  assert.equal(first('if n >= 3 ').text, 'if n < 3 ')
  assert.equal(first('if n > 3 ').text, 'if n <= 3 ')
  assert.deepEqual(first('if !ok '), { kind: 'drop-not', text: 'if ok ' })
  assert.deepEqual(first('if !errors.Is(err, ErrNoStock) '), { kind: 'drop-not', text: 'if errors.Is(err, ErrNoStock) ' })
  assert.deepEqual(first('if a != 1 || b != 2 '), { kind: 'negate-if', text: 'if !(a != 1 || b != 2) ' })
  assert.deepEqual(first('if diff := cmp.Diff(want, got); diff != "" '), { kind: 'flip-compare', text: 'if diff := cmp.Diff(want, got); diff == "" ' })
  // The number on the right of the comparison, not an index on its left.
  assert.deepEqual(flipMutations('if got[0] != 108 ').find(f => f.kind === 'num→n+1').text, 'if got[0] != 109 ')
  assert.deepEqual(flipMutations('if got != "Reorder" ').find(f => f.kind === 'corrupt-string').text, 'if got != "Reorder★MUT" ')
  // A comparison inside a call is an argument, not the condition's.
  assert.deepEqual(first('if !check(a == b) ').kind, 'drop-not')
})

test('plan: one mutant per assertion (the strongest), green scenarios only, inside the key block', () => {
  const passed = ['a sale of 3 leaves 2', 'a sale over the stock is refused', 'hollow', 'TestRound', 'TestSkipped']
  const all = planMutants(TWO_BLOCKS, passed, {}, GO)
  assert.deepEqual(all.map(m => [m.title, m.kind]), [
    ['a sale of 3 leaves 2', 'flip-compare'], ['a sale over the stock is refused', 'drop-not'], ['TestRound', 'flip-compare'],
  ])
  const own = planMutants(TWO_BLOCKS, passed, { key: 'ABC-7' }, GO)
  assert.deepEqual(own.map(m => m.title), ['a sale of 3 leaves 2', 'a sale over the stock is refused'])
  assert.ok(planMutants(TWO_BLOCKS, passed, { thorough: true }, GO).length > all.length)
  assert.equal(planMutants(TWO_BLOCKS, passed, { key: 'ABC-99' }, GO), null)
  // The hollow scenario passes with no assertion: not mutated, so the step cannot pass.
  assert.deepEqual(unmutated(TWO_BLOCKS, passed, own, { key: 'ABC-7' }, GO), ['hollow'])
  // A testify spec: the Equal is inverted; the todo is never planned.
  assert.deepEqual(planMutants(REORDER, ['stock of 4 reorders', 'stock of 5 does not', 'later', 'TestTable'], {}, GO).map(m => [m.title, m.replacement]), [
    ['stock of 4 reorders', 'assert.NotEqual(t, 20, got)'], ['stock of 5 does not', 'if got := Reorder(5); got == 0 '], ['TestTable', 'if Valid(tc.in) '],
  ])
})

test('mutation in place on a Go spec: each mutant runs from the spec itself, which comes back byte for byte', async () => {
  const d = mkdtempSync(join(tmpdir(), 'qc-go-mut-'))
  mkdirSync(join(d, 'orders'))
  const spec = 'orders/stock_test.go'
  writeFileSync(join(d, spec), TWO_BLOCKS)
  const seen = []
  // A mutant is killed when its flipped condition is in the file the run reads.
  const runTests = async ({ files, testName }) => {
    const now = readFileSync(join(d, files[0]), 'utf8')
    seen.push(testName)
    const titles = testName ? [testName] : ['a sale of 3 leaves 2', 'a sale over the stock is refused', 'hollow']
    return { ran: true, broken: [], tests: titles.map(title => ({ title, path: ['ABC-7 Stock is never negative'], file: files[0], status: testName && now !== TWO_BLOCKS ? 'failed' : 'passed' })) }
  }
  const r = await mutationRun({ spec, key: 'ABC-7' }, { root: d, dialect: GO, runTests, config: { adapter: 'go' } })
  assert.equal(r.status, 'not_run', 'the hollow scenario keeps it from passing')
  assert.equal(r.data.killed, 2)
  assert.equal(r.data.unmutated, 1)
  assert.deepEqual(seen.slice(1), ['a sale of 3 leaves 2', 'a sale over the stock is refused'])
  assert.equal(readFileSync(join(d, spec), 'utf8'), TWO_BLOCKS)
})

test('honesty: a removed assertion or test, a new skip without a ticket; a todo or a tracked skip is fine', () => {
  const v = s => scanDiff(`+++ b/orders/stock_test.go\n${s}`, GO, KEYS).map(x => x.kind)
  assert.deepEqual(v('-\t\tassert.Equal(t, 20, got)'), ['assertion removed'])
  assert.deepEqual(v('-\t\t\tt.Errorf("Sell(5, 3) = %d, want 2", got)'), ['assertion removed'])
  assert.deepEqual(v('-func TestStock(t *testing.T) {'), ['test removed'])
  assert.deepEqual(v('-\tt.Run("a sale of 3 leaves 2", func(t *testing.T) {'), ['test removed'])
  assert.deepEqual(v('+\t\tt.Skip("flaky")'), ['test newly skipped'])
  assert.deepEqual(v('+\t\tt.Skipf("broken on %s", runtime.GOOS)'), ['test newly skipped'])
  assert.deepEqual(v('+\t\tt.Skip("ABC-9 flaky on CI")'), [])
  assert.deepEqual(v('+\t\tt.Skip("todo: the ticket does not say")'), [])
  assert.deepEqual(v('-\t\tlog.Println(err.Error())\n+\t\tfmt.Println(err.Error())'), [])
})

test('expected values: read in testify arguments and in if conditions of the key block', () => {
  const s = surface(TWO_BLOCKS, 'ABC-7', GO)
  assert.match(s, /got != 2/)
  assert.match(s, /errors\.Is\(err, ErrNoStock\)/)
  assert.doesNotMatch(s, /10\.01/)
  assert.match(surface(REORDER, 'ABC-12', GO), /assert\.Equal\(t, 20, got\)/)
  // A table's rows are its expected values.
  const table = '// ABC-5 VAT\nfunc TestVAT(t *testing.T) {\n\tt.Run("half a cent rounds up", func(t *testing.T) {\n\t\tcases := []struct {\n\t\t\tnet, want string\n\t\t}{\n\t\t\t{net: "10.05", want: "2.21"},\n\t\t}\n\t\tfor _, tc := range cases {\n\t\t\tassert.Equal(t, tc.want, VAT(tc.net))\n\t\t}\n\t})\n}\n'
  assert.match(surface(table, 'ABC-5', GO), /want: "2\.21"/)
  const d = mkdtempSync(join(tmpdir(), 'qc-go-exp-'))
  writeFileSync(join(d, 'stock_test.go'), TWO_BLOCKS)
  const ticket = { key: 'ABC-7', summary: 'Stock', text: { description: '', acField: 'Scenario: sale\nGiven a stock of 5\nWhen 3 are sold\nThen the stock is 2\n\nScenario: too many\nGiven a stock of 1\nWhen 3 are sold\nThen the sale is refused with "no stock"' } }
  const r = expectedRun({ specs: ['stock_test.go'], key: 'ABC-7', ticket }, { root: d, dialect: GO, config: { languages: ['en'] } })
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.data.missing, ['no stock'])
})
