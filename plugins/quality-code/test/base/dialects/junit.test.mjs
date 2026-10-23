// The JUnit dialect (Java and Kotlin): test marks, skips and todos, key blocks, assertions, honesty,
// the value check's surface, and the mutants of each assertion style.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as junit from '../../../lib/base/dialects/junit.mjs'
import { dialectFor } from '../../../lib/base/dialects/index.mjs'
import { anchorRange, grade, groups, scoreSpec, skippedGroupRanges } from '../../../lib/pipeline/checks/suite-honesty.mjs'
import { planMutants, run as mutationRun, unmutated } from '../../../lib/pipeline/checks/mutation.mjs'
import { scanDiff } from '../../../lib/pipeline/checks/honesty.mjs'
import { surface } from '../../../lib/pipeline/checks/expected.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../pipeline/runners/fixtures/junit')
const JAVA = readFileSync(join(FIX, 'LineTotalTest.java'), 'utf8')
const KT = readFileSync(join(FIX, 'TotalsTest.kt'), 'utf8')
const d = junit
const flips = (src, o) => junit.flipMutations(src, o).map(f => [f.kind, f.text])

test('the registry serves this dialect, in place', () => {
  assert.equal(dialectFor('junit'), junit)
  assert.equal(junit.mutation.inPlace, true)
})

test('Java: @Test, @ParameterizedTest and nested tests are marks titled by the method; @Disabled is a skip', () => {
  assert.deepEqual(scoreSpec(JAVA, d).map(t => [t.title, t.mod, t.expects]), [
    ['threeItems', null, 1], ['roundsHalfUp', null, 1], ['parsesSku', null, 1], ['discount', 'skip', 1], ['quantities', null, 1], ['zero', null, 1],
  ])
})

test('Kotlin: `names with spaces`, fun, @Disabled("TODO …") is not written yet', () => {
  assert.deepEqual(scoreSpec(KT, d).map(t => [t.title, t.mod, t.expects]), [
    ['sums three lines', null, 1], ['emptyOrder', null, 1], ['rounds the total', null, 1], ['logs the total', null, 0], ['refunds', 'todo', 0], ['refunds the full amount', null, 1],
  ])
})

test('JUnit 4: @Test from org.junit, @Ignore skips, public void', () => {
  const src = 'public class OldTest {\n  @Test(expected = IllegalStateException.class)\n  public void throwsOnEmpty() { Totals.of(); }\n\n  @Ignore\n  @Test\n  public void legacy() { Assert.assertEquals(1, 1); }\n\n  @org.junit.Test public void full() { assertTrue(ok()); }\n}\n'
  assert.deepEqual(scoreSpec(src, d).map(t => [t.title, t.mod, t.expects]), [['throwsOnEmpty', null, 0], ['legacy', 'skip', 1], ['full', null, 1]])
})

test('a mark in a comment or a string is no test of the structure', () => {
  const src = 'class ATest {\n  // @Test void old() {}\n  @Test void real() { assertTrue(x()); }\n}\n'
  assert.deepEqual(junit.structure(src).tests.map(t => t.title), ['real'])
})

test('groups: a top-level class titled by its @DisplayName; the key block runs to the next class', () => {
  assert.deepEqual(groups(KT, d).map(g => [g.title, g.mod]), [['ABC-14 Order totals', null], ['ABC-15 Refund totals', null]])
  const [a, b] = anchorRange(KT, 'ABC-14', d)
  assert.ok(KT.slice(a, b).includes('fun refunds()'))
  assert.ok(!KT.slice(a, b).includes('ABC-15'))
  assert.equal(anchorRange(KT, 'ABC-1', d), null)
  assert.deepEqual(groups(JAVA, d).map(g => g.title), ['ABC-12 Line totals round to the cent'])
})

test('a @Disabled class is a skipped group: none of its tests runs', () => {
  const src = '@Disabled("ABC-3 waits for the price list")\n@DisplayName("ABC-2 Totals")\npublic class TotalsTest {\n  @Test void a() { }\n}\n'
  assert.deepEqual(groups(src, d).map(g => g.mod), ['skip'])
  assert.equal(skippedGroupRanges(src, d).length, 1)
  assert.deepEqual(scoreSpec(src, d).map(t => t.mod), ['skip'])
})

test('structure: package, classes with their binary names and display names, each test\'s class', () => {
  const s = junit.structure(JAVA)
  assert.equal(s.pkg, 'demo.pricing')
  assert.deepEqual(s.classes.map(c => [c.binary, c.displayName]), [['LineTotalTest', 'ABC-12 Line totals round to the cent'], ['LineTotalTest$WhenEmpty', null]])
  assert.deepEqual(s.tests.map(t => [t.title, t.cls, t.displayName]), [
    ['threeItems', 'LineTotalTest', 'three at 4.50 make 13.50'], ['roundsHalfUp', 'LineTotalTest', 'half a cent "rounds" up & away'],
    ['parsesSku', 'LineTotalTest', null], ['discount', 'LineTotalTest', null], ['quantities', 'LineTotalTest', null], ['zero', 'LineTotalTest$WhenEmpty', null],
  ])
  // A Kotlin class without a body does not take the next class's braces.
  const k = junit.structure('package a\n\ndata class Line(val qty: Int)\n\nclass LineTest {\n  @Test fun one() { assertEquals(1, 1) }\n}\n')
  assert.deepEqual(k.tests.map(t => t.cls), ['LineTest'])
})

test('countAssertions: what asserts and what does not', () => {
  const n = junit.countAssertions
  assert.equal(n('assertEquals(1, x);'), 1)
  assert.equal(n('Assertions.assertTrue(ok);'), 1)
  assert.equal(n('assertThat(total).isEqualTo(108);'), 1)
  assert.equal(n('assertThat(total);'), 0, 'a bare AssertJ assertThat asserts nothing')
  assert.equal(n('assertThat(total, is(108));'), 1, 'Hamcrest')
  assert.equal(n('assertThatThrownBy(() -> f()).isInstanceOf(X.class);'), 1)
  assert.equal(n('// assertEquals(1, x);\nString s = "assertEquals(1, x)";'), 0)
  assert.equal(n('assumeTrue(ci());'), 0, 'an assumption only skips')
  assert.equal(n('verify(repo).save(order);'), 1)
  assert.equal(n('total shouldBe 108'), 1)
  assert.equal(n('assertFailsWith<IllegalStateException> { f() }'), 1)
  assert.equal(n('assert total == 108 : "total";'), 1)
  assert.equal(n('fail("unreachable");'), 1)
})

test('suite honesty grades a Kotlin block: a test with no assertion is hollow, a TODO is not', () => {
  const r = grade([{ path: 'TotalsTest.kt', src: KT }], { key: 'ABC-14' }, d)
  assert.equal(r.status, 'fail')
  assert.deepEqual(r.findings.map(f => f.test), ['logs the total'])
  assert.equal(r.data.todo, 1)
  assert.equal(grade([{ path: 'LineTotalTest.java', src: JAVA }], { key: 'ABC-12' }, d).status, 'pass')
})

const diff = lines => `diff --git a/T.java b/T.java\n--- a/T.java\n+++ b/T.java\n@@ -1,3 +1,3 @@\n${lines.join('\n')}\n`
const KEYS = '(?:ABC)-\\d+'

test('honesty: a removed assertion, a removed @Test, a new skip without a ticket', () => {
  const v = scanDiff(diff(['-    assertEquals(1350, LineTotal.cents(3, 450));', '-  @Test', '-    total shouldBe 108', '+  @Disabled("flaky")', '+    assumeTrue(ci());', '-class LineTotalTest {']), d, KEYS)
  assert.deepEqual(v.map(x => x.kind), ['assertion removed', 'test removed', 'assertion removed', 'test newly skipped', 'test newly skipped', 'test removed'])
})

test('honesty: a skip naming a ticket, a TODO and a helper class are allowed; the own key tracks nothing', () => {
  assert.deepEqual(scanDiff(diff(['+  @Disabled("ABC-99 upstream is down")', '+  @Disabled("TODO: the ticket does not say")', '-class Helper {']), d, KEYS), [])
  assert.equal(scanDiff(diff(['+  @Disabled("ABC-99 upstream is down")']), d, KEYS, { own: 'ABC-99' }).length, 1)
})

test('the value check reads JUnit arguments and AssertJ matchers in the key block, not comments', () => {
  const s = surface(JAVA, 'ABC-12', d)
  assert.match(s, /1350/)
  assert.match(s, /1001/)
  assert.match(s, /"A-1"/)
  assert.doesNotMatch(s, /B-2/)
  assert.equal(surface(JAVA, 'ABC-99', d), null)
})

test('flips: JUnit asserts invert, numbers and strings of the expected argument only', () => {
  assert.deepEqual(flips('assertEquals(1350, LineTotal.cents(3, 450));'), [
    ['invert-assert', 'assertNotEquals(1350, LineTotal.cents(3, 450));'], ['num→n+1', 'assertEquals(1351, LineTotal.cents(3, 450));']])
  assert.deepEqual(flips('assertEquals("A-1", Sku.parse("A-1/3").code());'), [
    ['invert-assert', 'assertNotEquals("A-1", Sku.parse("A-1/3").code());'], ['corrupt-string', 'assertEquals("A-1#MUT", Sku.parse("A-1/3").code());']])
  assert.deepEqual(flips('Assertions.assertTrue(ok);'), [['invert-assert', 'Assertions.assertFalse(ok);']])
  assert.deepEqual(flips('assertNull(x);'), [['invert-assert', 'assertNotNull(x);']])
  assert.deepEqual(flips('assertEquals(3L, n);').map(f => f[1]), ['assertNotEquals(3L, n);', 'assertEquals(4L, n);'])
  assert.deepEqual(flips('assertArrayEquals(new int[] {1, 2}, xs);'), [['num→n+1', 'assertArrayEquals(new int[] {2, 2}, xs);']])
})

test('flips: AssertJ inverts the first matcher and bumps its value, never the actual', () => {
  assert.deepEqual(flips('assertThat(LineTotal.cents(1, 1000.5)).isEqualTo(10.01);'), [
    ['invert-matcher', 'assertThat(LineTotal.cents(1, 1000.5)).isNotEqualTo(10.01);'], ['num→n+1', 'assertThat(LineTotal.cents(1, 1000.5)).isEqualTo(11.01);']])
  assert.deepEqual(flips('assertThat(t).isEqualTo(2.5f);')[1], ['num→n+1', 'assertThat(t).isEqualTo(3.5f);'])
  assert.deepEqual(flips('assertThat(ok).isTrue();'), [['invert-matcher', 'assertThat(ok).isFalse();']])
  assert.deepEqual(flips('assertThat(names).contains("Ann");')[0], ['invert-matcher', 'assertThat(names).doesNotContain("Ann");'])
  assert.deepEqual(flips('assertThat(lines).as("lines").hasSize(3);'), [['num→n+1', 'assertThat(lines).as("lines").hasSize(4);'], ['corrupt-string', 'assertThat(lines).as("lines#MUT").hasSize(3);']])
})

test('flips: Hamcrest wraps the matcher in not(…) by its full name; kotest toggles Not', () => {
  assert.deepEqual(flips('assertThat(x, is(3));'), [['invert-matcher', 'assertThat(x, org.hamcrest.CoreMatchers.not(is(3)));'], ['num→n+1', 'assertThat(x, is(4));']])
  assert.deepEqual(flips('total shouldBe 108'), [['invert-matcher', 'total shouldNotBe 108'], ['num→n+1', 'total shouldBe 109']])
  assert.deepEqual(flips('name.shouldNotBe("x")')[0], ['invert-matcher', 'name.shouldBe("x")'])
})

test('flips: assertThrows expects an exception nothing throws, only when its value is not kept', () => {
  assert.deepEqual(flips('assertThrows(IllegalStateException.class, () -> f("a"));'), [['swap-exception', 'assertThrows(java.lang.annotation.AnnotationFormatError.class, () -> f("a"));']])
  assert.deepEqual(flips('assertThrows(IllegalStateException.class, () -> f("a"));', { standalone: false }), [])
})

test('plan: one mutant per assertion of a green test; skipped, todo and commented-out ones get none', () => {
  const m = planMutants(JAVA, ['threeItems', 'roundsHalfUp', 'parsesSku', 'quantities', 'zero', 'discount'], {}, d)
  assert.deepEqual(m.map(x => [x.title, x.kind]), [['threeItems', 'invert-assert'], ['roundsHalfUp', 'invert-matcher'], ['parsesSku', 'invert-assert'], ['quantities', 'invert-assert'], ['zero', 'invert-assert']])
  assert.ok(planMutants(JAVA, ['threeItems'], { thorough: true }, d).length > 1)
})

test('plan on Kotlin: infix and dotted kotest, kotlin.test; a test with no assertion is not mutated', () => {
  const passed = ['sums three lines', 'emptyOrder', 'rounds the total', 'logs the total']
  const m = planMutants(KT, passed, { key: 'ABC-14' }, d)
  assert.deepEqual(m.map(x => [x.title, x.replacement.trim()]), [
    ['sums three lines', 'total shouldNotBe 108'], ['emptyOrder', 'kotlin.test.assertNotEquals(0, Totals.sum(emptyList()))'], ['rounds the total', 'Totals.round(10.005).shouldNotBe(10.01)']])
  assert.deepEqual(unmutated(KT, passed, m, { key: 'ABC-14' }, d), ['logs the total'])
})

test('the opposite assert is called the way the spec can: bare when imported, else by its full name', () => {
  const one = 'import static org.junit.jupiter.api.Assertions.assertEquals;\n\n@DisplayName("ABC-1 T")\nclass T {\n  @Test void a() {\n    assertEquals(3, f());\n    Assertions.assertTrue(ok());\n  }\n}\n'
  assert.deepEqual(planMutants(one, ['a'], {}, d).map(m => m.replacement), ['org.junit.jupiter.api.Assertions.assertNotEquals(3, f());', 'Assertions.assertFalse(ok());'])
  const both = one.replace('assertEquals;', 'assertEquals;\nimport static org.junit.jupiter.api.Assertions.assertNotEquals;')
  assert.equal(planMutants(both, ['a'], {}, d)[0].replacement, 'assertNotEquals(3, f());')
  const four = one.replace('org.junit.jupiter.api.Assertions.assertEquals', 'org.junit.Assert.assertEquals')
  assert.equal(planMutants(four, ['a'], {}, d)[0].replacement, 'org.junit.Assert.assertNotEquals(3, f());')
  assert.equal(junit.oppositeIn('import static org.junit.Assert.*;')('assertTrue', 'assertFalse'), 'assertFalse')
})

test('mutation in place on a Java spec: each mutant in the spec itself, the bytes back after', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qc-junit-mut-'))
  const spec = 'src/test/java/demo/pricing/LineTotalTest.java'
  mkdirSync(join(root, dirname(spec)), { recursive: true })
  writeFileSync(join(root, spec), JAVA)
  const seen = []
  const runTests = async ({ files, testName }) => {
    const now = readFileSync(join(root, files[0]), 'utf8')
    if (testName) seen.push(now.includes('assertNotEquals') || now.includes('isNotEqualTo') || now.includes('assertFalse'))
    const titles = ['threeItems', 'roundsHalfUp', 'parsesSku', 'quantities', 'zero']
    return { ran: true, tests: titles.filter(t => !testName || t === testName).map(title => ({ title, path: ['ABC-12 Line totals round to the cent'], file: files[0], status: testName ? 'failed' : 'passed' })) }
  }
  const r = await mutationRun({ spec, key: 'ABC-12' }, { root, dialect: d, runTests, config: { jira: { projects: ['ABC'] } } })
  assert.equal(r.status, 'pass', r.summary)
  assert.equal(r.data.killed, 5)
  assert.ok(seen.length === 5 && seen.every(Boolean))
  assert.equal(readFileSync(join(root, spec), 'utf8'), JAVA)
})
